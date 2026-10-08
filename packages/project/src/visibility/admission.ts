/**
 * Admission of held-back checks, pure (W6 615; OSR §5.5, SYN Q17,
 * poteto's "prove each new check fails on a real past mistake"). A push to
 * the layer that holds a project's held-back checks is a proposal: the
 * suite it would make enters the layer's landed SHA only once each area it
 * changes is admitted.
 *
 * - Every check in the suite cites the clause of an ask or a public doc it
 *   enforces; one that cites none is `UnstatedRequirement{area}` (for the
 *   deciders only, never the public; the platform logs it until Today can
 *   show it), before any run is planned.
 * - Each changed area's checks run on main as many times as the policy
 *   asks (3 by default), and must pass every time: one red run refuses the
 *   area as flaky or broken.
 * - The checks the push adds or rewrites in the area run again on each
 *   known-bad tree the layer's manifest names (main with the known-bad
 *   commit's files laid over it), and must fail on at least as many as the
 *   policy asks: catching nothing refuses the area. Only those run there,
 *   so a new check that catches nothing cannot ride on an older one's
 *   catch.
 *
 * An area the push adds or rewrites no check in (its checks unchanged, or
 * only removed) is not run again. The public learns only `Admitted{area,
 * suite, mainRuns, knownBadCaught}`: counts and a root, never a check, a
 * path or a clause.
 */
import { commandFor } from "@repo/checks/kinds";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { RunBlock } from "@repo/protocol/domain/run";
import {
  LayerManifest,
  LedgerEntry,
  SealedCheck,
} from "@repo/protocol/domain/visibility";
import type { SealedChecks } from "@repo/protocol/domain/visibility";
import { AreaName } from "@repo/protocol/ids";
import type {
  BlobSha,
  CommitSha,
  LandedSha,
  RepoPath,
  SuiteRoot,
} from "@repo/protocol/ids";
import { UnstatedRequirement } from "@repo/protocol/refusal";
import { Array as Arr, Option, Order, Result, Schema } from "effect";
import type { DateTime } from "effect";

import { AdmissionRun } from "../visibility-port.ts";
import type {
  AdmissionPlan,
  AdmissionReport,
  HeldBackJob,
} from "../visibility-port.ts";

/**
 * A held-back check as a pushed manifest lists it: like `SealedCheck`, but
 * its clause may be missing, so admission can refuse it by name to the
 * deciders (`UnstatedRequirement`) rather than read the manifest as none.
 */
export const PushedCheck = Schema.Struct({
  ...SealedCheck.fields,
  clause: Schema.optionalKey(SealedCheck.fields.clause),
});

export type PushedCheck = typeof PushedCheck.Type;

/** A layer's manifest as pushed: its checks may leave out their clause. */
export const PushedManifest = Schema.Struct({
  ...LayerManifest.fields,
  checks: Schema.Array(PushedCheck),
});

export type PushedManifest = typeof PushedManifest.Type;

/** One file a layer commit holds: its blob id and its bytes. */
export interface LayerFile {
  readonly blob: BlobSha;
  readonly content: Uint8Array;
}

/** One file a known-bad commit lays over main for its run. */
export interface OverlayFile {
  readonly content: Uint8Array;
  readonly path: RepoPath;
}

/** What a layer push's admission is planned from. */
export interface AdmissionInput {
  /** The files the pushed head holds, by path (at least its manifest's checks). */
  readonly files: ReadonlyMap<string, LayerFile>;
  readonly head: CommitSha;
  /** Each known-bad commit the layer holds, by id: the files it lays over main. */
  readonly knownBad: ReadonlyMap<string, readonly OverlayFile[]>;
  /** Each file's blob at the layer's landed head, by path; empty before its first landing. */
  readonly landed: ReadonlyMap<string, BlobSha>;
  /** The public main the runs check out. */
  readonly main: LandedSha;
  /** The pushed head's manifest. */
  readonly manifest: PushedManifest;
  readonly policy: SealedChecks;
  /** The landed head's manifest, if the layer landed one. */
  readonly previous: Option.Option<PushedManifest>;
  /** The project's run block: each check runs as its `test`, with `{path}` filled. */
  readonly run: RunBlock;
  /** The root the runs carry (the Checker reports it back). */
  readonly suite: SuiteRoot;
}

/** An area admission refused, and the run counts the deciders see why by. */
export interface AdmissionRefused {
  readonly area: AreaName;
  /** How many known-bad trees it ran on, and how many it turned red. */
  readonly knownBad: number;
  readonly knownBadCaught: number;
  /** How many times it ran on main, and how many of those it passed. */
  readonly mainPassed: number;
  readonly mainRuns: number;
  /** Red on main at least once (a flaky or broken check), or red on too few known-bad trees. */
  readonly reason: "flaky" | "catchesNothing";
}

/** The ledger entry an admitted area earns. */
export type Admitted = Extract<LedgerEntry, { readonly _tag: "Admitted" }>;

/**
 * What an admission's runs came to: the areas admitted, as ledger entries
 * (numbered from 0: the project numbers them as it appends), and the areas
 * refused, with why. An area with a run still unreported is in neither.
 */
export interface AdmissionResult {
  readonly admitted: readonly Admitted[];
  readonly refused: readonly AdmissionRefused[];
}

/** The counts a plan carries when the policy asks for no admission (and no run is planned): OSR §5.5's defaults. */
const osrDefaults = { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 } as const;

/** A suite's checks in order: by area, then path. */
const byAreaThenPath = Order.combine(
  Order.mapInput(Order.String, (check: PushedCheck) => check.area),
  Order.mapInput(Order.String, (check: PushedCheck) => check.path)
);

/**
 * The suite a manifest makes at one commit: its checks in an area the
 * policy names, whose files the commit holds, by area, then path.
 */
const suiteIn = (
  manifest: PushedManifest,
  policy: SealedChecks,
  holds: (path: string) => boolean
) =>
  Arr.sort(
    manifest.checks.filter(
      (check) => Object.hasOwn(policy.areas, check.area) && holds(check.path)
    ),
    byAreaThenPath
  );

/** One area's checks as (path, blob), to tell which the push added or rewrote. */
const blobsIn = (
  checks: readonly PushedCheck[],
  area: AreaName,
  blobOf: (path: string) => Option.Option<BlobSha>
) =>
  new Map(
    checks
      .filter((check) => check.area === area)
      .flatMap((check) =>
        Option.match(blobOf(check.path), {
          onNone: () => [],
          onSome: (blob) => [[check.path, blob] as const],
        })
      )
  );

/** The runs that admit a layer push's checks; `UnstatedRequirement` for a check that cites no clause. */
export const planAdmission = (
  input: AdmissionInput
): Result.Result<AdmissionPlan, UnstatedRequirement> => {
  const fileOf = (path: string) =>
    Option.fromUndefinedOr(input.files.get(path));

  const suite = suiteIn(input.manifest, input.policy, (path) =>
    input.files.has(path)
  );

  const unstated = suite.find(({ clause }) => clause === undefined);

  if (unstated !== undefined) {
    return Result.fail(new UnstatedRequirement({ area: unstated.area }));
  }

  const before = Option.match(input.previous, {
    onNone: (): readonly PushedCheck[] => [],
    onSome: (previous) =>
      suiteIn(previous, input.policy, (path) => input.landed.has(path)),
  });

  /**
   * Each area the push adds or rewrites a check in: all its checks, and
   * the ones whose (path, blob) the landed head does not hold.
   */
  const changed = Arr.sort(
    Object.keys(input.policy.areas).map((area) => AreaName.make(area)),
    Order.String
  ).flatMap((area) => {
    const then = blobsIn(before, area, (path) =>
      Option.fromUndefinedOr(input.landed.get(path))
    );

    const checks = suite.filter((check) => check.area === area);

    const fresh = checks.filter(({ path }) =>
      Option.exists(fileOf(path), ({ blob }) => then.get(path) !== blob)
    );

    return Arr.isReadonlyArrayNonEmpty(fresh) ? [{ area, checks, fresh }] : [];
  });

  const { admit } = input.policy;

  const sealedPaths = new Set(suite.map(({ path }) => path));

  /** A job of `checks` in `area` (after `overlay`, laid over main first), each run by the run block's `test`. */
  const jobOf = (
    area: AreaName,
    checks: readonly PushedCheck[],
    overlay: readonly OverlayFile[]
  ): HeldBackJob => ({
    areas: [area],
    at: input.head,
    files: [
      ...overlay.flatMap(({ content, path }) =>
        sealedPaths.has(path) ? [] : [{ area, content, path }]
      ),
      ...checks.flatMap(({ path }) =>
        Option.match(fileOf(path), {
          onNone: () => [],
          onSome: ({ content }) => [{ area, content, path }],
        })
      ),
    ],
    runs: checks.flatMap(({ path }) =>
      Option.match(
        commandFor(CheckSpec.cases.RedThenGreen.make({ path }), input.run),
        {
          onNone: () => [],
          onSome: ({ command }) => [{ area, command, path }],
        }
      )
    ),
    suite: input.suite,
  });

  const knownBad = Arr.dedupe(input.manifest.knownBad).flatMap((tree) =>
    Option.match(Option.fromUndefinedOr(input.knownBad.get(tree)), {
      onNone: () => [],
      onSome: (overlay) => [{ overlay, tree }],
    })
  );

  // On main, every check of the area; on a known-bad tree, only the new ones.
  const runs =
    admit === undefined
      ? []
      : changed.flatMap(({ area, checks, fresh }) => {
          const onMain = jobOf(area, checks, []);

          return [
            ...Arr.makeBy(admit.greenOnMainRuns, (index) =>
              AdmissionRun.cases.OnMain.make({
                area,
                attempt: index + 1,
                job: onMain,
              })
            ),
            ...knownBad.map(({ overlay, tree }) =>
              AdmissionRun.cases.OnKnownBad.make({
                area,
                job: jobOf(area, fresh, overlay),
                tree,
              })
            ),
          ];
        });

  return Result.succeed({
    admit: admit ?? osrDefaults,
    head: input.head,
    layer: input.manifest.layer,
    main: input.main,
    run: input.run,
    runs,
  });
};

/** A run's identity within its plan: its area, and main's attempt or the known-bad tree. */
const runKey = (run: AdmissionRun) =>
  AdmissionRun.match(run, {
    OnKnownBad: ({ area, tree }) => `${area}\u0000bad\u0000${tree}`,
    OnMain: ({ area, attempt }) => `${area}\u0000main\u0000${attempt}`,
  });

/**
 * An admission's results, judged against its plan, each reported run
 * matched to a planned one by its area and its attempt or tree. An area
 * passes a run when every check it ran passed, and a known-bad tree
 * catches it when any failed.
 */
export const judgeAdmission = (
  plan: AdmissionPlan,
  results: AdmissionReport["results"],
  now: DateTime.Utc
): AdmissionResult => {
  const reported = new Map(
    results.map(({ areas, run }) => [runKey(run), areas] as const)
  );

  /** One area's verdict, once each of its runs is reported. */
  const verdictOf = (
    area: AreaName,
    runs: Arr.NonEmptyReadonlyArray<AdmissionRun>
  ): Option.Option<Result.Result<Admitted, AdmissionRefused>> =>
    Option.map(
      Option.all(
        runs.map((run) =>
          Option.map(
            Option.fromUndefinedOr(reported.get(runKey(run))),
            (reports) => ({
              bit: Arr.findFirst(reports, (each) => each.area === area),
              run,
            })
          )
        )
      ),
      (ran) => {
        const onMain = ran.filter(({ run }) => AdmissionRun.guards.OnMain(run));

        const onBad = ran.filter(({ run }) =>
          AdmissionRun.guards.OnKnownBad(run)
        );

        const counts = {
          area,
          knownBad: onBad.length,
          knownBadCaught: onBad.filter(({ bit }) =>
            Option.exists(
              bit,
              ({ passed, total }) => total > 0 && passed < total
            )
          ).length,
          mainPassed: onMain.filter(({ bit }) =>
            Option.exists(
              bit,
              ({ passed, total }) => total > 0 && passed === total
            )
          ).length,
          mainRuns: onMain.length,
        };

        if (counts.mainPassed < counts.mainRuns) {
          return Result.fail({ ...counts, reason: "flaky" as const });
        }

        if (counts.knownBadCaught < plan.admit.redOnKnownBadAtLeast) {
          return Result.fail({ ...counts, reason: "catchesNothing" as const });
        }

        return Result.succeed(
          LedgerEntry.cases.Admitted.make({
            area,
            at: now,
            knownBadCaught: counts.knownBadCaught,
            mainRuns: counts.mainRuns,
            seq: 0,
            suite: runs[0].job.suite,
          })
        );
      }
    );

  const verdicts = Arr.dedupe(plan.runs.map(({ area }) => area)).flatMap(
    (area) => {
      const runs = plan.runs.filter((run) => run.area === area);

      return Arr.isReadonlyArrayNonEmpty(runs)
        ? Option.toArray(verdictOf(area, runs))
        : [];
    }
  );

  const [admitted, refused] = Arr.separate(verdicts);

  return { admitted, refused };
};
