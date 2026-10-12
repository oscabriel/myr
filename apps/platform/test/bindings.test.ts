import { NodeServices } from "@effect/platform-node";
import type { D1Client } from "@effect/sql-d1";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { RepoHostBinding } from "@repo/artifacts/repo-host/binding";
import type { CodeStoreR2 } from "@repo/project/code-store/binding";
import type { RulesEvaluatorWorker } from "@repo/rules/rules-evaluator/worker";
import {
  Array,
  Effect,
  Exit,
  FileSystem,
  Order,
  Schema,
  SchemaAST,
} from "effect";

import type { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type {
  CheckRunnerSandbox,
  SandboxBinding,
} from "../src/adapters/check-runner-sandbox.ts";
import type { DoProjects } from "../src/adapters/do-projects.ts";
import type { LanderSandbox } from "../src/adapters/lander-sandbox.ts";
import type { WorkerRateLimits } from "../src/adapters/rate-limits.ts";
import type { SignInAttemptsBinding } from "../src/auth/attempts/binding.ts";
import type { tokenReader } from "../src/auth/provider.ts";
import {
  PlatformBindings,
  PlatformSecrets,
  PlatformVars,
} from "../src/platform.ts";
import type { PlatformConfig } from "../src/platform.ts";

const stringEnd = (text: string, start: number) => {
  let at = start + 1;

  while (at < text.length && text[at] !== '"') {
    at += text[at] === "\\" ? 2 : 1;
  }

  return at + 1;
};

const tokenEnd = (text: string, at: number) => {
  if (text[at] === '"') {
    return stringEnd(text, at);
  }

  if (text.startsWith("//", at)) {
    const end = text.indexOf("\n", at);

    return end === -1 ? text.length : end;
  }

  if (text.startsWith("/*", at)) {
    const end = text.indexOf("*/", at + 2);

    return end === -1 ? text.length : end + 2;
  }

  return at + 1;
};

const tokensOf = (text: string) => {
  const tokens: string[] = [];
  let at = 0;

  while (at < text.length) {
    const end = tokenEnd(text, at);

    tokens.push(text.slice(at, end));
    at = end;
  }

  return tokens;
};

const isComment = (token: string) =>
  token.startsWith("//") || token.startsWith("/*");

const closesAfter = (tokens: readonly string[], index: number) => {
  const next = tokens.find((token, at) => at > index && token.trim() !== "");

  return next === "]" || next === "}";
};

const fromJsonc = (text: string) => {
  const tokens = tokensOf(text).filter((token) => !isComment(token));

  return tokens
    .filter((token, index) => token !== "," || !closesAfter(tokens, index))
    .join("");
};

const Bound = Schema.Array(Schema.Struct({ binding: Schema.String }));

const Named = Schema.Array(Schema.Struct({ name: Schema.String }));

const BindingKinds = Schema.Struct({
  ai: Schema.optionalKey(Schema.Struct({ binding: Schema.String })),
  artifacts: Schema.optionalKey(Bound),
  d1_databases: Schema.optionalKey(Bound),
  durable_objects: Schema.optionalKey(Schema.Struct({ bindings: Named })),
  kv_namespaces: Schema.optionalKey(Bound),
  r2_buckets: Schema.optionalKey(Bound),
  ratelimits: Schema.optionalKey(Named),
  services: Schema.optionalKey(Bound),
  worker_loaders: Schema.optionalKey(Bound),
  workflows: Schema.optionalKey(Bound),
});

const NOT_BINDINGS: ReadonlySet<string> = new Set([
  "$schema",
  "compatibility_date",
  "compatibility_flags",
  "containers",
  "env",
  "keep_names",
  "main",
  "migrations",
  "minify",
  "name",
  "observability",
  "preview_urls",
  "secrets",
  "triggers",
  "vars",
  "workers_dev",
]);

const Block = Schema.Struct({
  ...BindingKinds.fields,
  secrets: Schema.optionalKey(
    Schema.Struct({ required: Schema.Array(Schema.String) })
  ),
  vars: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const Raw = Schema.Record(Schema.String, Schema.Unknown);

const readJsonc = (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(Raw))(fromJsonc(text));

const Staged = Schema.Struct({
  env: Schema.optionalKey(Schema.Record(Schema.String, Raw)),
});

const decodeBlock = Schema.decodeUnknownEffect(Block);

const sorted = (names: Iterable<string>) =>
  Array.sort(Array.fromIterable(names), Order.String);

const declaredIn = (raw: typeof Raw.Type) =>
  Effect.map(decodeBlock(raw), (block) => ({
    bindings: sorted([
      ...(block.ai === undefined ? [] : [block.ai.binding]),
      ...(block.artifacts ?? []).map(({ binding }) => binding),
      ...(block.d1_databases ?? []).map(({ binding }) => binding),
      ...(block.durable_objects?.bindings ?? []).map(({ name }) => name),
      ...(block.kv_namespaces ?? []).map(({ binding }) => binding),
      ...(block.r2_buckets ?? []).map(({ binding }) => binding),
      ...(block.ratelimits ?? []).map(({ name }) => name),
      ...(block.services ?? []).map(({ binding }) => binding),
      ...(block.worker_loaders ?? []).map(({ binding }) => binding),
      ...(block.workflows ?? []).map(({ binding }) => binding),
    ]),
    secrets: sorted(block.secrets?.required ?? []),
    unknown: Object.keys(raw).filter(
      (key) => !NOT_BINDINGS.has(key) && !(key in BindingKinds.fields)
    ),
    vars: sorted(Object.keys(block.vars ?? {})),
  }));

const fileText = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(new URL(`../${path}`, import.meta.url).pathname)
  );

const wranglerOf = (path: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.flatMap(fileText(path), readJsonc);

    const { env = {} } = yield* Schema.decodeUnknownEffect(Staged)(raw);

    const top = yield* declaredIn(raw);

    const stages = yield* Effect.forEach(
      Object.entries(env),
      ([stage, block]) =>
        Effect.map(declaredIn(block), (declared) => [stage, declared] as const)
    );

    return { stages: Object.fromEntries(stages), top };
  });

const keysOf = (
  fields: Readonly<Record<string, Schema.Top>>,
  only: "all" | "required" = "all"
) =>
  sorted(
    Object.entries(fields)
      .filter(
        ([, schema]) => only === "all" || !SchemaAST.isOptional(schema.ast)
      )
      .map(([key]) => key)
  );

const sandboxEnvKeys = Effect.map(
  fileText("../sandbox/worker-configuration.d.ts"),
  (text) =>
    sorted(
      [
        ...(
          /interface __BaseEnv_Env \{(?<body>[^}]*)\}/u.exec(text)?.groups
            ?.body ?? ""
        ).matchAll(/^\s*(?<key>\w+):/gmu),
      ].flatMap(({ groups }) => (groups?.key === undefined ? [] : [groups.key]))
    )
);

const draftLimit = (id: string) => ({
  name: "DRAFT_LIMIT",
  namespace_id: id,
  simple: { limit: 2, period: 60 },
});

describe("a wrangler.jsonc, read as data", () => {
  it.effect(
    "loses its comments and trailing commas, a comment between a comma and its bracket too, and keeps every string whole",
    () =>
      Effect.gen(function* () {
        const text = [
          "{",
          '  "vars": {',
          '    "STAGE": "local", // the stage',
          "    // more vars go here",
          "  },",
          '  "note": "a // b, } /* c */", /* the last key */',
          "}",
        ].join("\n");

        expect(yield* Effect.exit(readJsonc(text))).toStrictEqual(
          Exit.succeed({
            note: "a // b, } /* c */",
            vars: { STAGE: "local" },
          })
        );
      })
  );
});

describe("the platform Worker's bindings", () => {
  it.effect(
    "are the ones its env decodes, at the top level and in every stage",
    () =>
      Effect.gen(function* () {
        const { stages, top } = yield* wranglerOf("wrangler.jsonc");

        const decoded = {
          bindings: keysOf(PlatformBindings.fields),
          secrets: keysOf(PlatformSecrets.fields, "required"),
          unknown: [],
          vars: keysOf(PlatformVars.fields),
        };

        expect(Object.keys(stages)).toStrictEqual(["dev-oscabriel", "demo"]);
        expect({ top, ...stages }).toStrictEqual({
          demo: decoded,
          "dev-oscabriel": decoded,
          top: decoded,
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "set the drafter's model, the web's address and the draft limit in every stage",
    () =>
      Effect.gen(function* () {
        const raw = yield* Effect.flatMap(
          fileText("wrangler.jsonc"),
          readJsonc
        );

        const { env = {} } = yield* Schema.decodeUnknownEffect(Staged)(raw);

        const DraftBlock = Schema.Struct({
          ai: Schema.Struct({ binding: Schema.String }),
          ratelimits: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              namespace_id: Schema.String,
              simple: Schema.Struct({
                limit: Schema.Int,
                period: Schema.Int,
              }),
            })
          ),
          vars: PlatformVars,
        });

        const read = (block: typeof Raw.Type | undefined) =>
          Effect.map(
            Schema.decodeUnknownEffect(DraftBlock)(block),
            ({ ai, ratelimits, vars }) => ({
              ai: ai.binding,
              draftLimit: ratelimits.find(({ name }) => name === "DRAFT_LIMIT"),
              model: vars.DRAFT_MODEL,
              web: vars.PUBLIC_WEB_URL,
            })
          );

        const model = "@cf/moonshotai/kimi-k2.7-code";

        expect({
          demo: yield* read(env.demo),
          "dev-oscabriel": yield* read(env["dev-oscabriel"]),
          top: yield* read(raw),
        }).toStrictEqual({
          demo: {
            ai: "AI",
            draftLimit: draftLimit("1204"),
            model,
            web: "https://web-demo.oscargabriel.workers.dev",
          },
          "dev-oscabriel": {
            ai: "AI",
            draftLimit: draftLimit("1104"),
            model,
            web: "https://web-dev-oscabriel.oscargabriel.workers.dev",
          },
          top: {
            ai: "AI",
            draftLimit: draftLimit("1004"),
            model,
            web: "http://localhost:5173",
          },
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("keep code history in each block's own code-cache bucket", () =>
    Effect.gen(function* () {
      const raw = yield* Effect.flatMap(fileText("wrangler.jsonc"), readJsonc);

      const { env = {} } = yield* Schema.decodeUnknownEffect(Staged)(raw);

      const Buckets = Schema.Struct({
        r2_buckets: Schema.Array(
          Schema.Struct({ binding: Schema.String, bucket_name: Schema.String })
        ),
      });

      const codeCache = (block: typeof Raw.Type | undefined) =>
        Effect.map(
          Schema.decodeUnknownEffect(Buckets)(block),
          ({ r2_buckets }) =>
            r2_buckets.find(({ binding }) => binding === "CODE_CACHE")
              ?.bucket_name
        );

      expect({
        demo: yield* codeCache(env.demo),
        "dev-oscabriel": yield* codeCache(env["dev-oscabriel"]),
        top: yield* codeCache(raw),
      }).toStrictEqual({
        demo: "code-cache-demo",
        "dev-oscabriel": "code-cache-dev-oscabriel",
        top: "code-cache-local",
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it("are all the Env the Worker is given, and nothing else", () => {
    expectTypeOf<keyof Env>().toEqualTypeOf<
      Exclude<
        keyof PlatformConfig,
        "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SESSION_TOKENS"
      >
    >();
  });

  it("hold the private namespace, decoded as the public one is", () => {
    expectTypeOf<Env>().toHaveProperty("ARTIFACTS_PRIVATE");
    expectTypeOf<PlatformConfig["ARTIFACTS_PRIVATE"]>().toEqualTypeOf<
      Env["ARTIFACTS_PRIVATE"]
    >();
    expectTypeOf<Env["ARTIFACTS_PRIVATE"]>().toExtend<
      Parameters<(typeof RepoHostBinding)["layer"]>[0]
    >();
  });

  it("are each taken by its port's factory as Env types it, without a cast", () => {
    expectTypeOf<Env["ARTIFACTS"]>().toExtend<
      Parameters<(typeof RepoHostBinding)["layer"]>[0]
    >();
    expectTypeOf<Env["PROJECT"]>().toExtend<Parameters<typeof DoProjects>[0]>();
    expectTypeOf<Env["ANSWER"]>().toExtend<
      Parameters<typeof AnswerRunsWorkflow>[0]
    >();
    expectTypeOf<Env["LOADER"]>().toExtend<
      Parameters<typeof RulesEvaluatorWorker>[0]
    >();
    expectTypeOf<Env["CLAIM_LIMIT"]>().toExtend<
      Parameters<typeof WorkerRateLimits>[0]["claim"]
    >();
    expectTypeOf<Env["PROPOSAL_LIMIT"]>().toExtend<
      Parameters<typeof WorkerRateLimits>[0]["proposal"]
    >();
    expectTypeOf<Env["DRAFT_LIMIT"]>().toExtend<
      Parameters<typeof WorkerRateLimits>[0]["draft"]
    >();
    expectTypeOf<PlatformConfig["AI"]>().toEqualTypeOf<Env["AI"]>();
    expectTypeOf<Env["FRONT_PAGE"]>().toExtend<
      Parameters<typeof D1Client.layer>[0]["db"]
    >();
    expectTypeOf<Env["OAUTH_KV"]>().toExtend<
      Parameters<typeof tokenReader>[0]
    >();
    expectTypeOf<Env["SIGN_IN_LIMIT"]>().toExtend<
      Parameters<typeof SignInAttemptsBinding>[0]
    >();
    expectTypeOf<Env["CODE_CACHE"]>().toExtend<
      Parameters<typeof CodeStoreR2>[0]
    >();
    expectTypeOf<PlatformConfig["CODE_CACHE"]>().toEqualTypeOf<
      Env["CODE_CACHE"]
    >();
  });

  it("type the sandbox service binding by the entrypoint the platform calls", () => {
    // If the generated `Env` ever types `SANDBOX`'s methods, or turns `any`, this fails:
    // drop the `SandboxBinding` declaration, or find what made the binding untyped.
    expectTypeOf<Env["SANDBOX"]>().not.toExtend<SandboxBinding>();
    expectTypeOf<PlatformConfig["SANDBOX"]>().toExtend<Env["SANDBOX"]>();
    expectTypeOf<PlatformConfig["SANDBOX"]>().toExtend<
      Parameters<typeof CheckRunnerSandbox>[0]
    >();
    expectTypeOf<PlatformConfig["SANDBOX"]>().toExtend<
      Parameters<typeof LanderSandbox>[0]
    >();
  });
});

describe("the sandbox Worker's bindings", () => {
  it.effect(
    "are the ones its Env gives its code, at the top level and in every stage",
    () =>
      Effect.gen(function* () {
        const { stages, top } = yield* wranglerOf("../sandbox/wrangler.jsonc");

        const read = {
          bindings: yield* sandboxEnvKeys,
          secrets: [],
          unknown: [],
          vars: [],
        };

        expect(Object.keys(stages)).toStrictEqual(["dev-oscabriel", "demo"]);
        expect({ top, ...stages }).toStrictEqual({
          demo: read,
          "dev-oscabriel": read,
          top: read,
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
