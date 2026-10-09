/**
 * The `DraftRuns` port, and what a draft's run carries across the project's
 * boundary. A proposal made with `draft` (or drafted again with `draftAsk`)
 * writes a `StartDraft` outbox row, which starts one run per round through
 * this port; the run asks the project for its context (`draftContext`),
 * rehearses each attempt's files red first without landing them
 * (`rehearseOpen`, a `Rehearsal`), and reports how it ended
 * (`draftSettled`, a `DraftResult`). The run itself lives with the
 * drafter (`@repo/drafting`), which depends on this package, never the
 * reverse.
 *
 * `DraftRuns` is a `Context.Reference` whose default starts nothing, so
 * every host composes before one provides a real one.
 */
import { AtLeastOne, ConfigFile } from "@repo/protocol/domain/common";
import { PublicPolicy } from "@repo/protocol/domain/policy";
import {
  LandedSha,
  LaneName,
  ProjectName,
  ProposalId,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { Context, Effect, Schema } from "effect";

/** How many rounds one proposal may be drafted in, and attempts one round makes. */
export const DRAFT_ROUNDS = 3;

/** The most of a rehearsal's output its `Refused` carries: the tail, where a failure prints. */
export const EXCERPT_BYTES = 4 * 1024;

/**
 * One draft run: a proposal's round, in its project, with the note its
 * round was asked with. The note travels with the run (the outbox row, then
 * the run's own parameters), since a proposal keeps no note of its own.
 */
export const DraftParams = Schema.Struct({
  note: Schema.optionalKey(Schema.String),
  project: ProjectName,
  proposal: ProposalId,
  round: AtLeastOne,
});

export type DraftParams = typeof DraftParams.Type;

/** What starts a draft's run: the platform's durable run, or nothing by default. */
export interface DraftStarter {
  /** Starts the run for `params`, or finds it started; safe to call twice. */
  readonly start: (params: DraftParams) => Effect.Effect<void>;
}

export const DraftRuns = Context.Reference<DraftStarter>("project/DraftRuns", {
  defaultValue: () => ({ start: () => Effect.void }),
});

/**
 * Why a rehearsal was refused, in the words a drafter can mend: the check
 * failed to load, passed, found no tests, failed two ways, could not run;
 * or the brief was weak, incomplete, or touched the judge.
 */
export const Diagnosis = Schema.Literals([
  "LoadError",
  "Passed",
  "NoTests",
  "Flaky",
  "Blocked",
  "Weak",
  "Brief",
  "Judge",
]);

export type Diagnosis = typeof Diagnosis.Type;

/**
 * A rehearsal of an ask's opening: the gate `accept` runs, without the
 * landing. `Red` says the check failed twice the same way on the composed
 * commit; `Refused` gives the refusal opening would give, why, and the
 * last of the check's output (at most `EXCERPT_BYTES`).
 */
export const Rehearsal = Schema.TaggedUnion({
  Red: {
    lane: LaneName,
    signature: Schema.NonEmptyString,
    tree: TreeSha,
  },
  Refused: {
    diagnosis: Diagnosis,
    excerpt: Schema.String,
    refusal: Refusal,
  },
});

export type Rehearsal = typeof Rehearsal.Type;

/** A drafted ask's last attempt number, and the model that drafted it. */
const attempt = {
  attempts: AtLeastOne.check(Schema.isLessThanOrEqualTo(DRAFT_ROUNDS)),
  model: Schema.NonEmptyString,
};

/**
 * How a draft's round ended: its files rehearsed red first (`Red`, with
 * the drafter's reason for the test), or no attempt did (`Failed`, with
 * the last refusal).
 */
export const DraftResult = Schema.TaggedUnion({
  Failed: { ...attempt, refusal: Refusal },
  Red: {
    ...attempt,
    files: Schema.NonEmptyArray(ConfigFile),
    lane: LaneName,
    rationale: Schema.String,
    signature: Schema.NonEmptyString,
  },
});

export type DraftResult = typeof DraftResult.Type;

/**
 * What a draft's run reads from the project: the landed commit it drafts
 * against, the want and its territory, the public
 * policy (never `visibility`) for the prompt's digest, and every path of
 * the canonical tree at the landed commit, for picking what the drafter
 * reads.
 */
export const DraftContextData = Schema.Struct({
  at: LandedSha,
  paths: Schema.Array(RepoPath),
  policy: PublicPolicy,
  project: ProjectName,
  proposal: ProposalId,
  round: AtLeastOne,
  territory: Schema.optionalKey(Schema.NonEmptyString),
  want: Schema.NonEmptyString,
});

export type DraftContextData = typeof DraftContextData.Type;
