/**
 * One draft run, as a program over named steps (W9-D14): the platform's
 * `Answer` Workflow runs it with durable steps (`apps/platform`'s
 * `workflows/draft-steps.ts`), and `draft-runs/inline.ts` runs it in
 * process, so both reach the same end.
 *
 * - `context`: the project's open proposal (`draftContext`), and the files
 *   the drafter reads, picked from the canonical repo at the landed commit
 *   and read there (never a layer's repo). The step records them, so a
 *   replay reads nothing. A project with no `fix` kind settles at once,
 *   `Failed{IncompleteBrief}`, with no model call.
 * - for each attempt n, at most `DRAFT_ROUNDS`: `draft-<n>`, the model's
 *   draft, recorded as `DraftedAsk`, so a replay never asks the model
 *   again; then `rehearse-<n>`, its files rehearsed as `accept` would open
 *   them (`rehearseOpen`). `Red` ends the round; `Refused` becomes the next
 *   attempt's feedback (the refusal as `protocol/render` says it, the
 *   diagnosis and the output's tail). A draft the model could not give is
 *   a spent attempt, except `rate-limited`, which the step retries.
 * - `settle`: the round's end, told to the project (`draftSettled`), which
 *   ignores a round no longer current.
 *
 * A step whose retries are spent is kept failed by the engine and thrown
 * again, unrun, in every replay, where its typed failure is gone: so what
 * the program makes of it is recorded as a value in a step of its own
 * (`<step>:gave-up`), which every replay reads back.
 */
import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import { DraftResult, DRAFT_ROUNDS, Rehearsal } from "@repo/project/draft-runs";
import type { DraftParams } from "@repo/project/draft-runs";
import { Projects } from "@repo/project/projects";
import { RepoName, RepoPath } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { IncompleteBrief, VerifierBlocked } from "@repo/protocol/refusal";
import { Cause, Context, Effect, Option, Record, Schema } from "effect";

import { askTestFolderOf, pickFiles } from "./context.ts";
import { DraftContext, DraftedAsk, DraftFailed } from "./drafted.ts";
import type { DraftInput } from "./drafted.ts";
import { Drafter } from "./drafter.ts";
import { feedbackText, policyDigest } from "./prompt.ts";
import { draftedFiles } from "./render.ts";

/** How often, and how far apart, a failed step runs again before it is spent. */
export interface StepRetry {
  readonly limit: number;
  readonly delayMs: number;
  readonly backoff: "constant" | "linear" | "exponential";
}

/**
 * The steps a run takes: each named, its value recorded by `schema`, and
 * run once per run (a replay reads the record back). A failure is retried
 * per `retry`, and once spent fails the step.
 */
export interface DraftSteps {
  readonly step: <A, I, E, R>(
    name: string,
    schema: Schema.Codec<A, I>,
    effect: Effect.Effect<A, E, R>,
    retry?: StepRetry
  ) => Effect.Effect<A, E, R>;
}

/**
 * The model the drafter asks, as a settled round names it (`drafted by`,
 * and the accepted landing's `Assisted-by:`). The platform gives its
 * `DRAFT_MODEL`; a world with the memory drafter keeps the default.
 */
export const DraftModel = Context.Reference<string>("drafting/DraftModel", {
  defaultValue: () => "memory",
});

/** A rate-limited model is asked again, further apart each time. */
export const rateLimitedRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 15_000,
  limit: 4,
};

/** A Checker that could not run, or a main that moved, is rehearsed again. */
export const blockedRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 60_000,
  limit: 3,
};

/** What `context` records: what the attempts read, or why the round has none. */
const Prepared = Schema.TaggedUnion({
  /** The proposal is closed or gone: nothing to draft or settle. */
  Gone: {},
  /** The project has no `fix` kind, the only kind drafted. */
  NoFix: {},
  Ready: {
    context: DraftContext,
    territory: Schema.optionalKey(Schema.NonEmptyString),
    want: Schema.NonEmptyString,
  },
});

type Prepared = typeof Prepared.Type;

/** What `draft-<n>` records: the model's draft, or why it gave none. */
const Attempted = Schema.TaggedUnion({
  Drafted: { drafted: DraftedAsk },
  Spent: { reason: DraftFailed.fields.reason },
});

type Attempted = typeof Attempted.Type;

/** The kind a draft is: W9 drafts `fix` asks only (W9-D13). */
const draftedKind = "fix";

/** A proposal's territory as the paths whose files the drafter reads. */
const territoryPaths = (territory: string | undefined) =>
  (territory ?? "")
    .split(/[\s,]+/u)
    .map((path) => path.replace(/(?:\/\*\*)?\/*$/u, ""))
    .filter((path) => path !== "" && path !== ".")
    .map((path) => RepoPath.make(path));

const decoder = new TextDecoder();

/** `{ [key]: value }` when `value` is there, else no key at all. */
const field = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): Partial<Record<K, A>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => Record.singleton(key, present),
  });

/** What the next attempt is told when the model gave no draft. */
const spentText = (reason: string) =>
  `Your reply gave no draft (${reason}): answer with one JSON object that matches the schema, and nothing else.`;

/** The refusal a round that never rehearsed ends with: no draft, and why. */
const noDraft = (reason: string): Refusal =>
  new IncompleteBrief({ missing: [`a draft (${reason})`] });

/** Runs one round of a proposal's draft to its settling, over `steps`. */
export const runDraft = (
  params: DraftParams,
  steps: DraftSteps
): Effect.Effect<void, never, Projects | Drafter | RepoHost> =>
  Effect.gen(function* () {
    const { step } = steps;
    const projects = yield* Projects;
    const drafter = yield* Drafter;
    const host = yield* RepoHost;
    const model = yield* DraftModel;
    const project = projects.get(params.project);

    const prepare = Effect.gen(function* () {
      const api = yield* project;
      const data = yield* api.draftContext(params.proposal, params.round);

      if (!data.policy.kinds.some(({ name }) => name === draftedKind)) {
        return Prepared.cases.NoFix.make({});
      }

      const repo = RepoName.make(data.project);

      const read = (path: RepoPath) =>
        host.readFile(repo, Revision.Commit({ sha: data.at }), path).pipe(
          Effect.map(
            Option.match({
              onNone: () => "",
              onSome: (bytes) => decoder.decode(bytes),
            })
          ),
          Effect.catchTag("RepoNotFound", () => Effect.succeed(""))
        );

      const files = yield* pickFiles(
        data.paths,
        { territory: territoryPaths(data.territory), want: data.want },
        read
      );

      return Prepared.cases.Ready.make({
        context: {
          at: data.at,
          files,
          policy: policyDigest(data.policy, askTestFolderOf(files)),
          project: data.project,
        },
        ...field("territory", Option.fromUndefinedOr(data.territory)),
        want: data.want,
      });
    }).pipe(
      Effect.catchTags({
        ProposalClosed: () => Effect.succeed(Prepared.cases.Gone.make({})),
        UnknownProject: () => Effect.succeed(Prepared.cases.Gone.make({})),
        UnknownProposal: () => Effect.succeed(Prepared.cases.Gone.make({})),
      })
    );

    const prepared: Prepared = yield* step("context", Prepared, prepare);

    const settle = (result: DraftResult) =>
      step(
        "settle",
        Schema.Boolean,
        project.pipe(
          Effect.flatMap((api) =>
            api.draftSettled(params.proposal, params.round, result)
          ),
          Effect.as(true),
          Effect.catchTag("UnknownProject", () => Effect.succeed(false))
        )
      );

    /** Up to `DRAFT_ROUNDS` attempts, each fed the last one's failure. */
    const attempts = (
      ready: Extract<Prepared, { readonly _tag: "Ready" }>
    ): Effect.Effect<DraftResult> =>
      Effect.gen(function* () {
        let feedback = Option.none<string>();
        let last: Refusal = noDraft("none given");

        for (let attempt = 1; attempt <= DRAFT_ROUNDS; attempt += 1) {
          const input: DraftInput = {
            attempt,
            context: ready.context,
            ...field("feedback", feedback),
            ...field("note", Option.fromUndefinedOr(params.note)),
            ...field("territory", Option.fromUndefinedOr(ready.territory)),
            want: ready.want,
          };

          const tried: Attempted = yield* step(
            `draft-${attempt}`,
            Attempted,
            drafter.draft(input).pipe(
              Effect.map((drafted) =>
                Attempted.cases.Drafted.make({ drafted })
              ),
              Effect.catchTag("DraftFailed", (failed) =>
                failed.reason === "rate-limited"
                  ? Effect.fail(failed)
                  : Effect.succeed(
                      Attempted.cases.Spent.make({ reason: failed.reason })
                    )
              )
            ),
            rateLimitedRetry
          ).pipe(
            Effect.catchCause(() =>
              step(
                `draft-${attempt}:gave-up`,
                Attempted,
                Effect.succeed(
                  Attempted.cases.Spent.make({ reason: "rate-limited" })
                )
              )
            )
          );

          if (Attempted.guards.Spent(tried)) {
            feedback = Option.some(spentText(tried.reason));
            last = noDraft(tried.reason);

            continue;
          }

          const { drafted } = tried;
          const files = draftedFiles(drafted);

          // A Checker still blocked (or a main still moving) once the
          // retries are spent ends the round: another draft would not help.
          const gaveUp = (cause: Cause.Cause<Refusal>) =>
            step(
              `rehearse-${attempt}:gave-up`,
              Rehearsal,
              Effect.succeed(
                Rehearsal.cases.Refused.make({
                  diagnosis: "Blocked",
                  excerpt: "",
                  refusal: Option.getOrElse(
                    Cause.findErrorOption(cause),
                    (): Refusal => new VerifierBlocked({})
                  ),
                })
              )
            ).pipe(Effect.map((rehearsal) => ({ blocked: true, rehearsal })));

          const rehearsed = yield* step(
            `rehearse-${attempt}`,
            Rehearsal,
            Effect.flatMap(project, (api) => api.rehearseOpen(files)).pipe(
              Effect.catchTag("UnknownProject", () =>
                Effect.fail(new VerifierBlocked({}))
              )
            ),
            blockedRetry
          ).pipe(
            Effect.map((rehearsal) => ({ blocked: false, rehearsal })),
            Effect.catchCause(gaveUp)
          );

          if (Rehearsal.guards.Red(rehearsed.rehearsal)) {
            return DraftResult.cases.Red.make({
              attempts: attempt,
              files,
              lane: rehearsed.rehearsal.lane,
              model,
              rationale: drafted.rationale,
              signature: rehearsed.rehearsal.signature,
            });
          }

          const refused = rehearsed.rehearsal;

          last = refused.refusal;

          if (rehearsed.blocked) {
            return DraftResult.cases.Failed.make({
              attempts: attempt,
              model,
              refusal: last,
            });
          }

          feedback = Option.some(
            feedbackText({
              diagnosis: refused.diagnosis,
              excerpt: refused.excerpt,
              refusal: refused.refusal,
            })
          );
        }

        return DraftResult.cases.Failed.make({
          attempts: DRAFT_ROUNDS,
          model,
          refusal: last,
        });
      });

    const result: Option.Option<DraftResult> = yield* Prepared.match(prepared, {
      Gone: () => Effect.succeedNone,
      NoFix: () =>
        Effect.succeedSome(
          DraftResult.cases.Failed.make({
            attempts: 1,
            model,
            refusal: new IncompleteBrief({ missing: ["kinds.fix"] }),
          })
        ),
      Ready: (ready) => Effect.asSome(attempts(ready)),
    });

    if (Option.isSome(result)) {
      yield* settle(result.value);
    }
  }).pipe(
    Effect.annotateLogs({
      proposal: params.proposal,
      round: String(params.round),
    })
  );
