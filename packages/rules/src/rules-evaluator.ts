import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha } from "@repo/protocol/ids";
import { Handle, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/**
 * The config folder as it stood at one landed commit, ready to evaluate.
 * `modules` maps each file's repo path (`<folder>/project.ts`,
 * `<folder>/asks/<id>.ask.ts`, `<folder>/policy.json`) to its source. An
 * empty `modules` means the project has no config folder, so it runs on the
 * defaults.
 */
export const ConfigBundle = Schema.Struct({
  /**
   * The project module's path, `<folder>/project.ts`, whether or not the
   * folder has one: it names the folder the asks and `policy.json` sit in.
   */
  entry: Schema.NonEmptyString,
  modules: Schema.Record(Schema.String, Schema.String),
  /** The rules package version the folder was written against. */
  sdkVersion: Schema.NonEmptyString,
});

export type ConfigBundle = typeof ConfigBundle.Type;

/** One workspace package, as the repo's manifests declare it. */
const Workspace = Schema.Struct({
  /** Its folder, from the repo's root: `packages/parse`. */
  dir: Schema.String,
  /** The files its `exports` name, from the repo's root. */
  exports: Schema.Array(RepoPath),
  name: Schema.NonEmptyString,
});

/**
 * Everything rule code may know about the project, injected by the platform:
 * rule code never reads the repo, the network or the clock. The same facts
 * always give the same policy (principle 8).
 */
export const EvaluationFacts = Schema.Struct({
  /** The project's CI and hook files, where a `run: fromCI` block is found. */
  ci: Schema.Array(Schema.Struct({ content: Schema.String, path: RepoPath })),
  /** The person who made the project; `owners` resolves to them (spec D20). */
  initializer: Handle,
  /** The frozen clock rule code sees, and when its asks count as opened. */
  now: Schema.DateTimeUtcFromString,
  /** The project the asks belong to. */
  project: ProjectName,
  /** The frozen randomness rule code sees. */
  seed: Schema.Int,
  /** The vouch file's text, when the project has one. */
  vouchFile: Schema.optionalKey(Schema.String),
  workspaces: Schema.Array(Workspace),
});

export type EvaluationFacts = typeof EvaluationFacts.Type;

/**
 * Why the config folder gave no policy: it would not load, it ran past its
 * time limit, what it exported is not a policy, or its code threw. The
 * policy then stays on the previous landed commit.
 */
export class RulesFailed extends Schema.TaggedError<RulesFailed>()(
  "RulesFailed",
  {
    detail: Schema.String,
    reason: Schema.Literals(["load", "timeout", "decode", "threw"]),
  }
) {}

/** The function-valued rules, called on demand rather than read as data. */
export const RuleName = Schema.Literals(["opensAlone", "admit"]);

export type RuleName = typeof RuleName.Type;

/**
 * Turns the config folder at a landed commit into its `Policy`, the same
 * one every time for the same facts, and calls its function-valued rules on
 * demand. Adapters: `/bun` (a subprocess with frozen time), `/json` (a
 * committed `policy.json`, or the defaults) and, in W3, `/worker`.
 */
export class RulesEvaluator extends Context.Service<
  RulesEvaluator,
  {
    readonly call: (input: {
      readonly at: LandedSha;
      readonly facts: Schema.Json;
      readonly modules: ConfigBundle;
      readonly rule: RuleName;
    }) => Effect.Effect<boolean, RulesFailed>;
    readonly evaluate: (input: {
      readonly at: LandedSha;
      readonly facts: EvaluationFacts;
      readonly modules: ConfigBundle;
    }) => Effect.Effect<Policy, RulesFailed>;
  }
>()("rules/RulesEvaluator") {}
