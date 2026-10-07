/**
 * The CLI as it ships: `bun run build` makes one standalone binary, its git
 * credential helper link and the npm `dist/`, and each runs as a process
 * here. The build runs twice for the file (the second run shows the npm
 * files come out the same); every case reads what the second run wrote.
 */
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  Config,
  Context,
  Effect,
  FileSystem,
  Hash,
  Layer,
  Path,
  Stream,
} from "effect";
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

/**
 * The npm build's files in `dist/` (not the binaries), each by its name and
 * a hash of its text, so two builds compare in a short diff.
 */
const npmFiles = (dist: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files: Record<string, number> = {};

    if (yield* fs.exists(dist)) {
      for (const file of yield* fs.readDirectory(dist)) {
        if (/\.(?:js|d\.ts)$/u.test(file)) {
          files[file] = Hash.string(
            yield* fs.readFileString(path.join(dist, file))
          );
        }
      }
    }

    return files;
  });

/** What `bun run build` did, where it wrote, and a bare env to run it in. */
class Built extends Context.Service<
  Built,
  {
    readonly build: Ran;
    /** The build run a second time, and the npm files each run wrote. */
    readonly rebuild: Ran;
    readonly firstFiles: Readonly<Record<string, number>>;
    readonly secondFiles: Readonly<Record<string, number>>;
    /** The CLI package's folder, and its `dist/`. */
    readonly root: string;
    readonly dist: string;
    /** `HOME` and `XDG_CONFIG_HOME` in a temp folder, and a `PATH` of one empty folder. */
    readonly bare: Bare;
    /** `bare`, with the built binaries' folder as the whole `PATH`. */
    readonly onPath: Bare;
    /** `bare`, with this machine's `PATH`, where `node` is. */
    readonly withNode: Bare;
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
    const firstFiles = yield* npmFiles(dist);
    const rebuild = yield* run("bun", ["run", "build"], { cwd: root });
    const secondFiles = yield* npmFiles(dist);
    const bare = { HOME: home, PATH: empty, XDG_CONFIG_HOME: config };

    return Built.of({
      bare,
      build,
      dist,
      firstFiles,
      onPath: { ...bare, PATH: path.join(dist, "bin") },
      rebuild,
      root,
      secondFiles,
      withNode: { ...bare, PATH: yield* Config.String("PATH") },
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

/**
 * The names a module's source exports, types included: each `export {…}`
 * list by its exported names, and each exported declaration. An `export *`
 * shows as `*`, since its names can't be read off the page.
 */
const exportedNames = (source: string) => {
  const listed = [
    ...source.matchAll(/\bexport\s+(?:type\s+)?\{(?<list>[^}]*)\}/gu),
  ]
    .flatMap((match) => (match.groups?.list ?? "").split(","))
    .map((entry) =>
      (
        entry
          .trim()
          .replace(/^type\s+/u, "")
          .split(/\s+as\s+/u)
          .at(-1) ?? ""
      ).trim()
    );

  const declared = [
    ...source.matchAll(
      /\bexport\s+(?:declare\s+)?(?:const|let|function|class|type|interface|enum)\s+(?<name>[\w$]+)/gu
    ),
  ].map((match) => match.groups?.name ?? "");

  const starred = /\bexport\s*\*/u.test(source) ? ["*"] : [];

  return [...new Set([...listed, ...declared, ...starred])]
    .filter((name) => name.length > 0)
    .toSorted();
};

/** What git hands a credential helper: the host, then a blank line. */
const request = "protocol=https\nhost=example.test\n\n";

/**
 * An import, export, `import()` or `require` of a workspace package. A
 * static import or export names its module in quotes, never backticks, so
 * prose in a kept doc comment ("from `@repo/git`'s `treeDiff`") is not one;
 * only a call may take a template literal.
 */
const workspaceSpecifier =
  /(?:\b(?:from|import)\s*["']|\b(?:import|require)\s*\(\s*["'`])@repo\//u;

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

          // No profile is stored under the temp HOME: the helper says
          // nothing, so git goes on without a credential.
          expect(helper).toMatchObject({ exitCode: 0, stdout: "" });
          expect(helper).toStrictEqual(direct);
          expect(helper).not.toStrictEqual(unrouted);
        }),
      spawning
    );

    it.effect(
      "node runs the npm entry, so the npm build is not Bun-only",
      () =>
        Effect.gen(function* () {
          const { withNode } = yield* Built;

          // vitest runs under Node, so `node` is on this machine's PATH.
          const help = yield* run(
            "node",
            [yield* written("bin.js"), "--help"],
            {
              only: withNode,
            }
          );

          expect(help).toMatchObject({ exitCode: 0 });
          expect(bannerIn(help.stdout)).toStrictEqual(banner);
        }),
      spawning
    );

    it.effect(
      `under node, an npm bin link named ${Brand.gitCredentialHelper} is the credential command too`,
      () =>
        Effect.gen(function* () {
          const { withNode } = yield* Built;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const entry = yield* written("bin.js");

          // npm links each `bin` name to the entry; node then sees the
          // link's path as `argv[1]`.
          const link = path.join(withNode.HOME, Brand.gitCredentialHelper);

          yield* fs.symlink(entry, link);

          const helper = yield* run("node", [link, "get"], {
            only: withNode,
            stdin: request,
          });

          const direct = yield* run("node", [entry, "credential", "get"], {
            only: withNode,
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

    it.effect(
      "rules.d.ts declares every name the sdk exports, its types included",
      () =>
        Effect.gen(function* () {
          const { root } = yield* Built;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const sdk = yield* fs.readFileString(
            path.join(root, "..", "..", "packages", "sdk", "src", "index.ts")
          );

          const declared = yield* fs.readFileString(
            yield* written("rules.d.ts")
          );

          expect(exportedNames(sdk)).toContain("project");
          expect(exportedNames(declared)).toStrictEqual(exportedNames(sdk));
        })
    );

    it.effect("a second build writes the same npm files", () =>
      Effect.gen(function* () {
        const { firstFiles, rebuild, secondFiles } = yield* Built;

        expect(rebuild).toMatchObject({ exitCode: 0 });
        expect(Object.keys(firstFiles)).toContain("rules.d.ts");
        expect(secondFiles).toStrictEqual(firstFiles);
      })
    );
  }
);
