/**
 * `StandingPostures` over D1, beside the projection: one row per project in
 * `standing_postures` (`tables.ts`, migration 0005), each the posture a
 * list last read from the project's own record, when it moves by the clock
 * alone, and the project's last event the read saw.
 *
 * The projection deletes a project's row in the same write as an event
 * that can move its posture (`projection.ts`). A read that event came
 * after could still be written once the event is applied, so a row is
 * written only while the project's `cursor` stands at or before the event
 * the read saw, and never over a row from a later read.
 *
 * The lists of projects and of rows each go in as one JSON parameter
 * (`json_each`), so a list of any length is one statement under D1's limit
 * on bound parameters. Every failure, a database the migration has not
 * reached among them, is a miss: logged, and never the list's.
 */
import { ProjectName } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Array as Arr, DateTime, Effect, Layer, Result, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { StandingPostures } from "../standing-posture.ts";
import type {
  StandingEntry,
  StandingPosturesApi,
} from "../standing-posture.ts";

/** A row as `standing_postures` holds it. */
const Row = Schema.Struct({
  moves_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  posture: Posture,
  project: ProjectName,
  seen: Schema.Int,
});

const decodeRow = Schema.decodeUnknownOption(Row);

/** An entry as the row it is written as, one element of the JSON parameter. */
const rowOf = (project: ProjectName, entry: StandingEntry) => ({
  moves_at: entry.until === undefined ? null : DateTime.formatIso(entry.until),
  posture: entry.posture,
  project,
  seen: entry.seen,
});

/** A row read back as an entry; `moves_at` only when it is set. */
const entryOf = ({
  moves_at: movesAt,
  posture,
  seen,
}: typeof Row.Type): StandingEntry =>
  movesAt === null ? { posture, seen } : { posture, seen, until: movesAt };

/** `statement`'s rows, or `missed` and a warning when it fails. */
const orMissed = <A>(
  statement: Effect.Effect<A, SqlError>,
  missed: A,
  warning: string
) =>
  Effect.gen(function* () {
    const ran = yield* Effect.result(statement);

    if (Result.isSuccess(ran)) {
      return ran.success;
    }

    yield* Effect.logWarning(warning, ran.failure);

    return missed;
  });

export const StandingPosturesD1 = Layer.effect(
  StandingPostures,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const store: StandingPosturesApi = {
      get: (projects) =>
        projects.length === 0
          ? Effect.succeed(new Map())
          : Effect.map(
              orMissed(
                sql`SELECT project, posture, moves_at, seen FROM standing_postures
                  WHERE project IN (SELECT value FROM json_each(${JSON.stringify(projects)}))`,
                [],
                "the kept standing postures were not read"
              ),
              (rows) =>
                new Map(
                  Arr.getSomes(rows.map((row) => decodeRow(row))).map(
                    (row) => [row.project, entryOf(row)] as const
                  )
                )
            ),
      put: (entries) => {
        const rows = [...entries].map(([project, entry]) =>
          rowOf(project, entry)
        );

        return rows.length === 0
          ? Effect.void
          : Effect.asVoid(
              orMissed(
                sql`INSERT INTO standing_postures (project, posture, moves_at, seen)
                  SELECT json_extract(entry.value, '$.project'),
                    json_extract(entry.value, '$.posture'),
                    json_extract(entry.value, '$.moves_at'),
                    json_extract(entry.value, '$.seen')
                  FROM json_each(${JSON.stringify(rows)}) AS entry
                  WHERE json_extract(entry.value, '$.seen') >= COALESCE(
                    (SELECT seq FROM cursor
                      WHERE cursor.project = json_extract(entry.value, '$.project')),
                    0)
                  ON CONFLICT (project) DO UPDATE SET
                    posture = excluded.posture, moves_at = excluded.moves_at,
                    seen = excluded.seen
                  WHERE excluded.seen >= standing_postures.seen`,
                [],
                "the standing postures read were not kept"
              )
            );
      },
    };

    return store;
  })
);
