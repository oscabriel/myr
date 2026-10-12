import { Brand } from "@repo/brand";
import { keyOf, ProjectName } from "@repo/protocol/ids";
import type { Handle, LandedSha } from "@repo/protocol/ids";
import {
  Console,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Schema,
} from "effect";
import type { Redacted } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { recordCreated } from "../../../infra/created.ts";
import type { Created } from "../../../infra/created.ts";
import { declaredStage, resources } from "../../../infra/stages.ts";
import {
  acceptDraft,
  awaitDraft,
  awaitLanding,
  claimAsk,
  initProject,
  LoopFailed,
  openAsk,
  personAt,
  projectIsFree,
  proposeDraft,
  pushAnswer,
  pushOutOfScope,
  readLanding,
  readVerdictNote,
} from "./core-loop.ts";
import type { LoopStep, Patience } from "./core-loop.ts";

export { LoopFailed, LoopStep } from "./core-loop.ts";

// A throwaway project would show on demo's front page.
export class DemoStageRefused extends Schema.TaggedError<DemoStageRefused>()(
  "DemoStageRefused",
  { stage: Schema.String }
) {
  override get message() {
    return `--loop makes a throwaway project, which would show on ${this.stage}'s front page: run it on a dev stage`;
  }
}

export interface StepTiming {
  readonly step: LoopStep;
  readonly ms: number;
}

export interface DraftReport {
  readonly model: string;
  readonly attempts: number;
  // ms
  readonly ms: number;
  readonly trailers: readonly string[];
}

export interface SmokeLoopReport {
  readonly project: ProjectName;
  readonly refusedWith: readonly string[];
  readonly landed: LandedSha;
  readonly author: string;
  readonly committer: string;
  readonly trailers: readonly string[];
  readonly noteFound: boolean;
  readonly timings: readonly StepTiming[];
  readonly draft?: DraftReport;
}

export interface LoopInput {
  readonly stage: string;
  readonly run: string;
  readonly origin: string;
  readonly decider: Redacted.Redacted;
  readonly answerer: Redacted.Redacted;
  readonly patience?: Patience;
  readonly draft?: boolean;
}

const PATIENCE: Patience = {
  every: Duration.seconds(2),
  within: Duration.minutes(10),
};

const timed =
  (stage: string, step: LoopStep) =>
  <A, R>(
    self: Effect.Effect<A, LoopFailed, R>
  ): Effect.Effect<readonly [A, StepTiming], LoopFailed, R> =>
    Effect.timed(self).pipe(
      Effect.map(([elapsed, value]) => {
        const ms = Math.round(Duration.toMillis(elapsed));

        return [value, { ms, step }] as const;
      }),
      Effect.tap(([, { ms }]) =>
        Console.log(`smoke ${stage}: loop ${step} passed in ${ms} ms`)
      )
    );

const recordThrowaway = (stage: string, kind: Created["kind"], name: string) =>
  Effect.gen(function* () {
    const namespace = Option.map(
      declaredStage(stage),
      (declared) => resources(declared).projects
    );

    const entry: Created = {
      at: yield* DateTime.now,
      by: "smoke",
      kind,
      name,
      stage,
    };

    yield* recordCreated(
      kind === "repo" && Option.isSome(namespace)
        ? { ...entry, namespace: namespace.value }
        : entry
    );
  }).pipe(
    Effect.mapError(
      ({ message }) =>
        new LoopFailed({
          reason: `the throwaway ledger: ${message}`,
          step: kind === "project" ? "init" : "claim",
        })
    )
  );

const projectOf = (decider: Handle, run: string) =>
  Schema.decodeEffect(ProjectName)(`${decider}/smoke-${run}`).pipe(
    Effect.mapError(
      () =>
        new LoopFailed({
          reason: `${decider}/smoke-${run} is no project name: a run is lowercase words joined by dashes`,
          step: "init",
        })
    )
  );

export const smokeLoop = (
  input: LoopInput
): Effect.Effect<
  SmokeLoopReport,
  LoopFailed | DemoStageRefused,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const { origin, stage } = input;

    if (stage === "demo") {
      return yield* new DemoStageRefused({ stage });
    }

    const fs = yield* FileSystem.FileSystem;

    const dir = yield* fs
      .makeTempDirectoryScoped({ prefix: `smoke-${input.run}-` })
      .pipe(
        Effect.mapError(
          ({ message }) =>
            new LoopFailed({
              reason: `a folder for the run: ${message}`,
              step: "people",
            })
        )
      );

    const [{ answerer, decider }, people] = yield* timed(
      stage,
      "people"
    )(
      Effect.all({
        answerer: personAt({
          home: `${dir}/answerer`,
          origin,
          token: input.answerer,
        }),
        decider: personAt({
          home: `${dir}/decider`,
          origin,
          token: input.decider,
        }),
      })
    );

    const project = yield* projectOf(decider.handle, input.run);

    // Checked free, then recorded, then made: an init that makes the project
    // and then fails still leaves it in the ledger, and a name someone else
    // holds never enters teardown's plan.
    const [, init] = yield* timed(
      stage,
      "init"
    )(
      Effect.gen(function* () {
        yield* projectIsFree(decider, project);
        yield* recordThrowaway(stage, "project", keyOf(project));
        yield* recordThrowaway(stage, "repo", keyOf(project));

        return yield* initProject({
          answerer: answerer.handle,
          decider,
          dir: `${dir}/start`,
          project,
        });
      })
    );

    const [, opened] = yield* timed(
      stage,
      "open-ask"
    )(openAsk(decider, project));

    const [claim, claimed] = yield* timed(
      stage,
      "claim"
    )(
      claimAsk(answerer, project).pipe(
        Effect.tap(({ fork }) => recordThrowaway(stage, "repo", fork))
      )
    );

    const work = `${answerer.home}/answer`;

    const [refusedWith, refused] = yield* timed(
      stage,
      "out-of-scope"
    )(pushOutOfScope({ answerer, claim, dir: work }));

    const [head, answered] = yield* timed(
      stage,
      "answer"
    )(pushAnswer(answerer, work));

    const [{ landed, read }, landing] = yield* timed(
      stage,
      "landing"
    )(
      Effect.gen(function* () {
        const sha = yield* awaitLanding({
          answerer,
          head,
          patience: input.patience ?? PATIENCE,
          project,
        });

        const found = yield* readLanding({
          answerer,
          dir: work,
          landed: sha,
          origin,
          project,
        });

        const wanted = [
          ["author", found.author, answerer.handle],
          // The platform commits every landing under its own name.
          ["committer", found.committer, Brand.name],
        ] as const;

        for (const [what, got, expected] of wanted) {
          if (got !== expected) {
            return yield* new LoopFailed({
              reason: `the landing ${sha}'s ${what} is ${got}, not ${expected}`,
              step: "landing",
            });
          }
        }

        const missing = [
          `Asked-by: ${decider.handle} `,
          `Signed-off-by: ${answerer.handle} `,
        ].filter(
          (prefix) => !found.trailers.some((line) => line.startsWith(prefix))
        );

        if (missing.length > 0) {
          return yield* new LoopFailed({
            reason: `the landing ${sha} lacks ${missing.map((prefix) => prefix.trim()).join(" and ")}: its trailers are ${found.trailers.join("; ") || "none"}`,
            step: "landing",
          });
        }

        return { landed: sha, read: found };
      })
    );

    const [, noted] = yield* timed(
      stage,
      "verdict-note"
    )(readVerdictNote({ answerer, dir: work, head }));

    const timings = [
      people,
      init,
      opened,
      claimed,
      refused,
      answered,
      landing,
      noted,
    ];

    const report = {
      author: read.author,
      committer: read.committer,
      landed,
      noteFound: true,
      project,
      refusedWith,
      timings,
      trailers: read.trailers,
    };

    if (input.draft !== true) {
      return report;
    }

    const [proposal, proposed] = yield* timed(
      stage,
      "draft-propose"
    )(proposeDraft(answerer, project));

    const [ready, drafted] = yield* timed(
      stage,
      "draft-ready"
    )(
      awaitDraft({
        patience: input.patience ?? PATIENCE,
        project,
        proposal,
        reader: answerer,
      })
    );

    const [trailers, accepted] = yield* timed(
      stage,
      "draft-accept"
    )(
      acceptDraft({
        decider,
        dir: `${dir}/start`,
        origin,
        project,
        proposal,
        proposer: answerer.handle,
      })
    );

    return {
      ...report,
      draft: {
        ...ready,
        ms: proposed.ms + drafted.ms,
        trailers,
      },
      timings: [...timings, proposed, drafted, accepted],
    };
  }).pipe(Effect.scoped);
