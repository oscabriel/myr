/**
 * Workers Analytics Engine: one row per point in the stage's own dataset,
 * sampled by project. A query reads a point by its columns:
 *
 * | point          | blob1          | blob2           | blob3   | blob4 | double1      | double2    |
 * | -------------- | -------------- | --------------- | ------- | ----- | ------------ | ---------- |
 * | `Landed`       | `Landed`       |                 |         |       | 1            |            |
 * | `Refused`      | `Refused`      | the refusal tag | stage   | area  | 1            |            |
 * | `LaneRan`      | `LaneRan`      | lane            | result  |       | `durationMs` |            |
 * | `ChecksWaited` | `ChecksWaited` |                 |         |       | `waitedMs`   |            |
 *
 * `index1` is the project's name, cut to the 96 bytes an index holds.
 */
import { Data, Effect, Layer } from "effect";

import { MetricPoint, Metrics } from "../metrics.ts";

/** Mutable arrays, as the binding's own type takes them. */
export interface DataPoint {
  readonly blobs: string[];
  readonly doubles: number[];
  readonly indexes: string[];
}

/** Structural, so the package needs no Workers types. */
export interface DatasetLike {
  readonly writeDataPoint: (point: DataPoint) => void;
}

/** A project's name is ASCII, so its first 96 characters are its first 96 bytes. */
const INDEX_BYTES = 96;

const columns = (
  blobs: readonly string[],
  doubles: readonly number[]
): Pick<DataPoint, "blobs" | "doubles"> => ({
  blobs: [...blobs],
  doubles: [...doubles],
});

export const dataPointOf = (point: MetricPoint): DataPoint => {
  const { blobs, doubles } = MetricPoint.match(point, {
    ChecksWaited: ({ waitedMs }) => columns([], [waitedMs]),
    Landed: () => columns([], [1]),
    LaneRan: ({ durationMs, lane, result }) =>
      columns([lane, result], [durationMs]),
    Refused: ({ area, stage, tag }) => columns([tag, stage, area ?? ""], [1]),
  });

  return {
    blobs: [point._tag, ...blobs],
    doubles,
    indexes: [point.project.slice(0, INDEX_BYTES)],
  };
};

class MetricRefused extends Data.TaggedError("MetricRefused")<{
  readonly cause: unknown;
}> {}

export const MetricsBinding = (dataset: DatasetLike) =>
  Layer.succeed(Metrics, {
    write: (points) =>
      Effect.forEach(
        points,
        (point) =>
          Effect.try({
            catch: (cause) => new MetricRefused({ cause }),
            try: () => {
              dataset.writeDataPoint(dataPointOf(point));
            },
          }).pipe(
            Effect.catchTag("MetricRefused", ({ cause }) =>
              Effect.logWarning(
                `the metrics dataset refused a ${point._tag} point`,
                cause
              )
            )
          ),
        { discard: true }
      ),
  });
