/**
 * The facts the platform counts and times: landings, refusals, check lanes,
 * and the wait before an answer's checks start. A point names
 * public things only (a project, a refusal's tag and area, a stage, a lane)
 * and numbers: never a path, a layer, a held-back check, a command, a log or
 * a value. The project writes each one to its outbox in the same commit as
 * the fact it counts, keyed by that fact, so a replayed call writes none.
 */
import { LaneOutcome } from "@repo/protocol/domain/answer";
import type { LaneResult } from "@repo/protocol/domain/answer";
import { StageName } from "@repo/protocol/domain/outcome";
import {
  ShownRefusal,
  shownRefusal,
} from "@repo/protocol/domain/recent-landing";
import { LaneName, ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Context, DateTime, Effect, Schema } from "effect";

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const MetricPoint = Schema.TaggedUnion({
  /** How long an answer waited, from its submission, before its checks started. */
  ChecksWaited: { project: ProjectName, waitedMs: Millis },
  /** A commit the platform landed on a project's main. */
  Landed: { project: ProjectName },
  /** One check lane's run on an answer's merged tree, as the Checker timed it. */
  LaneRan: {
    durationMs: Millis,
    lane: LaneName,
    project: ProjectName,
    result: LaneOutcome,
  },
  /** One refusal of an answer: its tag, its area when it names one, and the stage that gave it. */
  Refused: { ...ShownRefusal.fields, project: ProjectName, stage: StageName },
});

export type MetricPoint = typeof MetricPoint.Type;

export interface MetricsApi {
  /** Fire and forget: a point the store cannot take is dropped with a warning, never retried. */
  readonly write: (points: readonly MetricPoint[]) => Effect.Effect<void>;
}

/** The default writes nothing, so a world with no dataset counts nothing. */
export const Metrics = Context.Reference<MetricsApi>("project/Metrics", {
  defaultValue: () => ({ write: () => Effect.void }),
});

export const refusedPoints = (
  project: ProjectName,
  stage: StageName,
  refusals: readonly Refusal[]
): readonly MetricPoint[] =>
  refusals.map((refusal) =>
    MetricPoint.cases.Refused.make({ ...shownRefusal(refusal), project, stage })
  );

/** The lane's name, result and time alone: its command and log stay with the verdict. */
export const lanePoints = (
  project: ProjectName,
  lanes: readonly LaneResult[]
): readonly MetricPoint[] =>
  lanes.map(({ durationMs, lane, result }) =>
    MetricPoint.cases.LaneRan.make({
      durationMs: Math.max(durationMs, 0),
      lane,
      project,
      result,
    })
  );

/** Never below zero: two instants a clock gave in order may still read backwards. */
export const millisBetween = (from: DateTime.Utc, to: DateTime.Utc): number =>
  Math.max(DateTime.toEpochMillis(to) - DateTime.toEpochMillis(from), 0);
