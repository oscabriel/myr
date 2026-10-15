import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha } from "@repo/protocol/ids";
import { Handle, ProjectName, RepoPath } from "@repo/protocol/ids";
import { ClaimantFacts } from "@repo/sdk/functions";
import { Context, Effect, Schema } from "effect";

/** An empty `modules` means the project has no config folder, so it runs on the defaults. */
export const ConfigBundle = Schema.Struct({
  /**
   * The project module's path, `<folder>/project.ts`, whether or not the
   * folder has one: it names the folder the asks and `policy.json` sit in.
   */
  entry: Schema.NonEmptyString,
  modules: Schema.Record(Schema.String, Schema.String),
  sdkVersion: Schema.NonEmptyString,
});

export type ConfigBundle = typeof ConfigBundle.Type;

/** Callers that may not import the sdk (`@repo/project`) read it here. */
export { sdkVersion } from "@repo/sdk";

const Workspace = Schema.Struct({
  dir: Schema.String,
  exports: Schema.Array(RepoPath),
  name: Schema.NonEmptyString,
});

/** Rule code never reads the repo, the network or the clock: the same facts always give the same policy. */
export const EvaluationFacts = Schema.Struct({
  ci: Schema.Array(Schema.Struct({ content: Schema.String, path: RepoPath })),
  initializer: Handle,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  seed: Schema.Int,
  vouchFile: Schema.optionalKey(Schema.String),
  workspaces: Schema.Array(Workspace),
});

export type EvaluationFacts = typeof EvaluationFacts.Type;

/** The policy then stays on the previous landed commit. */
export class RulesFailed extends Schema.TaggedError<RulesFailed>()(
  "RulesFailed",
  {
    detail: Schema.String,
    reason: Schema.Literals(["load", "timeout", "decode", "threw"]),
  }
) {}

export const RuleName = Schema.Literals(["admit"]);

export type RuleName = typeof RuleName.Type;

export interface RuleCall {
  readonly rule: "admit";
  readonly facts: ClaimantFacts;
}

// The facts were typed by the same schema, so encoding them can't fail.
export const factsOf = (call: RuleCall): Effect.Effect<Schema.Json> =>
  Effect.orDie(Schema.encodeEffect(ClaimantFacts)(call.facts));

export class RulesEvaluator extends Context.Service<
  RulesEvaluator,
  {
    readonly call: (
      input: RuleCall & {
        readonly at: LandedSha;
        readonly modules: ConfigBundle;
      }
    ) => Effect.Effect<boolean, RulesFailed>;
    readonly evaluate: (input: {
      readonly at: LandedSha;
      readonly facts: EvaluationFacts;
      readonly modules: ConfigBundle;
    }) => Effect.Effect<Policy, RulesFailed>;
  }
>()("rules/RulesEvaluator") {}
