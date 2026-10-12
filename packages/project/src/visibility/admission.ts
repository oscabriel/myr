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

export const PushedCheck = Schema.Struct({
  ...SealedCheck.fields,
  clause: Schema.optionalKey(SealedCheck.fields.clause),
});

export type PushedCheck = typeof PushedCheck.Type;

export const PushedManifest = Schema.Struct({
  ...LayerManifest.fields,
  checks: Schema.Array(PushedCheck),
});

export type PushedManifest = typeof PushedManifest.Type;

export interface LayerFile {
  readonly blob: BlobSha;
  readonly content: Uint8Array;
}

export interface OverlayFile {
  readonly content: Uint8Array;
  readonly path: RepoPath;
}

export interface AdmissionInput {
  readonly files: ReadonlyMap<string, LayerFile>;
  readonly head: CommitSha;
  readonly knownBad: ReadonlyMap<string, readonly OverlayFile[]>;
  readonly landed: ReadonlyMap<string, BlobSha>;
  readonly main: LandedSha;
  readonly manifest: PushedManifest;
  readonly policy: SealedChecks;
  readonly previous: Option.Option<PushedManifest>;
  readonly run: RunBlock;
  readonly suite: SuiteRoot;
}

export interface AdmissionRefused {
  readonly area: AreaName;
  readonly knownBad: number;
  readonly knownBadCaught: number;
  readonly mainPassed: number;
  readonly mainRuns: number;
  readonly reason: "flaky" | "catchesNothing";
}

export type Admitted = Extract<LedgerEntry, { readonly _tag: "Admitted" }>;

export interface AdmissionResult {
  readonly admitted: readonly Admitted[];
  readonly refused: readonly AdmissionRefused[];
}

const osrDefaults = { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 } as const;

const byAreaThenPath = Order.combine(
  Order.mapInput(Order.String, (check: PushedCheck) => check.area),
  Order.mapInput(Order.String, (check: PushedCheck) => check.path)
);

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

const runKey = (run: AdmissionRun) =>
  AdmissionRun.match(run, {
    OnKnownBad: ({ area, tree }) => `${area}\u0000bad\u0000${tree}`,
    OnMain: ({ area, attempt }) => `${area}\u0000main\u0000${attempt}`,
  });

export const judgeAdmission = (
  plan: AdmissionPlan,
  results: AdmissionReport["results"],
  now: DateTime.Utc
): AdmissionResult => {
  const reported = new Map(
    results.map(({ areas, run }) => [runKey(run), areas] as const)
  );

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
