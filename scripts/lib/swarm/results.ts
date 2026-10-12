import { Brand } from "@repo/brand";
import { Context, Effect, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect";

const StateEnv = Schema.Struct({
  HOME: Schema.optionalKey(Schema.NonEmptyString),
  XDG_STATE_HOME: Schema.optionalKey(Schema.NonEmptyString),
});

// Never inside a checkout: a harness reads every AGENTS.md and CLAUDE.md above its folder.
export const swarmDirOf = (env: typeof StateEnv.Type) => {
  const home = env.HOME === undefined ? "/tmp" : `${env.HOME}/.local/state`;

  return `${env.XDG_STATE_HOME ?? home}/${Brand.slug}/swarm`;
};

const GlobalScope = Schema.Struct({
  process: Schema.Struct({ env: StateEnv }),
});

export const SwarmDir = Context.Reference<string>("swarm/SwarmDir", {
  defaultValue: () => {
    // Unknown on purpose: the runtime is whatever started this process.
    const scope: unknown = globalThis;

    return swarmDirOf(
      Option.match(Schema.decodeUnknownOption(GlobalScope)(scope), {
        onNone: () => ({}),
        onSome: ({ process }) => process.env,
      })
    );
  },
});

export const runDir = (run: string) =>
  Effect.map(SwarmDir, (dir) => `${dir}/${run}`);

export const Harness = Schema.Literals([
  "claude-code",
  "opencode",
  "amp",
  "pi",
]);

export type Harness = typeof Harness.Type;

export const AgentOutcome = Schema.Literals([
  "landed",
  "refused",
  "waiting",
  "noAnswer",
  "timedOut",
  "failed",
]);

export type AgentOutcome = typeof AgentOutcome.Type;

export const AgentRun = Schema.Struct({
  adapter: Schema.Boolean,
  ask: Schema.NonEmptyString,
  attempts: Schema.Int,
  durationMs: Schema.Int,
  handle: Schema.NonEmptyString,
  harness: Harness,
  landed: Schema.optionalKey(Schema.NonEmptyString),
  model: Schema.NonEmptyString,
  outcome: AgentOutcome,
  refusals: Schema.Record(Schema.String, Schema.Int),
});

export type AgentRun = typeof AgentRun.Type;

export const AgentsResult = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  commit: Schema.NonEmptyString,
  project: Schema.NonEmptyString,
  runs: Schema.Array(AgentRun),
  scenario: Schema.NonEmptyString,
  stage: Schema.NonEmptyString,
  v: Schema.Literal(1),
});

export type AgentsResult = typeof AgentsResult.Type;

export const agentsFile = (dir: string) => `${dir}/agents.json`;

export const writeAgentsResult = (input: {
  readonly run: string;
  readonly result: AgentsResult;
}): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* runDir(input.run);

    // An `AgentsResult` value always encodes: strings, numbers and a DateTime.
    const encoded = yield* Schema.encodeEffect(AgentsResult)(input.result).pipe(
      Effect.orDie
    );

    yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(
      agentsFile(dir),
      `${JSON.stringify(encoded, null, 2)}\n`
    );
  });
