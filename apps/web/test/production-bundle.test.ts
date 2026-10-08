/**
 * The web as it deploys (AGENTS.md principle 6, issue 505): the production
 * `vite build`, run as `infra/deploy.ts` and bytes:check run it
 * (`NODE_ENV=production`), into a folder of its own, once for every test
 * here. Its client output carries the web app manifest and every icon the
 * manifest names; its server output serves `llms.txt` (the platform's and
 * each project's) and the MCP card, and passes the skills, the install
 * script and the releases on; `#backend` resolves to the forward to
 * `PLATFORM`; and nothing in it comes from the dev world: no `src/dev/`
 * module, no memory adapter, no seed, no dev sign-in and no test kit.
 *
 * Modules are read from the build's source maps (each map's `sources`),
 * strings from every other file it wrote. The Cloudflare plugin rewrites
 * `.wrangler/deploy/config.json` at each build to point at its output; the
 * redirect is put back as it was, so a deploy never follows it into a
 * folder this test removed.
 */
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** A production build takes a few seconds; a cold one on a busy machine, longer. */
const BUILD = 180_000;

/** Text only the dev world, the test kit or the memory adapters' engine carry. */
const DEV_STRINGS = [
  "src/dev/",
  "devWorld",
  "seedDev",
  "devSessions",
  "RepoHostMemory",
  "MemorySessions",
  "/auth/dev",
  "@repo/testkit",
  "isomorphic-git",
] as const;

/** The memory adapters the dev world runs on, as module folders. */
const DEV_MODULES = [
  "packages/project/src/project-store/memory",
  "packages/artifacts/src/repo-host/memory",
] as const;

/** Files whose bytes are not text: fonts and images. */
const BINARY = /\.(?:ico|png|woff2)$/u;

const decodeSourceMap = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ sources: Schema.Array(Schema.String) }))
);

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      display: Schema.String,
      icons: Schema.Array(Schema.Struct({ src: Schema.String })),
      name: Schema.String,
      start_url: Schema.String,
    })
  )
);

/** What one build wrote. */
interface Output {
  /** Every file but the source maps, by its path under the output folder, as text. */
  readonly texts: ReadonlyMap<string, string>;
  /** Every path the build wrote, under the output folder. */
  readonly paths: ReadonlySet<string>;
  /** Every module it bundled, by its path from the repo root, without a query. */
  readonly modules: ReadonlySet<string>;
}

const where = Effect.gen(function* () {
  const path = yield* Path.Path;
  const web = yield* path.fromFileUrl(new URL("..", import.meta.url));

  return { repo: path.resolve(web, "../.."), web };
});

/** Puts the Cloudflare plugin's deploy redirect back as it was when the scope ends. */
const keepDeployRedirect = (web: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const redirect = path.join(web, ".wrangler/deploy/config.json");
    const before = yield* Effect.option(fs.readFileString(redirect));

    yield* Effect.addFinalizer(() =>
      Option.match(before, {
        onNone: () => fs.remove(redirect, { force: true }),
        onSome: (text) => fs.writeFileString(redirect, text),
      }).pipe(Effect.orDie)
    );
  });

/** The modules a source map at `map` names, from the repo root. */
const modulesIn = (map: string, text: string, repo: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const { sources } = yield* decodeSourceMap(text);

    return sources.map((source) =>
      path.relative(
        repo,
        path.resolve(path.dirname(map), source.replace(/\?.*$/u, ""))
      )
    );
  });

/** Reads every file under `out`: the source maps as modules, the rest as text. */
const readOutput = (out: string, repo: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(out, { recursive: true });
    const texts = new Map<string, string>();
    const modules = new Set<string>();
    const paths = new Set<string>();

    for (const entry of entries) {
      const at = path.join(out, entry);

      if ((yield* fs.stat(at)).type !== "File") {
        continue;
      }

      paths.add(entry);

      if (entry.endsWith(".map")) {
        for (const module of yield* modulesIn(
          at,
          yield* fs.readFileString(at),
          repo
        )) {
          modules.add(module);
        }
      } else if (!BINARY.test(entry)) {
        texts.set(entry, yield* fs.readFileString(at));
      }
    }

    return { modules, paths, texts } satisfies Output;
  });

/** The web's production build, into a folder of its own, read back whole. */
const productionBuild = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { repo, web } = yield* where;
  const out = yield* fs.makeTempDirectoryScoped({ prefix: "web-bundle-" });

  yield* keepDeployRedirect(web);

  const child = yield* spawner.spawn(
    ChildProcess.make(
      path.join(web, "node_modules/.bin/vite"),
      ["build", "--sourcemap", "--outDir", out, "--logLevel", "error"],
      {
        cwd: web,
        env: { NODE_ENV: "production", WRANGLER_SEND_METRICS: "false" },
        extendEnv: true,
        stdout: "ignore",
      }
    )
  );

  const [stderr, exitCode] = yield* Effect.all(
    [child.stderr.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
    { concurrency: "unbounded" }
  );

  if (exitCode !== 0) {
    return yield* Effect.die(`vite build exited ${exitCode}:\n${stderr}`);
  }

  return yield* readOutput(out, repo);
}).pipe(Effect.scoped, Effect.orDie, Effect.provide(NodeServices.layer));

/** The one production build every test here reads. */
class Built extends Context.Service<Built, Output>()("test/Built") {}

/** The files under `folder` of the output, as text. */
const textsUnder = (output: Output, folder: "client" | "server") =>
  [...output.texts].filter(([at]) => at.startsWith(`${folder}/`));

/** Whether some file under `folder` holds `pattern`. */
const holds = (output: Output, folder: "client" | "server", pattern: RegExp) =>
  textsUnder(output, folder).some(([, text]) => pattern.test(text));

/** A route's path, as the route tree spells it in a quoted string. */
const routePath = (path: string) =>
  new RegExp(
    `(?<quote>["'\`])${path.replaceAll(/[$.]/gu, "\\$&")}\\k<quote>`,
    "u"
  );

layer(Layer.effect(Built, productionBuild), { timeout: BUILD })(
  "the web's production build",
  (it) => {
    it.effect(
      "carries the web app manifest, which opens Today, and every icon it names",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;
          const manifest = output.texts.get("client/manifest.webmanifest");

          expect(manifest, "client/manifest.webmanifest").toBeDefined();

          const { icons, ...installs } = yield* decodeManifest(manifest);

          expect(installs).toStrictEqual({
            display: "standalone",
            name: Brand.name,
            start_url: "/today",
          });
          expect(icons.length).toBeGreaterThan(0);
          expect(
            icons.flatMap(({ src }) =>
              output.paths.has(`client${src}`) ? [] : [src]
            )
          ).toStrictEqual([]);
        })
    );

    it.effect(
      "serves llms.txt and the MCP card, and passes the skills, the install script and the releases on",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;

          expect(
            [
              "/llms.txt",
              "/$project/llms.txt",
              "/.well-known/mcp.json",
              "/.well-known/agent-skills/$",
              "/install.sh",
              "/releases/$",
            ].filter((path) => !holds(output, "server", routePath(path)))
          ).toStrictEqual([]);
        })
    );

    // A build that resolves `#backend` to `src/dev/backend.ts` fails here
    // (`devBackend`) and in the next case (the dev world's modules): checked
    // by a plant at W5's integration, once 502 gave the dev world its code.
    it.effect("resolves #backend to the forward to PLATFORM", () =>
      Effect.gen(function* () {
        const output = yield* Built;

        expect({
          devBackend: output.modules.has("apps/web/src/dev/backend.ts"),
          forwards: holds(output, "server", /\bPLATFORM\.fetch\(/u),
          serverBackend: output.modules.has("apps/web/src/server/backend.ts"),
        }).toStrictEqual({
          devBackend: false,
          forwards: true,
          serverBackend: true,
        });
      })
    );

    it.effect(
      "carries no dev module, no memory adapter, no seed, no dev sign-in and no test kit",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;

          expect(output.modules.size).toBeGreaterThan(10);
          expect(
            [...output.modules].filter(
              (module) =>
                module.startsWith("apps/web/src/dev/") ||
                DEV_MODULES.some((folder) => module.startsWith(folder))
            )
          ).toStrictEqual([]);
          expect(
            [...output.texts].flatMap(([at, text]) =>
              DEV_STRINGS.flatMap((dev) =>
                text.includes(dev) ? [`${at}: ${dev}`] : []
              )
            )
          ).toStrictEqual([]);
        })
    );
  }
);
