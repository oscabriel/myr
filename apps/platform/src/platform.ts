import { Handle } from "@repo/protocol/ids";
import {
  Array,
  Effect,
  Layer,
  Option,
  Order,
  Predicate,
  Redacted,
  Schema,
  SchemaIssue,
} from "effect";

import { workerPorts } from "./ports.ts";
import { MemorySessions } from "./sessions/memory.ts";
import { Stage } from "./surfaces.ts";
import type { Services } from "./surfaces.ts";
import { Vacant } from "./vacant.ts";

/**
 * A binding the runtime hands the Worker: present, and an object. The
 * runtime vouches for the rest of it; the Worker never inspects one further.
 */
const binding = <T>(kind: string) =>
  Schema.declare((input: unknown): input is T => Predicate.isObject(input), {
    expected: kind,
  });

/** A bearer token: long enough that guessing one is hopeless. */
const Token = Schema.String.check(Schema.isMinLength(32));

/**
 * Named sessions: token → handle. A record with a refined key would drop a
 * short token silently, so the whole table is checked instead.
 */
const SessionTable = Schema.Record(Schema.String, Handle).check(
  Schema.makeFilter((table) =>
    Object.keys(table).every((token) => token.length >= 32)
      ? true
      : "every token is at least 32 characters"
  )
);

/** A stage's name (spec §8 D13): `local`, never deployed; `dev-<user>`; `demo`. */
export const StageName = Schema.String.check(
  Schema.isPattern(/^(?:local|demo|dev-[a-z0-9]+(?:-[a-z0-9]+)*)$/u)
);

/** Which Lander lands answers (spec §8 D6): the sandbox's container, or isomorphic-git here. */
export const LanderAdapter = Schema.Literals(["container", "isogit"]);

/** Who signs in with GitHub needs all three, or the stage runs without sign-in. */
const signInKeys = [
  "COOKIE_KEY",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;

/**
 * Everything the platform reads from the Worker's env, decoded once
 * (principle 2): the bindings `wrangler.jsonc` declares, its vars, and the
 * secrets `.env.schema` declares, each redacted. Only `OPERATOR_TOKEN` is
 * required among the secrets; GitHub's two and the cookie key come together
 * or not at all.
 */
export const PlatformEnv = Schema.Struct({
  ANSWER: binding<Env["ANSWER"]>("the Answer Workflow"),
  ARTIFACTS: binding<Env["ARTIFACTS"]>("an Artifacts namespace"),
  CLAIM_LIMIT: binding<Env["CLAIM_LIMIT"]>("a rate limit"),
  COOKIE_KEY: Schema.optionalKey(Schema.RedactedFromValue(Token)),
  EVIDENCE: binding<Env["EVIDENCE"]>("an R2 bucket"),
  FRONT_PAGE: binding<Env["FRONT_PAGE"]>("a D1 database"),
  GITHUB_CLIENT_ID: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  GITHUB_CLIENT_SECRET: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  LANDER_ADAPTER: LanderAdapter.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("container"))
  ),
  LOADER: binding<Env["LOADER"]>("a Worker Loader"),
  OAUTH_KV: binding<Env["OAUTH_KV"]>("a KV namespace"),
  ON_PUSH: binding<Env["ON_PUSH"]>("the OnPush Workflow"),
  OPERATOR_HANDLE: Handle,
  OPERATOR_TOKEN: Schema.RedactedFromValue(Token),
  PROJECT: binding<Env["PROJECT"]>("the Project Durable Object"),
  PROPOSAL_LIMIT: binding<Env["PROPOSAL_LIMIT"]>("a rate limit"),
  SANDBOX: binding<Env["SANDBOX"]>("the sandbox Worker"),
  /** Named sessions until sign-in exists (spec §8 D9): JSON, token → handle. */
  SESSION_TOKENS: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.fromJsonString(SessionTable))
  ),
  STAGE: StageName,
}).check(
  Schema.makeFilter((env) => {
    const missing = signInKeys.flatMap((key) =>
      env[key] === undefined ? [key] : []
    );

    return missing.length === 0 || missing.length === signInKeys.length
      ? true
      : missing.map((key) => ({
          issue: "set with the other sign-in keys, or none of them",
          path: [key],
        }));
  })
);

export type PlatformConfig = typeof PlatformEnv.Type;

/**
 * The Worker's env cannot run the platform. It names the keys only: a value
 * that failed to decode may be a secret.
 */
export class InvalidEnv extends Schema.TaggedError<InvalidEnv>()("InvalidEnv", {
  keys: Schema.Array(Schema.String),
}) {}

/**
 * The top-level key of every issue, once each: a deeper path (a session
 * table's token) may itself be secret.
 */
const failingKeys = (issue: SchemaIssue.Issue) =>
  Array.sort(
    Array.dedupe(
      SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues.flatMap(
        ({ path = [] }) => path.slice(0, 1).map(String)
      )
    ),
    Order.String
  );

/** The Worker's env, decoded once: every key that fails is named together. */
export const decodeEnv = (env: Env) =>
  Schema.decodeUnknownEffect(PlatformEnv, { errors: "all" })(env).pipe(
    Effect.mapError(({ issue }) => new InvalidEnv({ keys: failingKeys(issue) }))
  );

/**
 * Who may call: the operator, and each named session in `SESSION_TOKENS`.
 * The operator's token wins if both name one.
 */
const sessionsOf = (config: PlatformConfig) => {
  const named = Option.match(Option.fromUndefinedOr(config.SESSION_TOKENS), {
    onNone: () => ({}),
    onSome: Redacted.value,
  });

  return MemorySessions.layer({
    ...named,
    [Redacted.value(config.OPERATOR_TOKEN)]: config.OPERATOR_HANDLE,
  });
};

/**
 * The surfaces' services from the Worker's env, decoded once: the contracts
 * (`Vacant` until 317 composes the handlers), sessions, the stage, and the
 * ports, which are stubs until 317 wires them.
 */
export const platform = (env: Env): Layer.Layer<Services, InvalidEnv> =>
  Layer.unwrap(
    decodeEnv(env).pipe(
      Effect.map((config) =>
        Layer.mergeAll(
          Vacant,
          sessionsOf(config),
          workerPorts(config),
          Layer.succeed(Stage, Stage.of({ name: config.STAGE }))
        )
      )
    )
  );
