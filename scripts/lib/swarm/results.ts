/**
 * The swarm run's summary: one `AgentRun` per contributor, written to
 * `.swarm/<run>/agents.json` (gitignored). A live issue records what a run
 * shows in its own notes; nothing here is committed.
 *
 * Every field follows the wire rule (AGENTS.md "Effect traps"): `Schema.Int`
 * or `Schema.Finite` for numbers, `Schema.optionalKey` for optional keys.
 */
import { Context, Effect, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";

/**
 * The swarm's folder, `.swarm/` at the repo root (beside `scripts/`), unless
 * a test points it elsewhere. Each run writes below it: `<run>/agents.json`
 * and one workspace per contributor, `<run>/<handle>/`.
 */
export const SwarmDir = Context.Reference<string>("swarm/SwarmDir", {
  defaultValue: () =>
    decodeURIComponent(new URL("../../../.swarm", import.meta.url).pathname),
});

/** A run's own folder: `.swarm/<run>`. */
export const runDir = (run: string) =>
  Effect.map(SwarmDir, (dir) => `${dir}/${run}`);

/** The four harnesses a swarm contributor may run. */
export const Harness = Schema.Literals([
  "claude-code",
  "opencode",
  "amp",
  "pi",
]);

export type Harness = typeof Harness.Type;

/**
 * How one contributor's run ended: its answer landed, was refused (and the
 * continuations ran out), waits on a person (`AwaitingFinish`,
 * `AwaitingDecision`), was never pushed, ran past its timeout, or the run
 * itself failed (a claim refused, a harness that did not start).
 */
export const AgentOutcome = Schema.Literals([
  "landed",
  "refused",
  "waiting",
  "noAnswer",
  "timedOut",
  "failed",
]);

export type AgentOutcome = typeof AgentOutcome.Type;

/** One contributor's run. */
export const AgentRun = Schema.Struct({
  adapter: Schema.Boolean,
  ask: Schema.NonEmptyString,
  /** Harness sessions started or resumed: the first run and each continuation. */
  attempts: Schema.Int,
  durationMs: Schema.Int,
  handle: Schema.NonEmptyString,
  harness: Harness,
  /** The landing commit, when the answer landed. */
  landed: Schema.optionalKey(Schema.NonEmptyString),
  model: Schema.NonEmptyString,
  outcome: AgentOutcome,
  /** Each refusal's `_tag`, with how often it came back across the attempts. */
  refusals: Schema.Record(Schema.String, Schema.Int),
});

export type AgentRun = typeof AgentRun.Type;

/** A whole run: where it ran, from which commit, and each contributor's run. */
export const AgentsResult = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  /** The commit of this repo the swarm ran from. */
  commit: Schema.NonEmptyString,
  project: Schema.NonEmptyString,
  runs: Schema.Array(AgentRun),
  scenario: Schema.NonEmptyString,
  stage: Schema.NonEmptyString,
  v: Schema.Literal(1),
});

export type AgentsResult = typeof AgentsResult.Type;

/** The file a run's summary is written to, below the swarm's folder. */
export const agentsFile = (dir: string) => `${dir}/agents.json`;

/** Writes `result` to `.swarm/<run>/agents.json`, as indented JSON. */
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
