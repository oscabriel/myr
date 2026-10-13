// The Cloudflare plugin rewrites `.wrangler/deploy/config.json` at each build to point at its output;
// the redirect is put back as it was, so a deploy never follows it into a folder this test removed.
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

const BUILD = 180_000;

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

const DEV_MODULES = [
  "packages/project/src/project-store/memory",
  "packages/artifacts/src/repo-host/memory",
] as const;

// About 10% above what the root's preloads weighed once the landing read its projects on the server.
// A route's `head`, `loader` and server functions ride in the route tree every page loads, so what they import counts here.
const ROOT_PRELOADS_GZIP = 268_000;

const GRAMMAR = /node_modules\/@shikijs\/langs\/dist\/(?<name>[\w-]+)\.mjs$/u;

// By Shiki's module names: HTML brings JavaScript and CSS with it.
const SERVER_GRAMMARS = [
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "shellscript",
  "toml",
  "tsx",
  "typescript",
  "yaml",
];

const drawing = (held: readonly string[]) =>
  held.some((module) => module.endsWith("features/code/prerender-server.ts"));

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

interface Output {
  readonly texts: ReadonlyMap<string, string>;
  readonly paths: ReadonlySet<string>;
  readonly modules: ReadonlySet<string>;
  readonly holding: ReadonlyMap<string, readonly string[]>;
}

const where = Effect.gen(function* () {
  const path = yield* Path.Path;
  const web = yield* path.fromFileUrl(new URL("..", import.meta.url));

  return { repo: path.resolve(web, "../.."), web };
});

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

const readOutput = (out: string, repo: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(out, { recursive: true });
    const texts = new Map<string, string>();
    const modules = new Set<string>();
    const paths = new Set<string>();
    const holding = new Map<string, readonly string[]>();

    for (const entry of entries) {
      const at = path.join(out, entry);

      if ((yield* fs.stat(at)).type !== "File") {
        continue;
      }

      paths.add(entry);

      if (entry.endsWith(".map")) {
        const held = yield* modulesIn(at, yield* fs.readFileString(at), repo);

        holding.set(entry.replace(/\.map$/u, ""), held);

        for (const module of held) {
          modules.add(module);
        }
      } else if (!BINARY.test(entry)) {
        texts.set(entry, yield* fs.readFileString(at));
      }
    }

    return { holding, modules, paths, texts } satisfies Output;
  });

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

class Built extends Context.Service<Built, Output>()("test/Built") {}

const textsUnder = (output: Output, folder: "client" | "server") =>
  [...output.texts].filter(([at]) => at.startsWith(`${folder}/`));

const holds = (output: Output, folder: "client" | "server", pattern: RegExp) =>
  textsUnder(output, folder).some(([, text]) => pattern.test(text));

const routePath = (path: string) =>
  new RegExp(
    `(?<quote>["'\`])${path.replaceAll(/[$.]/gu, "\\$&")}\\k<quote>`,
    "u"
  );

const rootPreloads = (output: Output) => {
  const manifest = textsUnder(output, "server").find(([at]) =>
    at.includes("tanstack-start-manifest")
  )?.[1];

  // Lazily up to the first `preloads`, the root's own: a child route's path
  // may hold a brace (`/$owner/$project/asks/{$ask}.md`). The minified server
  // build writes the list as one string it splits on commas
  // (`` `/assets/a.js,/assets/b.js`.split(`,`) ``), an unminified one as an array.
  const preloads =
    /__root__:\s*\{[\s\S]*?preloads:\s*(?<list>\[[^\]]*\]|`[^`]*`)/u.exec(
      manifest ?? ""
    )?.groups?.list;

  return [...(preloads ?? "").matchAll(/\/assets\/[^"`,\s]+/gu)].map(
    ([chunk]) => chunk
  );
};

const gzipped = (text: string) =>
  Stream.fromReadableStream({
    evaluate: () =>
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    onError: (cause) => cause,
  }).pipe(
    Stream.runFold(
      () => 0,
      (size, chunk: Uint8Array) => size + chunk.byteLength
    ),
    Effect.orDie
  );

layer(Layer.effect(Built, productionBuild), { timeout: BUILD })(
  "the web's production build",
  (it) => {
    it.effect(
      "carries the web app manifest, which opens the inbox, and every icon it names",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;
          const manifest = output.texts.get("client/manifest.webmanifest");

          expect(manifest, "client/manifest.webmanifest").toBeDefined();

          const { icons, ...installs } = yield* decodeManifest(manifest);

          expect(installs).toStrictEqual({
            display: "standalone",
            name: Brand.name,
            start_url: "/inbox",
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
              "/$owner/$project/llms.txt",
              "/.well-known/mcp.json",
              "/.well-known/agent-skills/$",
              "/install.sh",
              "/releases/$",
            ].filter((path) => !holds(output, "server", routePath(path)))
          ).toStrictEqual([]);
        })
    );

    // A build that resolves `#backend` to `src/dev/backend.ts` fails here and in the next case.
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

    it.effect(
      "preloads on every page no chunk that holds the Markdown renderer, and stays under its ceiling",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;
          const preloads = rootPreloads(output);

          expect(preloads.length).toBeGreaterThan(0);

          const sizes = yield* Effect.forEach(preloads, (chunk) =>
            gzipped(output.texts.get(`client${chunk}`) ?? "")
          );

          const total = sizes.reduce((sum, size) => sum + size, 0);

          expect({
            markdown: preloads.filter((chunk) =>
              (output.holding.get(`client${chunk}`) ?? []).some((module) =>
                module.includes("node_modules/react-markdown/")
              )
            ),
            missing: preloads.filter(
              (chunk) => !output.texts.has(`client${chunk}`)
            ),
          }).toStrictEqual({ markdown: [], missing: [] });
          // The weight itself, so a failure says how far over it is.
          expect(
            total,
            `${preloads.length} root preloads, gzipped`
          ).toBeLessThanOrEqual(ROOT_PRELOADS_GZIP);
        })
    );

    it.effect(
      "preloads on every page no grammar, nothing of the server's highlighting, and neither the landing's view nor the import page's",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;

          // Nor the landing's view, nor the import page's: a route's head or
          // loader that imported one would carry the whole page into every
          // page's preloads.
          expect(
            rootPreloads(output).flatMap((chunk) =>
              (output.holding.get(`client${chunk}`) ?? []).filter(
                (module) =>
                  GRAMMAR.test(module) ||
                  module.includes("prerender") ||
                  module.endsWith("features/landing/landing-page.tsx") ||
                  module.includes("features/import/")
              )
            )
          ).toStrictEqual([]);

          // The server's highlighting is the Worker's alone.
          expect({
            browser: [...output.holding].flatMap(([at, held]) =>
              at.startsWith("client/") && drawing(held) ? [at] : []
            ),
            worker: [...output.holding].some(
              ([at, held]) => at.startsWith("server/") && drawing(held)
            ),
          }).toStrictEqual({ browser: [], worker: true });
        })
    );

    it.effect(
      "bundles into the Worker its few grammars alone, off its entry, and no theme collection or WebAssembly",
      () =>
        Effect.gen(function* () {
          const output = yield* Built;

          const server = [...output.holding].filter(([at]) =>
            at.startsWith("server/")
          );

          const grammars = new Set(
            server.flatMap(([, held]) =>
              held.flatMap((module) => {
                const name = GRAMMAR.exec(module)?.groups?.name;

                return name === undefined ? [] : [name];
              })
            )
          );

          expect([...grammars].toSorted()).toStrictEqual(SERVER_GRAMMARS);
          expect(
            server.flatMap(([at, held]) =>
              held.filter(
                (module) =>
                  module.includes("node_modules/@shikijs/themes/") ||
                  module.includes("node_modules/@pierre/theme/") ||
                  module.includes("node_modules/@shikijs/engine-oniguruma/") ||
                  (at === "server/index.js" &&
                    (GRAMMAR.test(module) ||
                      module.includes("features/code/prerender-server.ts")))
              )
            )
          ).toStrictEqual([]);
        })
    );

    it.effect("tells browsers to keep the hashed assets for good", () =>
      Effect.gen(function* () {
        const output = yield* Built;

        expect(output.texts.get("client/_headers")).toMatch(
          /^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/mu
        );
      })
    );
  }
);
