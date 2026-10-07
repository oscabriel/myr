import type { Glob } from "@repo/protocol/domain/common";
import { FromCI, Policy } from "@repo/protocol/domain/policy";
import type { PolicyInput } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import type { LandedSha, RepoPath } from "@repo/protocol/ids";
import { Context, DateTime, Effect, Schema } from "effect";

import { failedAt } from "./config-folder.ts";
import { RulesFailed } from "./rules-evaluator.ts";
import type { EvaluationFacts } from "./rules-evaluator.ts";
import { parseVouchFile } from "./vouch.ts";

/** A file the finishers read: a CI workflow, a hook config, a manifest. */
export interface FactFile {
  readonly content: string;
  readonly path: string;
}

/**
 * What `rules` needs from `checks` without importing it: the judge closure
 * and the run-block finder. The caller passes `checks`' own functions; tests
 * pass fakes.
 */
export class Finishers extends Context.Service<
  Finishers,
  {
    readonly findRunBlock: (files: readonly FactFile[]) => {
      readonly run: Partial<typeof RunBlock.Encoded>;
      readonly sources: readonly string[];
    };
    readonly judgeClosure: (
      run: RunBlock,
      files: readonly FactFile[]
    ) => {
      readonly paths: readonly Glob[];
      readonly pointers: readonly string[];
    };
  }
>()("rules/Finishers") {}

/**
 * Whether a vouch's platform prefix names the platform's own handles. People
 * sign in with GitHub, so `github:alice` is `alice`; a handle on another
 * platform names someone else, so it vouches for no one here.
 */
const isSignInPlatform = (platform: string) => platform === "github";

/** The run block: the config folder's own, or the one the finder finds in CI. */
const runBlockOf = (
  run: PolicyInput["run"],
  facts: EvaluationFacts,
  finishers: Finishers["Service"]
): Effect.Effect<RunBlock, RulesFailed> => {
  if (!Schema.is(FromCI)(run)) {
    return Effect.succeed(run);
  }

  const found = finishers.findRunBlock(facts.ci);

  const where =
    found.sources.length === 0
      ? "the project's files"
      : found.sources.join(", ");

  return Schema.decodeUnknownEffect(RunBlock)({
    checks: {},
    ...found.run,
  }).pipe(Effect.mapError(failedAt(`the run block found in ${where}`)));
};

/**
 * The vouch file's lines as the policy holds them. A line that names no
 * handle fails the policy, so a typo is reported rather than dropped.
 */
const vouchesOf = (text: string, file: RepoPath) => {
  const { invalid, vouches } = parseVouchFile(text);

  if (invalid.length > 0) {
    const lines = invalid
      .map(({ line, text: bad }) => `line ${line} ("${bad}")`)
      .join(", ");

    return Effect.fail(
      new RulesFailed({
        detail: `${file}: no handle on ${lines}`,
        reason: "decode",
      })
    );
  }

  return Effect.succeed(
    vouches.flatMap(({ denounced, handle, note, platform }) => {
      if (platform !== undefined && !isSignInPlatform(platform)) {
        return [];
      }

      return note === undefined
        ? [{ denounced, handle }]
        : [{ denounced, handle, note }];
    })
  );
};

/** A workspace folder as a glob prefix: `./packages/x/` is `packages/x`. */
const folderOf = (dir: string) =>
  dir
    .replace(/^(?:\.\/)+/u, "")
    .replace(/\/+$/u, "")
    .replace(/^\.$/u, "");

/**
 * The territories answers may change: one per workspace package, its paths
 * its folder, its public files its `exports`; `.` for a single-package repo.
 */
const territoriesOf = (
  workspaces: EvaluationFacts["workspaces"]
): (typeof Policy.Encoded)["modules"] =>
  workspaces.length === 0
    ? [{ module: ".", paths: ["**"] }]
    : workspaces.map(({ dir, exports, name }) => {
        const folder = folderOf(dir);

        const paths: readonly [string] = [
          folder === "" ? "**" : `${folder}/**`,
        ];

        return exports.length === 0
          ? { module: name, paths }
          : { module: name, paths, publicFiles: exports };
      });

/** Fails when two asks share an id: an id names one ask, and one fork per claim. */
const distinctAsks = (asks: PolicyInput["asks"]) => {
  const seen = new Map<string, string>();

  for (const { file, id } of asks) {
    const other = seen.get(id);

    if (other !== undefined) {
      return Effect.fail(
        new RulesFailed({
          detail: `${file}: the ask ${id} is also declared in ${other}`,
          reason: "decode",
        })
      );
    }

    seen.set(id, file);
  }

  return Effect.void;
};

/**
 * Turns what the config folder evaluated to into the project's `Policy` at
 * `at`, filling in what the platform knows from the facts: the run block
 * (`fromCI` resolved by the finder), the modules from the workspaces, the
 * judge closure, `owners` as the initializer (spec D20), and the vouch
 * file's lines. Each ask counts as open, opened at `facts.now` in `at`: the
 * Project DO overwrites `openedAt`, `openedIn` and `state` from its own rows.
 * The whole is decoded with `Policy`, so a value the finishers or facts got
 * wrong fails here as `RulesFailed`, not later.
 */
export const finishPolicy = (input: {
  readonly at: LandedSha;
  readonly facts: EvaluationFacts;
  readonly finishers: Finishers["Service"];
  readonly policy: PolicyInput;
}): Effect.Effect<Policy, RulesFailed> =>
  Effect.gen(function* () {
    const { at, facts, finishers, policy } = input;
    const run = yield* runBlockOf(policy.run, facts, finishers);
    const vouches = yield* vouchesOf(facts.vouchFile ?? "", policy.vouch.file);
    const judge = finishers.judgeClosure(run, facts.ci);
    const openedAt = DateTime.formatIso(facts.now);

    yield* distinctAsks(policy.asks);

    const candidate = {
      agents: policy.agents,
      asks: policy.asks.map((ask) => ({
        ...ask,
        openedAt,
        openedIn: at,
        project: facts.project,
        state: "open" as const,
      })),
      at,
      budget: policy.budget,
      caps: policy.caps,
      claims: policy.claims,
      deciders: policy.deciders.map(({ handles, paths }) => ({
        handles: handles === "owners" ? [facts.initializer] : handles,
        paths,
      })),
      functions: policy.functions,
      judge,
      kinds: policy.kinds,
      modules: territoriesOf(facts.workspaces),
      ratchets: policy.ratchets,
      record: policy.record,
      run,
      source: policy.source,
      vouch: policy.vouch,
      vouches,
      weakening: policy.weakening,
    } satisfies typeof Policy.Encoded;

    return yield* Schema.decodeEffect(Policy)(candidate).pipe(
      Effect.mapError(failedAt(`the policy at ${at}`))
    );
  });
