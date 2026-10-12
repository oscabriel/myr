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
import type { WorkerPorts } from "./ports.ts";
import { ReleaseStoreBinding } from "./releases/binding.ts";
import { Sessions } from "./sessions.ts";
import { firstOf } from "./sessions/first-of.ts";
import { sessionTable } from "./sessions/table.ts";
import { HostInfo, Stage } from "./surfaces.ts";
import type { Services } from "./surfaces.ts";

const binding = <T>(kind: string) =>
  Schema.declare((input: unknown): input is T => Predicate.isObject(input), {
    expected: kind,
  });

const Token = Schema.String.check(Schema.isMinLength(32));

const HexKey = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/iu));

// A record with a refined key would drop a short token silently, so the whole
// table is checked instead.
const SessionTable = Schema.Record(Schema.String, Handle).check(
  Schema.makeFilter((table) =>
    Object.keys(table).every((token) => token.length >= 32)
      ? true
      : "every token is at least 32 characters"
  )
);

export const StageName = Schema.String.check(
  Schema.isPattern(/^(?:local|demo|prod|dev-[a-z0-9]+(?:-[a-z0-9]+)*)$/u)
);

export const LanderAdapter = Schema.Literals(["container", "isogit"]);

export const PlatformBindings = Schema.Struct({
  AI: binding<Env["AI"]>("Workers AI"),
  ANSWER: binding<Env["ANSWER"]>("the Answer Workflow"),
  ARTIFACTS: binding<Env["ARTIFACTS"]>("an Artifacts namespace"),
  ARTIFACTS_PRIVATE: binding<Env["ARTIFACTS_PRIVATE"]>(
    "the private Artifacts namespace"
  ),
  CLAIM_LIMIT: binding<Env["CLAIM_LIMIT"]>("a rate limit"),
  CODE_CACHE: binding<Env["CODE_CACHE"]>("an R2 bucket"),
  DRAFT_LIMIT: binding<Env["DRAFT_LIMIT"]>("a rate limit"),
  EMAIL: binding<Env["EMAIL"]>("Email Service's send_email"),
  EVIDENCE: binding<Env["EVIDENCE"]>("an R2 bucket"),
  FRONT_PAGE: binding<Env["FRONT_PAGE"]>("a D1 database"),
  LOADER: binding<Env["LOADER"]>("a Worker Loader"),
  OAUTH_KV: binding<Env["OAUTH_KV"]>("a KV namespace"),
  ON_PUSH: binding<Env["ON_PUSH"]>("the OnPush Workflow"),
  PROJECT: binding<Env["PROJECT"]>("the Project Durable Object"),
  PROPOSAL_LIMIT: binding<Env["PROPOSAL_LIMIT"]>("a rate limit"),
  RELEASES: binding<Env["RELEASES"]>("an R2 bucket"),
  // The generated `Env` types this as a plain `Fetcher` (an app's types may not name
  // another app's entrypoint), so its methods are declared here by their wire.
  SANDBOX: binding<Env["SANDBOX"] & SandboxBinding>("the sandbox Worker"),
  SIGN_IN_LIMIT: binding<Env["SIGN_IN_LIMIT"]>("a rate limit"),
});

export const PlatformVars = Schema.Struct({
  DRAFT_MODEL: Schema.NonEmptyString,
  LANDER_ADAPTER: LanderAdapter.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("container"))
  ),
  OPERATOR_HANDLE: Handle,
  PUBLIC_WEB_URL: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^https?:\/\//u))
  ),
  STAGE: StageName,
});

export const PlatformSecrets = Schema.Struct({
  COOKIE_KEY: Schema.RedactedFromValue(Token),
  // Not secret: Google shows it to everyone who signs in.
  GOOGLE_CLIENT_ID: Schema.optionalKey(Schema.NonEmptyString),
  GOOGLE_CLIENT_SECRET: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  // Wraps the data key of every write-only env value: losing it loses every value.
  MASTER_KEY: Schema.RedactedFromValue(HexKey),
  OPERATOR_TOKEN: Schema.RedactedFromValue(Token),
  PASSWORD_PEPPER: Schema.RedactedFromValue(Token),
  SESSION_TOKENS: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.fromJsonString(SessionTable))
  ),
});

const googlePair = Schema.makeFilter(
  (env: {
    readonly GOOGLE_CLIENT_ID?: string;
    readonly GOOGLE_CLIENT_SECRET?: Redacted.Redacted;
  }) => {
    const id = env.GOOGLE_CLIENT_ID !== undefined;

    const secret = env.GOOGLE_CLIENT_SECRET !== undefined;

    if (id === secret) {
      return true;
    }

    return {
      issue: "Google's client id and secret are set together or not at all",
      path: [id ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID"],
    };
  }
);

export const PlatformEnv = Schema.Struct({
  ...PlatformBindings.fields,
  ...PlatformVars.fields,
  ...PlatformSecrets.fields,
}).check(googlePair);

export type PlatformConfig = typeof PlatformEnv.Type;

// Names the keys only: a value that failed to decode may be a secret.
export class InvalidEnv extends Schema.TaggedError<InvalidEnv>()("InvalidEnv", {
  keys: Schema.Array(Schema.String),
}) {}

// Top-level keys only: a deeper path (a session table's token) may itself be secret.
const failingKeys = (issue: SchemaIssue.Issue) =>
  Array.sort(
    Array.dedupe(
      SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues.flatMap(
        ({ path = [] }) => path.slice(0, 1).map(String)
      )
    ),
    Order.String
  );

export const decodeEnv = (env: Env) =>
  Schema.decodeUnknownEffect(PlatformEnv, { errors: "all" })(env).pipe(
    Effect.mapError(({ issue }) => new InvalidEnv({ keys: failingKeys(issue) }))
  );

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

export const platformOn = (
  config: PlatformConfig,
  ports: Layer.Layer<WorkerPorts>
): Layer.Layer<Services> =>
  Layer.mergeAll(
    Handlers,
    sessionsOf(config),
    ReleaseStoreBinding(config.RELEASES),
    Layer.succeed(Stage, Stage.of({ name: config.STAGE })),
    Layer.succeed(
      HostInfo,
      HostInfo.of({
        draftModel: config.DRAFT_MODEL,
        webUrl: Option.fromUndefinedOr(config.PUBLIC_WEB_URL),
      })
    )
  ).pipe(Layer.provideMerge(ports));

export const platformOf = (config: PlatformConfig): Layer.Layer<Services> =>
  platformOn(config, workerPorts(config));

export const platform = (env: Env): Layer.Layer<Services, InvalidEnv> =>
  Layer.unwrap(decodeEnv(env).pipe(Effect.map(platformOf)));
