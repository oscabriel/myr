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

import type { SandboxBinding } from "./adapters/check-runner-sandbox.ts";
import { OAuthSessions } from "./adapters/sessions-oauth.ts";
import { tokenReader } from "./auth/provider.ts";
import { Handlers } from "./handlers.ts";
import { workerPorts } from "./ports.ts";
import { Sessions } from "./sessions.ts";
import { firstOf } from "./sessions/first-of.ts";
import { sessionTable } from "./sessions/table.ts";
import { Stage } from "./surfaces.ts";
import type { Services } from "./surfaces.ts";

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

/**
 * The bindings `wrangler.jsonc` declares, at the top level and in every
 * stage block (`test/bindings.test.ts` holds the two sets equal). Each is
 * typed by the generated `Env`, so a binding removed from `wrangler.jsonc`
 * fails `typecheck` here and wherever it is used.
 */
export const PlatformBindings = Schema.Struct({
  ANSWER: binding<Env["ANSWER"]>("the Answer Workflow"),
  ARTIFACTS: binding<Env["ARTIFACTS"]>("an Artifacts namespace"),
  CLAIM_LIMIT: binding<Env["CLAIM_LIMIT"]>("a rate limit"),
  EVIDENCE: binding<Env["EVIDENCE"]>("an R2 bucket"),
  FRONT_PAGE: binding<Env["FRONT_PAGE"]>("a D1 database"),
  LOADER: binding<Env["LOADER"]>("a Worker Loader"),
  OAUTH_KV: binding<Env["OAUTH_KV"]>("a KV namespace"),
  ON_PUSH: binding<Env["ON_PUSH"]>("the OnPush Workflow"),
  PROJECT: binding<Env["PROJECT"]>("the Project Durable Object"),
  PROPOSAL_LIMIT: binding<Env["PROPOSAL_LIMIT"]>("a rate limit"),
  /**
   * A service binding to the sandbox Worker's default entrypoint. The
   * generated `Env` types it as a plain `Fetcher`, since this app's types
   * may not name another app's entrypoint, so its methods are declared here
   * by their wire (`SandboxBinding`, the shape a type test holds the
   * entrypoint to).
   */
  SANDBOX: binding<Env["SANDBOX"] & SandboxBinding>("the sandbox Worker"),
  SIGN_IN_LIMIT: binding<Env["SIGN_IN_LIMIT"]>("a rate limit"),
});

/** The vars `wrangler.jsonc` sets in every block. */
export const PlatformVars = Schema.Struct({
  LANDER_ADAPTER: LanderAdapter.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("container"))
  ),
  OPERATOR_HANDLE: Handle,
  STAGE: StageName,
});

/**
 * The secrets `.env.schema` declares, each redacted. Every one but
 * `SESSION_TOKENS` is required (`wrangler.jsonc`'s `secrets.required`):
 * sign-in's cookie key and pepper too, since accounts are the platform's
 * own.
 */
export const PlatformSecrets = Schema.Struct({
  /** Seals a sign-in in progress into its form (`auth/state.ts`). */
  COOKIE_KEY: Schema.RedactedFromValue(Token),
  OPERATOR_TOKEN: Schema.RedactedFromValue(Token),
  /** HMAC'd with every password before PBKDF2 (`auth/password.ts`). */
  PASSWORD_PEPPER: Schema.RedactedFromValue(Token),
  /** Named sessions beside accounts (spec §8 D9): JSON, token → handle. */
  SESSION_TOKENS: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.fromJsonString(SessionTable))
  ),
});

/**
 * Everything the platform reads from the Worker's env, decoded once
 * (principle 2): its bindings, its vars and its secrets.
 */
export const PlatformEnv = Schema.Struct({
  ...PlatformBindings.fields,
  ...PlatformVars.fields,
  ...PlatformSecrets.fields,
});

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
 * Who may call (spec §8 D9, D23), as one `Sessions`: an access token the
 * platform's OAuth server issued names the person who signed in; otherwise
 * the operator's token names the operator, and each named session in
 * `SESSION_TOKENS` its handle (the operator's wins if both name one).
 */
const sessionsOf = (config: PlatformConfig) =>
  Layer.sync(Sessions, () =>
    firstOf([
      OAuthSessions(tokenReader(config.OAUTH_KV)),
      sessionTable([
        { handle: config.OPERATOR_HANDLE, token: config.OPERATOR_TOKEN },
        ...Option.match(Option.fromUndefinedOr(config.SESSION_TOKENS), {
          onNone: () => [],
          onSome: (table) =>
            Object.entries(Redacted.value(table)).map(([token, handle]) => ({
              handle,
              token: Redacted.make(token),
            })),
        }),
      ]),
    ])
  );

/**
 * The surfaces' services from the decoded env: every contract's handler,
 * sessions, the stage, and the ports they run on, each over its binding.
 */
export const platformOf = (config: PlatformConfig): Layer.Layer<Services> =>
  Layer.mergeAll(
    Handlers,
    sessionsOf(config),
    Layer.succeed(Stage, Stage.of({ name: config.STAGE }))
  ).pipe(Layer.provideMerge(workerPorts(config)));

/** The surfaces' services from the Worker's env, decoded once. */
export const platform = (env: Env): Layer.Layer<Services, InvalidEnv> =>
  Layer.unwrap(decodeEnv(env).pipe(Effect.map(platformOf)));
