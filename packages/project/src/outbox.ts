/**
 * The outbox: side effects a call's commit asked for, kept with the rows
 * that made them until they are done (ADR 0012's settle). A row is written in
 * the same commit as its transition, run right after it, and acknowledged
 * once it succeeded; one that failed stays, with a later `notBefore`, and the
 * next alarm runs it again. Each is safe to run twice.
 *
 * Kinds: a projected event for the read models (`Projected`), a claim's
 * fork (`MakeFork`), the start of an answer run (`StartAnswer`), a
 * landing's unwritten bookkeeping, written by landing the same job again
 * (`Bookkeeping`), an effect a visibility plan asked for, settled by
 * the port that planned it (`Visibility`), and the start of a proposal's
 * draft run, one per round (`StartDraft`).
 */
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { Verdict } from "@repo/protocol/domain/answer";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import {
  CommitSha,
  Handle,
  LandedSha,
  RepoName,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Array, DateTime, Effect, Option, Order, Schema, Struct } from "effect";

import { AnswerRuns } from "./answer-runs.ts";
import type { AnswerQueue } from "./answer-runs.ts";
import { DraftParams, DraftRuns } from "./draft-runs.ts";
import { Lander, Rebuild } from "./lander.ts";
import { backoff } from "./landing.ts";
import type { OutboxRow } from "./project-store/rows.ts";
import { Projection, ProjectedEvent } from "./projection.ts";
import { ProjectVisibility, VisibilityEffect } from "./visibility-port.ts";

const mainRef = RefName.make("refs/heads/main");

/** An answer's landing job, as its bookkeeping retry lands it again. */
export const LandAgain = Schema.Struct({
  author: Handle,
  base: CommitSha,
  fork: RepoName,
  head: CommitSha,
  main: LandedSha,
  message: Schema.String,
  repo: RepoName,
  requestId: RequestId,
  tree: TreeSha,
  verdict: Schema.optionalKey(Verdict),
});

export type LandAgain = typeof LandAgain.Type;

/** What one outbox row asks for. */
export const OutboxBody = Schema.Union([
  ProjectedEvent,
  Schema.TaggedStruct("MakeFork", { from: RepoName, name: RepoName }),
  Schema.TaggedStruct("StartAnswer", { requestId: RequestId }),
  Schema.TaggedStruct("Bookkeeping", { job: LandAgain }),
  Schema.TaggedStruct("Visibility", { effect: VisibilityEffect }),
  Schema.TaggedStruct("StartDraft", DraftParams.fields),
]).pipe(Schema.toTaggedUnion("_tag"));

export type OutboxBody = typeof OutboxBody.Type;

const BodyJson = Schema.toCodecJson(OutboxBody);

const encodeBody = Schema.encodeEffect(BodyJson);

const decodeBody = Schema.decodeUnknownEffect(BodyJson);

/** A row asking for `body`, due at `notBefore`; a row with the same id is replaced. */
export const outboxRow = (
  id: string,
  body: OutboxBody,
  notBefore: DateTime.Utc
): Effect.Effect<OutboxRow> =>
  Effect.map(Effect.orDie(encodeBody(body)), (encoded) => ({
    attempts: 0,
    body: encoded,
    id,
    kind: body._tag,
    notBefore,
  }));

/** One row per event, for the read models, keyed by the event's number. */
export const projectedRows = (
  project: ProjectName,
  events: readonly ProjectEvent[],
  now: DateTime.Utc
): Effect.Effect<readonly OutboxRow[]> =>
  Effect.forEach(events, (event) =>
    outboxRow(
      `projected:${event.seq}`,
      ProjectedEvent.make({ event, project }),
      now
    )
  );

/** The row that starts (or resumes) an answer's run at `at`. */
export const startRow = (requestId: RequestId, at: DateTime.Utc) =>
  outboxRow(
    `start:${requestId}:${DateTime.toEpochMillis(at)}`,
    OutboxBody.cases.StartAnswer.make({ requestId }),
    at
  );

/** The row that starts a proposal's draft run for one round: one row per round. */
export const draftRow = (params: DraftParams, at: DateTime.Utc) =>
  outboxRow(
    `draft:${params.proposal}:r${params.round}`,
    OutboxBody.cases.StartDraft.make(params),
    at
  );

/** Whether a row is due at `now`. */
export const isDue = (row: OutboxRow, now: DateTime.Utc) =>
  DateTime.isLessThanOrEqualTo(row.notBefore, now);

/** What running some rows came to: the ids done, and the rows to run again later. */
export interface OutboxRun {
  readonly done: readonly string[];
  readonly retry: readonly OutboxRow[];
}

/** The row again, after `attempts` failures: due after a backoff from `now`. */
const later = (row: OutboxRow, now: DateTime.Utc): OutboxRow => ({
  ...row,
  attempts: row.attempts + 1,
  notBefore: DateTime.addDuration(now, backoff(row.attempts)),
});

interface Decoded {
  readonly body: OutboxBody;
  readonly row: OutboxRow;
}

const ran = (row: OutboxRow, ok: boolean, now: DateTime.Utc): OutboxRun =>
  ok ? { done: [row.id], retry: [] } : { done: [], retry: [later(row, now)] };

const all = (runs: readonly OutboxRun[]): OutboxRun => ({
  done: runs.flatMap(({ done }) => done),
  retry: runs.flatMap(({ retry }) => retry),
});

/**
 * A claim's fork, made or found made. Artifacts may answer a fork that
 * worked with an error: a fork that exists and has `main` is made.
 */
const fork = (from: RepoName, name: RepoName) =>
  RepoHost.use((host) =>
    host.fork(from, name).pipe(
      Effect.as(true),
      Effect.catchTag("RepoExists", () =>
        host.refs(name).pipe(
          Effect.map((refs) => refs.has(mainRef)),
          Effect.orElseSucceed(() => false)
        )
      ),
      Effect.orElseSucceed(() => false)
    )
  );

/** The landing job again: its unwritten bookkeeping is written, and nothing else moves. */
const landAgain = (job: LandAgain) =>
  Lander.use((lander) =>
    lander.land({
      author: job.author,
      main: job.main,
      message: job.message,
      rebuild: Rebuild.Merge({
        base: job.base,
        fork: job.fork,
        head: job.head,
      }),
      repo: job.repo,
      requestId: job.requestId,
      tree: job.tree,
      verdict: Option.fromUndefinedOr(job.verdict),
    })
  ).pipe(
    Effect.map(({ pending }) => pending.length === 0),
    Effect.orElseSucceed(() => false)
  );

const bySeq = Order.mapInput(Order.Number, ({ body }: Decoded) =>
  OutboxBody.guards.Projected(body) ? body.event.seq : 0
);

/**
 * Runs the rows: projected events first, in their order and in one call,
 * then forks, bookkeeping, visibility's effects, the draft runs, and last
 * the answer runs (which may run long, and settle their own rows). Nothing
 * here fails: each row is done, or retried.
 */
export const runOutbox = (
  rows: readonly OutboxRow[],
  queue: AnswerQueue,
  now: DateTime.Utc
): Effect.Effect<
  OutboxRun,
  never,
  AnswerRuns | Lander | Projection | RepoHost
> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.forEach(rows, (row) =>
      Effect.map(Effect.orDie(decodeBody(row.body)), (body) => ({ body, row }))
    );

    const of = <Tag extends OutboxBody["_tag"]>(tag: Tag) =>
      decoded.filter(
        (
          each
        ): each is Decoded & {
          readonly body: Extract<OutboxBody, { readonly _tag: Tag }>;
        } => OutboxBody.guards[tag](each.body)
      );

    const projected = Array.sort(of("Projected"), bySeq);

    const delivered = Array.isReadonlyArrayNonEmpty(projected)
      ? yield* Projection.use((projection) =>
          projection.apply(projected.map(({ row }) => row))
        ).pipe(
          Effect.as(true),
          Effect.catchTag("ProjectionFailed", (failed) =>
            Effect.as(
              Effect.logWarning("the projection refused rows", failed),
              false
            )
          )
        )
      : true;

    const forks = yield* Effect.forEach(of("MakeFork"), ({ body, row }) =>
      Effect.map(fork(body.from, body.name), (ok) => ran(row, ok, now))
    );

    const kept = yield* Effect.forEach(of("Bookkeeping"), ({ body, row }) =>
      Effect.map(landAgain(body.job), (ok) => ran(row, ok, now))
    );

    const visibility = yield* ProjectVisibility;

    const planned = yield* Effect.forEach(of("Visibility"), ({ body, row }) =>
      Effect.map(visibility.settle(body.effect), (ok) => ran(row, ok, now))
    );

    const draftRuns = yield* DraftRuns;

    const drafts = yield* Effect.forEach(of("StartDraft"), ({ body, row }) =>
      Effect.as(
        draftRuns.start(Struct.omit(body, ["_tag"])),
        ran(row, true, now)
      )
    );

    const runs = yield* Effect.forEach(of("StartAnswer"), ({ body, row }) =>
      Effect.as(
        AnswerRuns.use((answers) => answers.start(body.requestId, queue)),
        ran(row, true, now)
      )
    );

    return all([
      ...projected.map(({ row }) => ran(row, delivered, now)),
      ...forks,
      ...kept,
      ...planned,
      ...drafts,
      ...runs,
    ]);
  });
