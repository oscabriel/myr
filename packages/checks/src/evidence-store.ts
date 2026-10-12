import type { ProjectName } from "@repo/protocol/ids";
import {
  keyOf,
  LaneName,
  ProjectNameFromKey,
  RequestId,
} from "@repo/protocol/ids";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

// Deterministic, so a replayed step overwrites its log rather than adding one.
export const LogRef = Schema.NonEmptyString.pipe(Schema.brand("LogRef"));

export type LogRef = typeof LogRef.Type;

export interface LaneLog {
  readonly project: ProjectName;
  readonly requestId: RequestId;
  readonly lane: LaneName;
  readonly attempt: number;
  readonly text: string;
}

export const logRefOf = (log: Omit<LaneLog, "text">): LogRef =>
  LogRef.make(
    `${keyOf(log.project)}/${log.requestId}/${log.lane}#${log.attempt}`
  );

const LogName = Schema.TemplateLiteralParser([
  ProjectNameFromKey,
  "/",
  RequestId,
  "/",
  LaneName,
  "#",
  Schema.Int,
]);

// A name is kept only when `logRefOf` spells it back the same.
export const logOfRef = (ref: string): Option.Option<Omit<LaneLog, "text">> =>
  Option.filter(
    Option.map(
      Schema.decodeUnknownOption(LogName)(ref),
      ([project, , requestId, , lane, , attempt]) => ({
        attempt,
        lane,
        project,
        requestId,
      })
    ),
    (log) => logRefOf(log) === ref
  );

export class EvidenceStore extends Context.Service<
  EvidenceStore,
  {
    readonly put: (log: LaneLog) => Effect.Effect<LogRef>;
    // Callers check who asks (`ProjectApi.evidence`); the port does not.
    readonly get: (ref: LogRef) => Effect.Effect<Option.Option<string>>;
  }
>()("checks/EvidenceStore") {}
