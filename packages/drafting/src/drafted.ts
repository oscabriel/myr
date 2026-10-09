/**
 * What drafting reads and writes. The model returns `DraftedAsk`, fields
 * only: code renders the ask file from them, so only the test file is the
 * model's own text. `DraftContext` is what it reads, from the canonical
 * repo at the landed commit (never a layer's), and `DraftInput` one
 * attempt's question. `DraftFailed` stays inside the run: it is no public
 * refusal.
 */
import { AtLeastOne } from "@repo/protocol/domain/common";
import { AskId, LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Schema } from "effect";

/** A string the model writes, bounded so no reply fills the Worker. */
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(4000));

/** One ask, drafted: only `fix` asks are drafted. */
export const DraftedAsk = Schema.Struct({
  context: Schema.optionalKey(Schema.Array(Text)),
  current: Schema.optionalKey(Text),
  /** Becomes `<config>/asks/<id>.ask.ts`. */
  id: AskId,
  kind: Schema.Literal("fix"),
  outOfScope: Schema.optionalKey(Schema.Array(Text)),
  /** Shown to the decider as evidence; never landed. */
  rationale: Schema.String.check(Schema.isMaxLength(4000)),
  /** The files an answer may change. */
  territory: Schema.NonEmptyArray(RepoPath),
  /** The ask's check: a test that fails on main by an assertion. */
  test: Schema.Struct({
    path: RepoPath,
    source: Schema.NonEmptyString.check(Schema.isMaxLength(100_000)),
  }),
  /** One testable sentence. */
  want: Text,
});

export type DraftedAsk = typeof DraftedAsk.Type;

/** One file the drafter reads, as text. */
export const ContextFile = Schema.Struct({
  content: Schema.String,
  path: RepoPath,
});

export type ContextFile = typeof ContextFile.Type;

/**
 * What a draft reads: the project's public policy as a short digest, and
 * the files picked from its canonical tree at the landed commit.
 */
export const DraftContext = Schema.Struct({
  at: LandedSha,
  files: Schema.Array(ContextFile),
  policy: Schema.String,
  project: ProjectName,
});

export type DraftContext = typeof DraftContext.Type;

/** One attempt's question: the want, what it reads, and what went wrong before. */
export const DraftInput = Schema.Struct({
  attempt: AtLeastOne,
  context: DraftContext,
  /** The last attempt's refusal and its output's tail, for the next to mend. */
  feedback: Schema.optionalKey(Schema.String),
  /** A decider's or the proposer's note on what to do differently. */
  note: Schema.optionalKey(Schema.String),
  territory: Schema.optionalKey(Schema.NonEmptyString),
  want: Schema.NonEmptyString,
});

export type DraftInput = typeof DraftInput.Type;

/**
 * The model gave no draft: its reply was no JSON, or not the schema's, it
 * was rate-limited, or it failed.
 */
export class DraftFailed extends Schema.TaggedError<DraftFailed>()(
  "DraftFailed",
  {
    reason: Schema.Literals([
      "unparseable",
      "schema",
      "rate-limited",
      "model-error",
    ]),
  }
) {}
