/**
 * The `EvidenceStore` port: where a lane's raw log goes, so a
 * `LaneResult.logRef` (and a `ChecksFailed.logRef`) names something real and
 * the log itself never travels to an answerer (spec §2.3 `LaneResult`).
 *
 * Adapters: `/memory`, for tests and the web's dev backend, and `/r2` over
 * the stage's `evidence-<stage>` bucket (spec §4.4), which the Worker runs.
 */
import { LaneName, ProjectName, RequestId } from "@repo/protocol/ids";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

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

/** A log's name, read back into what it names. */
const LogName = Schema.TemplateLiteralParser([
  ProjectName,
  "/",
  RequestId,
  "/",
  LaneName,
  "#",
  Schema.Int,
]);

/**
 * What a log's name points at: `logRefOf` read backwards, or `None` for a
 * name it never makes. None of its parts holds a `/` or a `#`.
 */
export const logOfRef = (ref: string): Option.Option<Omit<LaneLog, "text">> =>
  Option.map(
    Schema.decodeUnknownOption(LogName)(ref),
    ([project, , requestId, , lane, , attempt]) => ({
      attempt,
      lane,
      project,
      requestId,
    })
  );

export class EvidenceStore extends Context.Service<
  EvidenceStore,
  {
    /** Keeps the log, replacing any kept under the same name. */
    readonly put: (log: LaneLog) => Effect.Effect<LogRef>;
    /**
     * A kept log, for its answer's claimant and the project's deciders
     * only: callers check who asks (`ProjectApi.evidence`); the port does
     * not.
     */
    readonly get: (ref: LogRef) => Effect.Effect<Option.Option<string>>;
  }
>()("checks/EvidenceStore") {}
