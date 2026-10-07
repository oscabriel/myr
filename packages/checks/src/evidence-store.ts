/**
 * The `EvidenceStore` port: where a lane's raw log goes, so a
 * `LaneResult.logRef` (and a `ChecksFailed.logRef`) names something real and
 * the log itself never travels to an answerer (spec §2.3 `LaneResult`).
 *
 * Adapters: `/memory` here, for tests and the Worker until W4 418 adds the
 * R2 adapter over the `evidence-<stage>` bucket (spec §4.4).
 */
import type { LaneName, ProjectName, RequestId } from "@repo/protocol/ids";
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/**
 * A kept log's name: `<project>/<requestId>/<lane>#<attempt>`. It is
 * deterministic, so a replayed step overwrites its log, never adds a second
 * one (principle 8).
 */
export const LogRef = Schema.NonEmptyString.pipe(Schema.brand("LogRef"));

export type LogRef = typeof LogRef.Type;

/** One lane's log from one attempt at one answer request. */
export interface LaneLog {
  readonly project: ProjectName;
  readonly requestId: RequestId;
  readonly lane: LaneName;
  readonly attempt: number;
  readonly text: string;
}

/** The name a lane's log is kept under, whichever adapter keeps it. */
export const logRefOf = (log: Omit<LaneLog, "text">): LogRef =>
  LogRef.make(`${log.project}/${log.requestId}/${log.lane}#${log.attempt}`);

export class EvidenceStore extends Context.Service<
  EvidenceStore,
  {
    /** Keeps the log, replacing any kept under the same name. */
    readonly put: (log: LaneLog) => Effect.Effect<LogRef>;
    /**
     * A kept log, for deciders only: callers check the audience; the port
     * does not.
     */
    readonly get: (ref: LogRef) => Effect.Effect<Option.Option<string>>;
  }
>()("checks/EvidenceStore") {}
