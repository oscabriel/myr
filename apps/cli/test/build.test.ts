/**
 * The CLI as it ships: `bun run build` makes one standalone binary, its git
 * credential helper link and the npm `dist/`, and each runs as a process
 * here. The build runs once for the file; every case reads what it wrote.
 */
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** How a process ended, and what it printed. */
interface Ran {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** The whole env a built binary runs with. */
interface Bare {
  readonly HOME: string;
  readonly PATH: string;
  readonly XDG_CONFIG_HOME: string;
}

/**
 * Runs `command` to its end. With `only`, the process gets exactly that env
 * and nothing of this machine's; without it, it inherits this one's.
 */
const run = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly only?: Bare;
    readonly stdin?: string;
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd: options.cwd,
          env: { ...options.only },
          extendEnv: options.only === undefined,
          stdin:
            options.stdin === undefined
              ? "ignore"
              : Stream.make(new TextEncoder().encode(options.stdin)),
        })
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stderr, stdout } satisfies Ran;
    })
  ).pipe(Effect.orDie);

/** What `bun run build` did, where it wrote, and a bare env to run it in. */
class Built extends Context.Service<
  Built,
  {
    readonly build: Ran;
    /** The CLI package's folder, and its `dist/`. */
    readonly root: string;
    readonly dist: string;
    /** `HOME` and `XDG_CONFIG_HOME` in a temp folder, and a `PATH` of one empty folder. */
    readonly bare: Bare;
    /** `bare`, with the built binaries' folder as the whole `PATH`. */
    readonly onPath: Bare;
  }
>()("cli/test/Built") {}

const BuiltOnce = Layer.effect(
  Built,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(new URL("..", import.meta.url));
    const dist = path.join(root, "dist");
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "cli-build-" });
    const empty = path.join(home, "empty-bin");
    const config = path.join(home, "config");

    yield* fs.makeDirectory(empty);
    yield* fs.makeDirectory(config);

    const build = yield* run("bun", ["run", "build"], { cwd: root });
    const bare = { HOME: home, PATH: empty, XDG_CONFIG_HOME: config };

    return Built.of({
      bare,
      build,
      dist,
      onPath: { ...bare, PATH: path.join(dist, "bin") },
      root,
    });
  })
).pipe(Layer.provideMerge(NodeServices.layer));

/** The path of `segments` under `dist/`, once the test has seen the build write it. */
const written = (...segments: readonly string[]) =>
  Effect.gen(function* () {
    const { dist } = yield* Built;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(dist, ...segments);
    const label = ["dist", ...segments].join("/");

    expect({ [label]: yield* fs.exists(file) }).toStrictEqual({
      [label]: true,
    });

    return file;
  });

/** Long enough for a case that starts the built binaries a few times on a busy machine. */
const spawning = { timeout: 60_000 };

/** The start-here banner `--help` opens with (as `test/main.test.ts` holds it). */
const banner = [
  "Start here:",
  `${Brand.cli} asks      list the open asks you could take`,
  `${Brand.cli} claim     take one; you get a fork to push your answer to`,
  `${Brand.cli} check     run the gate's checks locally before you push`,
];

/** The banner as `--help` printed it, if it did: four lines from "Start here:". */
const bannerIn = (stdout: string) => {
  const lines = stdout.split("\n").map((line) => line.trim());
  const start = lines.indexOf("Start here:");

  return start === -1 ? [] : lines.slice(start, start + banner.length);
};

/** What git hands a credential helper: the host, then a blank line. */
const request = "protocol=https\nhost=example.test\n\n";

/**
 * An import, export, `import()` or `require` of a workspace package (prose
 * in a comment may still name one).
 */
const workspaceSpecifier =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]@repo\//u;

layer(BuiltOnce, { excludeTestServices: true, timeout: "180 seconds" })(
  "bun run build",
  (it) => {
    it.effect(
      "exits 0 and writes the binary, its helper link and the npm entries",
      () =>
        Effect.gen(function* () {
          const { build } = yield* Built;
          const fs = yield* FileSystem.FileSystem;

          expect(build).toMatchObject({ exitCode: 0 });

          for (const file of [
            "bin.js",
            "rules.js",
            "rules.d.ts",
            "protocol.js",
            "protocol.d.ts",
          ]) {
            yield* written(file);
          }

          const binary = yield* fs.stat(yield* written("bin", Brand.cli));

          expect(binary.type).toBe("File");
          // The owner's execute bit.
          expect(Math.floor(binary.mode / 0o100) % 2).toBe(1);

          // A link, not a shim: the compiled binary sees the name it was
          // invoked by.
          expect(
            yield* fs.readLink(yield* written("bin", Brand.gitCredentialHelper))
          ).toBe(Brand.cli);
        })
    );

    it.effect(
      "the binary prints the banner with neither bun nor node on its PATH",
      () =>
        Effect.gen(function* () {
          const { bare } = yield* Built;

          const help = yield* run(
            yield* written("bin", Brand.cli),
            ["--help"],
            {
              only: bare,
            }
          );

          expect(help).toMatchObject({ exitCode: 0 });
          expect(bannerIn(help.stdout)).toStrictEqual(banner);
        }),
      spawning
    );

    it.effect(
      `invoked as ${Brand.gitCredentialHelper}, the binary is its credential command`,
      () =>
        Effect.gen(function* () {
          const { onPath } = yield* Built;
          const binary = yield* written("bin", Brand.cli);

          yield* written("bin", Brand.gitCredentialHelper);

          // Found on the PATH by name, as git finds a helper.
          const helper = yield* run(Brand.gitCredentialHelper, ["get"], {
            only: onPath,
            stdin: request,
          });

          const direct = yield* run(binary, ["credential", "get"], {
            only: onPath,
            stdin: request,
          });

          const unrouted = yield* run(binary, ["get"], {
            only: onPath,
            stdin: request,
          });

          expect(helper).toStrictEqual(direct);
          expect(helper).not.toStrictEqual(unrouted);
        }),
      spawning
    );

    it.effect(
      "node runs the npm entry, so the npm build is not Bun-only",
      () =>
        Effect.gen(function* () {
          // vitest runs under Node, so `node` is on this PATH.
          const help = yield* run("node", [yield* written("bin.js"), "--help"]);

          expect(help).toMatchObject({ exitCode: 0 });
          expect(bannerIn(help.stdout)).toStrictEqual(banner);
        }),
      spawning
    );

    it.effect(
      `under node, an npm bin link named ${Brand.gitCredentialHelper} is the credential command too`,
      () =>
        Effect.gen(function* () {
          const { bare } = yield* Built;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const entry = yield* written("bin.js");

          // npm links each `bin` name to the entry; node then sees the
          // link's path as `argv[1]`.
          const link = path.join(bare.HOME, Brand.gitCredentialHelper);

          yield* fs.symlink(entry, link);

          const helper = yield* run("node", [link, "get"], { stdin: request });

          const direct = yield* run("node", [entry, "credential", "get"], {
            stdin: request,
          });

          expect(helper).toStrictEqual(direct);
        }),
      spawning
    );

    it.effect(
      "rules.js imports in Bun as the whole sdk, and no dist file imports a workspace package",
      () =>
        Effect.gen(function* () {
          const { dist, root } = yield* Built;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const rules = yield* written("rules.js");

          // Run from the CLI package, where `@repo/sdk` resolves.
          const imported = yield* run(
            "bun",
            [
              "--eval",
              `const rules = await import(${JSON.stringify(rules)});
const sdk = await import("@repo/sdk");
console.log(JSON.stringify({
  kind: typeof rules.kind,
  missing: Object.keys(sdk).filter((name) => !(name in rules)),
  project: typeof rules.project,
}));`,
            ],
            { cwd: root }
          );

          expect(imported).toMatchObject({ exitCode: 0 });
          expect(JSON.parse(imported.stdout)).toStrictEqual({
            kind: "function",
            missing: [],
            project: "function",
          });

          const files = (yield* fs.readDirectory(dist)).filter((file) =>
            /\.(?:js|d\.ts)$/u.test(file)
          );

          expect(files).toContain("rules.d.ts");

          const importing: string[] = [];

          for (const file of files) {
            if (
              workspaceSpecifier.test(
                yield* fs.readFileString(path.join(dist, file))
              )
            ) {
              importing.push(file);
            }
          }

          expect(importing).toStrictEqual([]);
        }),
      spawning
    );
  }
);
