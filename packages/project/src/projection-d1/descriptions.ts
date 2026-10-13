// A row is decoded when read, so one that no longer decodes is read again, and
// a read of an earlier landing never replaces a row from a later one.
// Lists go in as one JSON parameter (`json_each`) to stay under D1's limit on
// bound parameters. Every failure is a miss, never the list's.
import { ProjectDescription } from "@repo/protocol/domain/front-page";
import { keyOf, nameOfKey, ProjectKey } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
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

import { ProjectDescriptions } from "../description.ts";
import type {
  KeptDescription,
  ProjectDescriptionsApi,
} from "../description.ts";

const Row = Schema.Struct({
  description: Schema.NullOr(ProjectDescription),
  landed_at: Schema.DateTimeUtcFromString,
  project: ProjectKey,
});

const decodeRow = Schema.decodeUnknownOption(Row);

const rowOf = (project: ProjectName, entry: KeptDescription) => ({
  description: entry.description ?? null,
  landed_at: DateTime.formatIso(entry.landedAt),
  project: keyOf(project),
});

const entryOf = ({
  description,
  landed_at: landedAt,
}: typeof Row.Type): KeptDescription =>
  description === null ? { landedAt } : { description, landedAt };

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

export const ProjectDescriptionsD1 = Layer.effect(
  ProjectDescriptions,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const store: ProjectDescriptionsApi = {
      get: (projects) =>
        projects.length === 0
          ? Effect.succeed(new Map())
          : Effect.map(
              orMissed(
                sql`SELECT project, landed_at, description FROM project_descriptions
                  WHERE project IN (SELECT value FROM json_each(${JSON.stringify(projects.map(keyOf))}))`,
                [],
                "the kept descriptions were not read"
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
                sql`INSERT INTO project_descriptions (project, landed_at, description)
                  SELECT json_extract(entry.value, '$.project'),
                    json_extract(entry.value, '$.landed_at'),
                    json_extract(entry.value, '$.description')
                  FROM json_each(${JSON.stringify(rows)}) AS entry
                  WHERE true
                  ON CONFLICT (project) DO UPDATE SET
                    landed_at = excluded.landed_at,
                    description = excluded.description
                  WHERE excluded.landed_at >= project_descriptions.landed_at`,
                [],
                "the descriptions read were not kept"
              )
            );
      },
    };

    return store;
  })
);
