import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

import { blankJsonc } from "../../../infra/jsonc.ts";
import {
  customHosts,
  platformOrigin,
  URL_FROM_DEPLOY,
  resources,
  stages,
  subdomainFile,
  WorkersDev,
} from "../../../infra/stages.ts";
import { budgets, workers } from "../../../scripts/startup-budget.ts";
import { repoRoot } from "./root.ts";

const presentText = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(yield* repoRoot, file);

    expect(yield* fs.exists(at), `${file} exists`).toBeTruthy();

    return yield* fs.readFileString(at);
  }).pipe(Effect.provide(NodeServices.layer));

const presentJson = <S extends Schema.Top>(file: string, schema: S) =>
  Effect.flatMap(presentText(file), (text) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(blankJsonc(text))
  );

const STORAGE = [
  "artifacts",
  "d1_databases",
  "durable_objects",
  "kv_namespaces",
  "r2_buckets",
  "worker_loaders",
] as const;

const Block = Schema.Record(Schema.String, Schema.Unknown);

const Wrangler = Schema.Struct({
  env: Schema.Record(Schema.String, Block),
  name: Schema.String,
});

const Bound = Schema.Struct({
  services: Schema.Array(
    Schema.Struct({ binding: Schema.String, service: Schema.String })
  ),
  vars: Schema.Record(Schema.String, Schema.String),
  workers_dev: Schema.optionalKey(Schema.Boolean),
});

const decodeBound = Schema.decodeUnknownEffect(Bound);

const WebManifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String)
  ),
  imports: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))
  ),
  name: Schema.String,
});

const RootManifest = Schema.Struct({
  workspaces: Schema.Struct({ packages: Schema.Array(Schema.String) }),
});

const globMatches = (
  parts: readonly string[],
  segments: readonly string[]
): boolean => {
  const [part, ...rest] = parts;

  if (part === undefined) {
    return segments.length === 0;
  }

  if (part === "**") {
    return segments.some((_, at) => globMatches(rest, segments.slice(at)))
      ? true
      : globMatches(rest, []);
  }

  const [segment, ...after] = segments;

  return (
    segment !== undefined &&
    (part === "*" || part === segment) &&
    globMatches(rest, after)
  );
};

describe("the web Worker's wrangler.jsonc", () => {
  it.effect("binds one service, PLATFORM, and no storage, in every block", () =>
    Effect.gen(function* () {
      const config = yield* presentJson("apps/web/wrangler.jsonc", Wrangler);

      expect(config.name).toBe("web");
      expect(Object.keys(config.env).toSorted()).toStrictEqual(
        [...stages].toSorted()
      );

      const top = yield* presentJson("apps/web/wrangler.jsonc", Block);

      for (const [block, raw] of [
        ["top", top],
        ...Object.entries(config.env),
      ] as const) {
        expect(
          STORAGE.filter((key) => key in raw),
          `${block} declares no storage binding`
        ).toStrictEqual([]);
      }

      const { services } = yield* decodeBound(top);

      expect(services).toStrictEqual([
        { binding: "PLATFORM", service: "platform" },
      ]);
    })
  );

  it.effect(
    "points each stage's PLATFORM at that stage's platform Worker, and its public URL at that Worker's origin, which a stage on the brand's domain takes from the deploy",
    () =>
      Effect.gen(function* () {
        const config = yield* presentJson("apps/web/wrangler.jsonc", Wrangler);
        const { subdomain } = yield* presentJson(subdomainFile, WorkersDev);

        for (const stage of stages) {
          const { services, vars, workers_dev } = yield* decodeBound(
            config.env[stage]
          );

          expect(services).toStrictEqual([
            { binding: "PLATFORM", service: resources(stage).platform },
          ]);
          expect({
            stage,
            url: vars.PUBLIC_PLATFORM_URL,
            workers_dev,
          }).toStrictEqual(
            Option.isSome(customHosts(stage))
              ? { stage, url: URL_FROM_DEPLOY, workers_dev: false }
              : {
                  stage,
                  url: platformOrigin(stage, subdomain),
                  workers_dev: undefined,
                }
          );
        }
      })
  );

  // The edge keeps the web's answers only behind its entry, which decides what
  // may be kept; `vite dev` keeps nothing; and a kept page never outlives its
  // Worker version, whose hashed assets it names.
  it.effect(
    "enters through src/server.ts, and turns Workers Cache on in each stage alone, per version",
    () =>
      Effect.gen(function* () {
        const config = yield* presentJson("apps/web/wrangler.jsonc", Wrangler);
        const top = yield* presentJson("apps/web/wrangler.jsonc", Block);

        expect(top.main).toBe("src/server.ts");
        expect("cache" in top, "the local stage keeps nothing").toBeFalsy();

        for (const stage of stages) {
          expect(
            config.env[stage]?.cache,
            `${stage} keeps answers`
          ).toStrictEqual({
            enabled: true,
          });
        }
      })
  );
});

describe("the web Worker's generated Env", () => {
  it.effect("has PLATFORM as a Fetcher and nothing named ARTIFACTS…", () =>
    Effect.gen(function* () {
      const types = yield* presentText("apps/web/worker-configuration.d.ts");

      expect(types).toMatch(/^\s*PLATFORM: Fetcher\b/mu);
      expect(types.match(/\bARTIFACTS\w*/gu) ?? []).toStrictEqual([]);
    })
  );
});

describe("the web's package.json", () => {
  it.effect(
    "sends #backend to src/dev under development, and to src/server otherwise",
    () =>
      Effect.gen(function* () {
        const manifest = yield* presentJson(
          "apps/web/package.json",
          WebManifest
        );

        const backend = manifest.imports?.["#backend"] ?? {};

        expect(manifest.name).toBe("@repo/web");
        // Conditions match in order: `development` must come first.
        expect(Object.keys(backend)).toStrictEqual(["development", "default"]);
        expect(backend.development).toMatch(/^\.\/src\/dev\/[\w/-]+\.ts$/u);
        expect(backend.default).toMatch(/^\.\/src\/server\/[\w/-]+\.ts$/u);
      })
  );

  it.effect("depends on no varlock runtime and no Alchemy", () =>
    Effect.gen(function* () {
      const manifest = yield* presentJson("apps/web/package.json", WebManifest);

      const names = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      });

      expect(
        names.filter(
          (name) =>
            name === "varlock" ||
            name.startsWith("@varlock/") ||
            name === "alchemy" ||
            name.startsWith("@alchemy/")
        )
      ).toStrictEqual([]);
    })
  );
});

describe("the byte alarm", () => {
  it("measures the web Worker", () => {
    expect(workers.map(({ dir }) => dir)).toContain("apps/web");
  });

  // Each Worker has limits of its own, about 15% above its bundle as last measured.
  it("holds each Worker it measures to limits of its own", () => {
    expect(budgets).toStrictEqual({
      "apps/platform": { entry: 1_900_000, javascript: 1_900_000 },
      "apps/sandbox": { entry: 656_000, javascript: 656_000 },
      "apps/web": { entry: 355_000, javascript: 3_191_000 },
    });
    expect(Object.keys(budgets).toSorted()).toStrictEqual(
      workers.map(({ dir }) => dir).toSorted()
    );
  });
});

describe("the examples", () => {
  it.effect(
    "each exist as a project of their own, outside the root's workspaces",
    () =>
      Effect.gen(function* () {
        const root = yield* presentJson("package.json", RootManifest);

        for (const example of ["examples/datekit", "examples/burrow"]) {
          yield* presentText(`${example}/README.md`);

          expect(
            root.workspaces.packages.filter((glob) =>
              globMatches(glob.split("/"), example.split("/"))
            ),
            `no workspace glob matches ${example}`
          ).toStrictEqual([]);
        }
      })
  );
});
