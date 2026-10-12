// The projection deletes a project's row with any event that can move its
// posture, so a row is written only while the project's `cursor` stands at or
// before the event the read saw, and never over a row from a later read.
// Lists go in as one JSON parameter (`json_each`) to stay under D1's limit on
// bound parameters. Every failure is a miss, never the list's.
import { keyOf, nameOfKey, ProjectKey } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import {
  Array as Arr,
  DateTime,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { StandingPostures } from "../standing-posture.ts";
import type {
  StandingEntry,
  StandingPosturesApi,
} from "../standing-posture.ts";

const Row = Schema.Struct({
  moves_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  posture: Posture,
  project: ProjectKey,
  seen: Schema.Int,
});

const decodeRow = Schema.decodeUnknownOption(Row);

const rowOf = (project: ProjectName, entry: StandingEntry) => ({
  moves_at: entry.until === undefined ? null : DateTime.formatIso(entry.until),
  posture: entry.posture,
  project: keyOf(project),
  seen: entry.seen,
});

const entryOf = ({
  moves_at: movesAt,
  posture,
  seen,
}: typeof Row.Type): StandingEntry =>
  movesAt === null ? { posture, seen } : { posture, seen, until: movesAt };

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
                  WHERE project IN (SELECT value FROM json_each(${JSON.stringify(projects.map(keyOf))}))`,
                [],
                "the kept standing postures were not read"
              ),
              (rows) =>
                new Map(
                  Arr.getSomes(
                    Arr.getSomes(rows.map((row) => decodeRow(row))).map((row) =>
                      Option.map(
                        nameOfKey(row.project),
                        (project) => [project, entryOf(row)] as const
                      )
                    )
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
