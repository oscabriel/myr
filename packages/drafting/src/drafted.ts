/** `DraftFailed` stays inside the run: it is no public refusal. */
import { Brand } from "@repo/brand";
import { AtLeastOne } from "@repo/protocol/domain/common";
import { AskId, LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Schema, SchemaTransformation } from "effect";

/** Bounded so no reply fills the Worker. */
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(4000));

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
 * Anywhere in the tree but the config folder: the test is the model's own
 * text, so a test path there would land model text as an ask file or policy.
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

export const DraftedAsk = Schema.Struct({
  context: Schema.optionalKey(Schema.Array(Text)),
  current: Schema.optionalKey(Text),
  id: AskId,
  kind: Schema.Literal("fix"),
  outOfScope: Schema.optionalKey(Schema.Array(Text)),
  /** Shown to the maintainer as evidence; never landed. */
  rationale: Schema.String.check(Schema.isMaxLength(4000)),
  territory: Schema.NonEmptyArray(TreePath),
  test: Schema.Struct({
    path: TestPath,
    source: Schema.NonEmptyString.check(Schema.isMaxLength(100_000)),
  }),
  want: Text,
});

export type DraftedAsk = typeof DraftedAsk.Type;

/**
 * A list, or one sentence alone, which decodes as a list of one: Workers AI
 * does not hold a model to the JSON Schema it is asked for.
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

export const DraftedReply = Schema.Struct({
  ...DraftedAsk.fields,
  context: Schema.optionalKey(Sentences),
  outOfScope: Schema.optionalKey(Sentences),
});

export const ContextFile = Schema.Struct({
  content: Schema.String,
  path: RepoPath,
});

export type ContextFile = typeof ContextFile.Type;

export const DraftContext = Schema.Struct({
  at: LandedSha,
  files: Schema.Array(ContextFile),
  policy: Schema.String,
  project: ProjectName,
});

export type DraftContext = typeof DraftContext.Type;

export const DraftInput = Schema.Struct({
  attempt: AtLeastOne,
  context: DraftContext,
  feedback: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  territory: Schema.optionalKey(Schema.NonEmptyString),
  want: Schema.NonEmptyString,
});

export type DraftInput = typeof DraftInput.Type;

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
