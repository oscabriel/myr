import { TypeId } from "@effect/sql-d1/D1Client";
import type { D1Client } from "@effect/sql-d1/D1Client";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  RECENT_LANDINGS_CAP,
  shownRefusal,
} from "@repo/protocol/domain/recent-landing";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { keyOf, nameOfKey, ProjectKey } from "@repo/protocol/ids";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import {
  Array,
  DateTime,
  Effect,
  Layer,
  Option,
  Order,
  Ref,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type { Statement } from "effect/sql/Statement";

import type { OutboxRow } from "../project-store/rows.ts";
import { Projection, ProjectedEvent, ProjectionFailed } from "../projection.ts";
import { handleKey } from "./tables.ts";

const decodeProjected = Schema.decodeUnknownEffect(
  Schema.toCodecJson(ProjectedEvent)
);

const Cursors = Schema.Array(
  Schema.Struct({ project: ProjectKey, seq: Schema.Int })
);

const decodeCursors = Schema.decodeUnknownEffect(Cursors);

// D1 has no interactive transactions (`withTransaction` dies): only its `batch` is atomic.
const isD1 = (client: SqlClient): client is D1Client => TypeId in client;

const bySeq = Order.mapInput(
  Order.Tuple([Order.String, Order.Number]),
  ({ event, project }: ProjectedEvent) => [project, event.seq] as const
);

const lastOf = (events: readonly ProjectedEvent[]) =>
  new Map(events.map(({ event, project }) => [project, event.seq]));

const creditedOn = (landing: Pick<LandingView, "credits">) =>
  Array.dedupeWith(
    landing.credits.map(({ handle, role }) => ({
      person: handleKey(handle),
      role,
    })),
    (one, other) => one.person === other.person && one.role === other.role
  );

/** Which of the tables later migrations add this database has. */
interface Kept {
  readonly postures: boolean;
  readonly recent: boolean;
}

export const ProjectionD1: Layer.Layer<Projection, never, SqlClient> =
  Layer.effect(
    Projection,
    Effect.gen(function* () {
      const sql = yield* SqlClient;

      const atomically = (
        statements: readonly Statement<object>[]
      ): Effect.Effect<readonly (readonly object[])[], SqlError> =>
        isD1(sql)
          ? sql.batch(statements)
          : sql.withTransaction(Effect.all(statements));

      // Looked for until found, so a database the migration has not reached projects as before.
      const keeps = (table: string, found: Ref.Ref<boolean>) =>
        Effect.gen(function* () {
          if (yield* Ref.get(found)) {
            return true;
          }

          const tables =
            yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`;

          yield* Ref.set(found, tables.length > 0);

          return tables.length > 0;
        });

      const keepsPostures = keeps("standing_postures", yield* Ref.make(false));

      const keepsRecent = keeps("recent_landings", yield* Ref.make(false));

      const isNext = (project: ProjectName, seq: number) =>
        sql`(SELECT COALESCE(MAX(seq), 0) FROM cursor WHERE project = ${keyOf(project)}) = ${seq - 1}`;

      const writes = ({ event, project }: ProjectedEvent, kept: Kept) => {
        const next = isNext(project, event.seq);

        // Every row keeps the project's key, never its name.
        const key = keyOf(project);

        const unkept = kept.postures
          ? [
              sql`DELETE FROM standing_postures
                WHERE project = ${key} AND ${next}`,
            ]
          : [];

        const listed = sql`INSERT INTO projects (project, posture, open_asks, landed_at)
          SELECT ${key}, 'open', 0, NULL WHERE ${next}
          ON CONFLICT (project) DO NOTHING`;

        const counted = sql`UPDATE projects SET open_asks =
            (SELECT COUNT(*) FROM front_page WHERE front_page.project = ${key})
          WHERE project = ${key} AND ${next}`;

        const claims = (ask: AskId, change: number) =>
          sql`UPDATE front_page SET claimed = MAX(claimed + ${change}, 0)
            WHERE project = ${key} AND ask = ${ask} AND ${next}`;

        // Ask ids are unique only within a project: a landing naming another project credits nothing.
        const credited = ({ ask, ...landing }: LandingView) =>
          ask === undefined || landing.project !== project
            ? []
            : creditedOn(landing).map(
                ({ person, role }) =>
                  sql`INSERT INTO credits (handle_key, project, area, role, count)
                    SELECT ${person}, ${key}, page.territory, ${role}, 1
                    FROM front_page AS page
                    WHERE page.project = ${key} AND page.ask = ${ask} AND ${next}
                    ON CONFLICT (handle_key, project, area, role)
                      DO UPDATE SET count = credits.count + 1`
              );

        const wantOf = (ask: AskId) =>
          sql`(SELECT want FROM front_page WHERE project = ${key} AND ask = ${ask})`;

        const recent = (
          statements: () => readonly Statement<object>[]
        ): readonly Statement<object>[] => (kept.recent ? statements() : []);

        // A landing or a refusal may come before or after its ask opens or closes: whichever comes second names the want.
        const wanted = (ask: AskId, want: Statement<object> | string) =>
          recent(() => [
            sql`UPDATE recent_landings SET want = ${want}
              WHERE project = ${key} AND want IS NULL
                AND (ask = ${ask} OR opened = ${ask}) AND ${next}`,
          ]);

        const landedRow = ({ landing }: { readonly landing: LandingView }) =>
          recent(() => {
            const named = landing.ask ?? landing.opened;

            return [
              sql`INSERT INTO recent_landings (project, seq, at, outcome, ask, opened, sha, want)
                SELECT ${key}, ${event.seq}, ${DateTime.formatIso(landing.landedAt)}, 'landed',
                  ${landing.ask ?? null}, ${landing.opened ?? null}, ${landing.sha},
                  ${named === undefined ? null : wantOf(named)}
                WHERE ${next}
                ON CONFLICT (project, seq) DO NOTHING`,
            ];
          });

        const refusedRow = ({
          ask,
          at,
          outcome,
        }: {
          readonly ask: AskId;
          readonly at: DateTime.Utc;
          readonly outcome: Outcome;
        }) =>
          Outcome.guards.Refused(outcome)
            ? recent(() => [
                sql`INSERT INTO recent_landings (project, seq, at, outcome, ask, want, refusals)
                  SELECT ${key}, ${event.seq}, ${DateTime.formatIso(at)}, 'refused',
                    ${ask}, ${wantOf(ask)},
                    ${JSON.stringify(outcome.refusals.map(shownRefusal))}
                  WHERE ${next}
                  ON CONFLICT (project, seq) DO NOTHING`,
              ])
            : [];

        const changes = ProjectEvent.match(event, {
          AskClosed: ({ ask }) => [
            ...wanted(ask, wantOf(ask)),
            sql`DELETE FROM front_page
              WHERE project = ${key} AND ask = ${ask} AND ${next}`,
            counted,
          ],
          AskOpened: ({ ask, at }) => [
            sql`INSERT INTO front_page
                (project, ask, kind, reserve, want, territory, claimed, blocked_by, opened_at)
              SELECT ${key}, ${ask.ask}, ${ask.kind}, ${ask.reserve ?? null},
                ${ask.want}, ${ask.territory}, ${ask.claimed ? 1 : 0},
                ${JSON.stringify(ask.blockedBy)}, ${DateTime.formatIso(at)}
              WHERE ${next}
              ON CONFLICT (project, ask) DO UPDATE SET
                kind = excluded.kind, reserve = excluded.reserve,
                want = excluded.want, territory = excluded.territory,
                claimed = excluded.claimed, blocked_by = excluded.blocked_by,
                opened_at = excluded.opened_at`,
            counted,
            ...wanted(ask.ask, ask.want),
          ],
          Claimed: ({ ask }) => [claims(ask, 1)],
          Decided: () => unkept,
          DiscussionPosted: () => [],
          Judged: refusedRow,
          Landed: ({ landing }) => [
            ...landedRow({ landing }),
            sql`UPDATE projects SET landed_at = ${DateTime.formatIso(landing.landedAt)}
              WHERE project = ${key} AND ${next}`,
            ...credited(landing),
            ...unkept,
          ],
          Lapsed: ({ ask }) => [claims(ask, -1)],
          LedgerAppended: ({ entry }) => [
            ...(LedgerEntry.guards.PostureChanged(entry)
              ? [
                  sql`UPDATE projects SET posture = ${entry.to}
                    WHERE project = ${key} AND ${next}`,
                ]
              : []),
            ...unkept,
          ],
          Pushed: () => [],
          Released: ({ ask }) => [claims(ask, -1)],
          Warned: () => [],
        });

        return [listed, ...changes];
      };

      // Ordered as the list reads them, so the rows kept are the rows listed.
      const pruned = sql`DELETE FROM recent_landings WHERE rowid NOT IN (
          SELECT rowid FROM recent_landings
          ORDER BY at DESC, project, seq DESC
          LIMIT ${RECENT_LANDINGS_CAP}
        )`;

      const advance = (project: ProjectName, seq: number) =>
        sql`INSERT INTO cursor (project, seq)
          SELECT ${keyOf(project)}, ${seq} WHERE ${isNext(project, seq)}
          ON CONFLICT (project) DO UPDATE SET seq = excluded.seq`;

      const cursorsOf = (projects: readonly ProjectName[]) =>
        sql`SELECT project, seq FROM cursor WHERE ${sql.in("project", projects.map(keyOf))}`;

      const deliver = (events: Array.NonEmptyReadonlyArray<ProjectedEvent>) =>
        Effect.gen(function* () {
          const last = lastOf(events);

          const kept = yield* Effect.all({
            postures: keepsPostures,
            recent: keepsRecent,
          }).pipe(
            Effect.mapError(
              (failed) => new ProjectionFailed({ reason: failed.message })
            )
          );

          const results = yield* atomically([
            ...events.flatMap((projected) => [
              ...writes(projected, kept),
              advance(projected.project, projected.event.seq),
            ]),
            ...(kept.recent ? [pruned] : []),
            cursorsOf([...last.keys()]),
          ]).pipe(
            Effect.mapError(
              (failed) => new ProjectionFailed({ reason: failed.message })
            )
          );

          const reached = new Map(
            Array.getSomes(
              (yield* Effect.orDie(decodeCursors(results.at(-1) ?? []))).map(
                ({ project, seq }) =>
                  Option.map(nameOfKey(project), (name) => [name, seq] as const)
              )
            )
          );

          const short = [...last].filter(
            ([project, seq]) => (reached.get(project) ?? 0) < seq
          );

          return yield* Array.isReadonlyArrayNonEmpty(short)
            ? new ProjectionFailed({
                reason: short
                  .map(
                    ([project, seq]) =>
                      `${project} stands at event ${reached.get(project) ?? 0}, short of ${seq}: an earlier event has not arrived`
                  )
                  .join("; "),
              })
            : Effect.void;
        });

      const apply = (rows: readonly OutboxRow[]) =>
        Effect.forEach(rows, (row) =>
          decodeProjected(row.body).pipe(
            Effect.mapError(
              (invalid) =>
                new ProjectionFailed({
                  reason: `outbox row ${row.id} is no projected event: ${invalid.message}`,
                })
            )
          )
        ).pipe(
          Effect.map((events) => Array.sort(events, bySeq)),
          Effect.flatMap((events) =>
            Array.isReadonlyArrayNonEmpty(events)
              ? deliver(events)
              : Effect.void
          )
        );

      return Projection.of({ apply });
    })
  );
