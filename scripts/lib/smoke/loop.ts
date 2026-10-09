/**
 * smoke's `--loop`: the whole core loop on a platform, through
 * the CLI and git, as its people would take it (`core-loop.ts` holds the
 * steps):
 *
 * 1. `people`: who the decider's and the answerer's tokens name;
 * 2. `init`: the decider makes a throwaway project, `smoke-<run>`, and
 *    pushes its first commit;
 * 3. `open-ask`: the decider opens an ask, red twice on main first;
 * 4. `claim`: the answerer claims it, and gets a fork;
 * 5. `out-of-scope`: an answer that reaches outside the ask's territory is
 *    refused, `OutOfScope` in git's own output;
 * 6. `answer`: the fixed answer is pushed and taken;
 * 7. `landing`: it lands on main, with the answerer as author, the platform
 *    as committer, and the `Asked-by` and `Signed-off-by` trailers;
 * 8. `verdict-note`: its verdict note is on the answer's head in the fork.
 *
 * With `draft`, three more steps on the same project:
 *
 * 9. `draft-propose`: the answerer proposes a want with `--draft`;
 * 10. `draft-ready`: `proposal <id>` until the platform's agent has
 *     drafted it, red first (a failed draft fails the step);
 * 11. `draft-accept`: the decider accepts it from Today, and the landing
 *     that opened its ask discloses the drafter (`Assisted-by:`) and
 *     credits the answerer as its asker.
 *
 * Each step is timed and printed as it passes; the first that fails ends
 * the run. The throwaway project, its repo and the claim's fork are written
 * to the throwaway ledger (`infra/created.ts`, by `smoke`) as soon as each
 * exists. It never runs on `demo`: a throwaway project would show on the
 * front page the user records.
 */
import { Brand } from "@repo/brand";
import { ProjectName } from "@repo/protocol/ids";
import type { LandedSha } from "@repo/protocol/ids";
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
  proposeDraft,
  pushAnswer,
  pushOutOfScope,
  readLanding,
  readVerdictNote,
} from "./core-loop.ts";
import type { LoopStep, Patience } from "./core-loop.ts";

export { LoopFailed, LoopStep } from "./core-loop.ts";

/** `--loop` was pointed at demo, whose front page the user records. */
export class DemoStageRefused extends Schema.TaggedError<DemoStageRefused>()(
  "DemoStageRefused",
  { stage: Schema.String }
) {
  override get message() {
    return `--loop makes a throwaway project, which would show on ${this.stage}'s front page: run it on a dev stage`;
  }
}

/** How long one step took. */
export interface StepTiming {
  readonly step: LoopStep;
  readonly ms: number;
}

/** A drafted ask the loop accepted: the model, its attempts, and its landing's trailers. */
export interface DraftReport {
  readonly model: string;
  readonly attempts: number;
  /** From the proposal to the draft settled, in ms. */
  readonly ms: number;
  readonly trailers: readonly string[];
}

/** A loop that passed: what each step found, and how long each took. */
export interface SmokeLoopReport {
  readonly project: ProjectName;
  /** The refusals git printed for the out-of-territory push: `OutOfScope` among them. */
  readonly refusedWith: readonly string[];
  /** main's commit after the landing. */
  readonly landed: LandedSha;
  readonly author: string;
  readonly committer: string;
  /** Every trailer of the landing commit, as git prints them. */
  readonly trailers: readonly string[];
  readonly noteFound: boolean;
  readonly timings: readonly StepTiming[];
  /** With `draft`, the drafted ask it accepted. */
  readonly draft?: DraftReport;
}

/** What one loop runs on, and as whom. */
export interface LoopInput {
  /** The stage, which names the throwaways in the ledger; never `demo`. */
  readonly stage: string;
  /** This run's name: the project is `smoke-<run>`. */
  readonly run: string;
  /** The platform: its `/rpc` and git live here. */
  readonly origin: string;
  /** Makes the project and opens the ask (on a stage, the operator). */
  readonly decider: Redacted.Redacted;
  /** Claims the ask and pushes the answer. */
  readonly answerer: Redacted.Redacted;
  /** How the loop waits for the landing: every 2 s, for up to 10 minutes, unless given. */
  readonly patience?: Patience;
  /** Also propose with a draft, wait for it, and accept it (`--draft`). */
  readonly draft?: boolean;
}

const PATIENCE: Patience = {
  every: Duration.seconds(2),
  within: Duration.minutes(10),
};

/** A step's run, timed and printed once it passes. */
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

/**
 * Writes one throwaway to the ledger, by smoke; a repo with its namespace
 * when the stage is one `infra/stages.ts` declares.
 */
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

/** The throwaway project of run `run`: `smoke-<run>`. */
const projectOf = (run: string) =>
  Schema.decodeEffect(ProjectName)(`smoke-${run}`).pipe(
    Effect.mapError(
      () =>
        new LoopFailed({
          reason: `smoke-${run} is no project name: a run is lowercase words joined by dashes`,
          step: "init",
        })
    )
  );

/**
 * Runs the core loop on the platform at `input.origin`, as the people the
 * two tokens name, and gives what each step found; refused on `demo`
 * before anything runs.
 */
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

    const project = yield* projectOf(input.run);
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

    const [, init] = yield* timed(
      stage,
      "init"
    )(
      initProject({
        answerer: answerer.handle,
        decider,
        dir: `${dir}/start`,
        project,
      }).pipe(
        Effect.tap(() =>
          Effect.andThen(
            recordThrowaway(stage, "project", project),
            recordThrowaway(stage, "repo", project)
          )
        )
      )
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
