/**
 * What drafting reads and writes. The model returns `DraftedAsk`, fields
 * only: code renders the ask file from them, so only the test file is the
 * model's own text. `DraftContext` is what it reads, from the canonical
 * repo at the landed commit (never a layer's), and `DraftInput` one
 * attempt's question. `DraftFailed` stays inside the run: it is no public
 * refusal.
 */
import { Brand } from "@repo/brand";
import { AtLeastOne } from "@repo/protocol/domain/common";
import { AskId, LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Schema, SchemaTransformation } from "effect";

/** A string the model writes, bounded so no reply fills the Worker. */
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(4000));

/** A path in the tree as git names it: relative, with no empty, `.` or `..` segment. */
const TreePath = RepoPath.check(
  Schema.makeFilter(
    (path: string) =>
      path
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== ".."
        )
        ? true
        : `${path} is not a path inside the tree`,
    { expected: "a relative path inside the tree" }
  )
);

/**
 * Where the drafted test goes: anywhere in the tree but the config folder,
 * which only code writes. The test is the model's own text, so a test path
 * there would land model text as an ask file or the project's policy.
 */
const TestPath = TreePath.check(
  Schema.makeFilter(
    (path: string) =>
      path.startsWith(`${Brand.configDir}/`)
        ? `${path} is in ${Brand.configDir}/, which only code writes`
        : true,
    { expected: `a path outside ${Brand.configDir}/` }
  )
);

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
  territory: Schema.NonEmptyArray(TreePath),
  /** The ask's check: a test that fails on main by an assertion. */
  test: Schema.Struct({
    path: TestPath,
    source: Schema.NonEmptyString.check(Schema.isMaxLength(100_000)),
  }),
  /** One testable sentence. */
  want: Text,
});

export type DraftedAsk = typeof DraftedAsk.Type;

/**
 * Sentences as a model may send them: a list, or one sentence alone, which
 * decodes as a list of one. Workers AI does not hold a model to the JSON
 * Schema it is asked for: kimi-k2.7-code sent `context` and `outOfScope` as
 * strings on every attempt (914, live on dev-oscabriel).
 */
const Sentences = Schema.Union([
  Schema.Array(Text),
  Text.pipe(
    Schema.decodeTo(
      Schema.Array(Text),
      SchemaTransformation.transform({
        decode: (one: string): readonly string[] => [one],
        encode: (all) => all.join("\n"),
      })
    )
  ),
]);

/**
 * A model's reply, decoded into a `DraftedAsk`: the same fields, but a
 * list of sentences may come as one sentence. The model is still asked for
 * `DraftedAsk`'s JSON Schema.
 */
export const DraftedReply = Schema.Struct({
  ...DraftedAsk.fields,
  context: Schema.optionalKey(Sentences),
  outOfScope: Schema.optionalKey(Sentences),
});

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
