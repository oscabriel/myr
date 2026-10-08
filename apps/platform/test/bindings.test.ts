/**
 * The binding fence: what each Worker's code reads from its env and what its
 * `wrangler.jsonc` declares are one set, at the top level and in every
 * stage, since Wrangler does not inherit bindings into an environment. A
 * binding added or removed on one side only fails here; one removed from
 * `wrangler.jsonc` and regenerated (`bun run types`) also fails `typecheck`
 * where the code reads it.
 */
import { NodeServices } from "@effect/platform-node";
import type { D1Client } from "@effect/sql-d1";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { RepoHostBinding } from "@repo/artifacts/repo-host/binding";
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

/** The offset just past the string literal that opens at `start`. */
const stringEnd = (text: string, start: number) => {
  let at = start + 1;

  while (at < text.length && text[at] !== '"') {
    at += text[at] === "\\" ? 2 : 1;
  }

  return at + 1;
};

/** Where the token that opens at `at` ends: a string literal, a comment, or one character. */
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

/** `text` cut into its tokens, so nothing below looks inside a string. */
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

/** Whether the next token after `tokens[index]` that is not whitespace closes a bracket. */
const closesAfter = (tokens: readonly string[], index: number) => {
  const next = tokens.find((token, at) => at > index && token.trim() !== "");

  return next === "]" || next === "}";
};

/**
 * `text` (JSONC, as `wrangler.jsonc` is written) as JSON: its comments
 * dropped first, then each comma that only a closing bracket follows, so a
 * comment between the two hides nothing; every string is kept whole.
 */
const fromJsonc = (text: string) => {
  const tokens = tokensOf(text).filter((token) => !isComment(token));

  return tokens
    .filter((token, index) => token !== "," || !closesAfter(tokens, index))
    .join("");
};

const Bound = Schema.Array(Schema.Struct({ binding: Schema.String }));

const Named = Schema.Array(Schema.Struct({ name: Schema.String }));

/**
 * The keys of a block that declare bindings, each with how it names them.
 * A key that is neither here nor in `NOT_BINDINGS` fails the test: whoever
 * adds it says which it is.
 */
const BindingKinds = Schema.Struct({
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

/** The keys a block may carry that declare no binding. */
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

/** One block: the top level, or a stage's. */
const Block = Schema.Struct({
  ...BindingKinds.fields,
  secrets: Schema.optionalKey(
    Schema.Struct({ required: Schema.Array(Schema.String) })
  ),
  vars: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** A config as data: its blocks are read one key at a time. */
const Raw = Schema.Record(Schema.String, Schema.Unknown);

/** A config's text, JSONC as `wrangler.jsonc` is written, as data. */
const readJsonc = (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(Raw))(fromJsonc(text));

/** The stages' blocks, by name. */
const Staged = Schema.Struct({
  env: Schema.optionalKey(Schema.Record(Schema.String, Raw)),
});

const decodeBlock = Schema.decodeUnknownEffect(Block);

const sorted = (names: Iterable<string>) =>
  Array.sort(Array.fromIterable(names), Order.String);

/** What one block declares: its bindings, vars and required secrets, each sorted, and any key this test does not know. */
const declaredIn = (raw: typeof Raw.Type) =>
  Effect.map(decodeBlock(raw), (block) => ({
    bindings: sorted([
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

/** A file of this repo, by its path from `apps/platform`. */
const fileText = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(new URL(`../${path}`, import.meta.url).pathname)
  );

/** What the `wrangler.jsonc` at `path` declares, by block: `top` and each stage. */
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

/** A struct's keys, sorted; `required` leaves out its optional ones. */
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

/**
 * The bindings the sandbox's code reads from its env: the members of the
 * `Env` its generated types give it (`bun run types` in `apps/sandbox`).
 */
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

  it("are all the Env the Worker is given, and nothing else", () => {
    expectTypeOf<keyof Env>().toEqualTypeOf<
      Exclude<
        keyof PlatformConfig,
        "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SESSION_TOKENS"
      >
    >();
  });

  // Principle 7: this Worker binds the private namespace deliberately (W6);
  // the web's `test/env.test-d.ts` holds that no public-serving Worker does.
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
    expectTypeOf<Env["FRONT_PAGE"]>().toExtend<
      Parameters<typeof D1Client.layer>[0]["db"]
    >();
    expectTypeOf<Env["OAUTH_KV"]>().toExtend<
      Parameters<typeof tokenReader>[0]
    >();
    expectTypeOf<Env["SIGN_IN_LIMIT"]>().toExtend<
      Parameters<typeof SignInAttemptsBinding>[0]
    >();
  });

  it("type the sandbox service binding by the entrypoint the platform calls", () => {
    // The generated `Env` types `SANDBOX` as a plain `Fetcher` (an app's
    // types may not name another app's entrypoint), so the env's decode
    // declares the entrypoint's methods on it (314's `SandboxBinding`). Should
    // `Env` ever carry them, or turn `any`, the first line fails: drop the
    // declaration, or find what made the binding untyped.
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
