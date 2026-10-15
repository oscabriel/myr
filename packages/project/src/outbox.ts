import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { Verdict } from "@repo/protocol/domain/answer";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { Array, DateTime, Effect, Option, Order, Schema } from "effect";

import { AnswerRuns } from "./answer-runs.ts";
import type { AnswerQueue } from "./answer-runs.ts";
import { noRunEnv } from "./env-port.ts";
import { Lander, Rebuild } from "./lander.ts";
import { backoff } from "./landing.ts";
import { MetricPoint, Metrics } from "./metrics.ts";
import type { OutboxRow } from "./project-store/rows.ts";
import { Projection, ProjectedEvent } from "./projection.ts";
import { ProjectVisibility, VisibilityEffect } from "./visibility-port.ts";

const mainRef = RefName.make("refs/heads/main");

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

export const OutboxBody = Schema.Union([
  ProjectedEvent,
  Schema.TaggedStruct("MakeFork", { from: RepoName, name: RepoName }),
  Schema.TaggedStruct("StartAnswer", { requestId: RequestId }),
  Schema.TaggedStruct("Bookkeeping", { job: LandAgain }),
  Schema.TaggedStruct("Visibility", { effect: VisibilityEffect }),
  Schema.TaggedStruct("Measured", {
    points: Schema.NonEmptyArray(MetricPoint),
  }),
  /**
   * One Checker job with no lanes on a landed commit, so its setup snapshot
   * is there before the next answer: the Checker keeps a snapshot only for
   * the project's own commits, and an answer's tree alone never makes one.
   */
  Schema.TaggedStruct("WarmSetup", {
    at: LandedSha,
    project: ProjectName,
    repo: RepoName,
    run: RunBlock,
  }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type OutboxBody = typeof OutboxBody.Type;

const BodyJson = Schema.toCodecJson(OutboxBody);

const encodeBody = Schema.encodeEffect(BodyJson);

const decodeBody = Schema.decodeUnknownEffect(BodyJson);

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

export const startRow = (requestId: RequestId, at: DateTime.Utc) =>
  outboxRow(
    `start:${requestId}:${DateTime.toEpochMillis(at)}`,
    OutboxBody.cases.StartAnswer.make({ requestId }),
    at
  );

/**
 * Written in the commit that holds the fact, under an id the fact alone
 * names, so a replay that changes nothing writes no row and the same fact
 * kept twice is one row.
 */
export const measuredRow = (
  fact: string,
  points: readonly MetricPoint[],
  at: DateTime.Utc
): Effect.Effect<readonly OutboxRow[]> =>
  Array.isReadonlyArrayNonEmpty(points)
    ? Effect.map(
        outboxRow(
          `measured:${fact}`,
          OutboxBody.cases.Measured.make({ points }),
          at
        ),
        Array.of
      )
    : Effect.succeed([]);

/** Kept in the commit that keeps the landing, under the landing's SHA: one job per landing, however often it is heard. */
export const warmRow = (
  job: Omit<Extract<OutboxBody, { readonly _tag: "WarmSetup" }>, "_tag">,
  at: DateTime.Utc
) => outboxRow(`warm:${job.at}`, OutboxBody.cases.WarmSetup.make(job), at);

export const isDue = (row: OutboxRow, now: DateTime.Utc) =>
  DateTime.isLessThanOrEqualTo(row.notBefore, now);

export interface OutboxRun {
  readonly done: readonly string[];
  readonly retry: readonly OutboxRow[];
}

/** The row tried again later, with the next backoff. */
export const later = (row: OutboxRow, now: DateTime.Utc): OutboxRow => ({
  ...row,
  attempts: row.attempts + 1,
  notBefore: DateTime.addDuration(now, backoff(row.attempts)),
});

const START: OutboxBody["_tag"] = "StartAnswer";

/** An answer's start, which runs once the call that wrote it can answer (see `Background`). */
export const isStart = (row: OutboxRow) => row.kind === START;

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

// Artifacts may answer a fork that worked with an error: a fork that exists
// and has `main` is made.
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

// Answer runs go last: they may run long, and settle their own rows.
export const runOutbox = (
  rows: readonly OutboxRow[],
  queue: AnswerQueue,
  now: DateTime.Utc,
  // Takes rows out of the store before they run, naming those it still held.
  claim: (ids: readonly string[]) => Effect.Effect<readonly string[]>
): Effect.Effect<
  OutboxRun,
  never,
  AnswerRuns | CheckRunner | Lander | Projection | RepoHost
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

    const metrics = yield* Metrics;

    // A point is written at most once, and never retried: the dataset adds
    // every point it takes. Its row leaves the store first, so of a call's
    // settle and the alarm's, both holding it, only the one that took it
    // writes its points.
    const taken = new Set(
      yield* claim(of("Measured").map(({ row }) => row.id))
    );

    const measured = yield* Effect.forEach(
      of("Measured").filter(({ row }) => taken.has(row.id)),
      ({ body, row }) =>
        Effect.as(metrics.write(body.points), ran(row, true, now))
    );

    // Best effort, once: a setup the Checker could not keep is installed
    // again by the next answer, as it would have been.
    const warmed = yield* Effect.forEach(of("WarmSetup"), ({ body, row }) =>
      Effect.as(
        CheckRunner.use((runner) =>
          runner.run({
            ...noRunEnv,
            at: CheckAt.cases.Commit.make({ commit: body.at }),
            lanes: [],
            project: body.project,
            repo: body.repo,
            run: body.run,
          })
        ).pipe(
          Effect.catchTag("VerifierBlocked", () =>
            Effect.logWarning("the setup snapshot was not warmed").pipe(
              Effect.annotateLogs({ landed: body.at, project: body.project })
            )
          )
        ),
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
      ...measured,
      ...warmed,
      ...runs,
    ]);
  });
