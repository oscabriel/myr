/**
 * `Projection` over D1: each project's outbox rows become the front page's
 * rows, the project list's and every person's credits (`tables.ts`). The
 * Project DO stays the system of record; this is a read model it feeds
 * through its outbox, and nothing else writes it.
 *
 * - A project is listed from its first event on (no event says a project
 *   was made), `open` until a `PostureChanged` ledger entry moves it. Its
 *   open asks are counted again from the front page whenever an ask opens
 *   or closes, and a landing stamps when it last landed.
 * - A landing credits each person it names once per role, in its ask's
 *   area: the module of the ask's territory, read from the ask's front
 *   page row, which is still there when its `Landed` applies (its
 *   `AskClosed` comes after). A landing with no ask, or whose ask the front
 *   page never held, credits no area. `Assisted-by` is never credit.
 *
 * Events apply in their project's order, once each. Every statement is
 * guarded by the project's cursor: it runs only if the cursor stands just
 * before its event, and the event's last statement moves the cursor on. So a
 * row seen again, or an older row after a newer one, changes nothing, and
 * two deliveries racing each other apply each event once. A row past a gap
 * (its project's cursor short of the event before it) is not applied, and
 * `apply` fails with `ProjectionFailed` once the rest is in: the outbox keeps
 * those rows and sends them again after the missing one.
 *
 * One call is one atomic write: a D1 batch when the `SqlClient` is D1's
 * (D1 has no interactive transactions), and a transaction anywhere else,
 * such as sqlite-node in tests. The client itself says which it is, so the
 * layer needs nothing but the `SqlClient`. A failed write applies nothing.
 */
import { TypeId } from "@effect/sql-d1/D1Client";
import type { D1Client } from "@effect/sql-d1/D1Client";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import type { AskId } from "@repo/protocol/ids";
import { Array, DateTime, Effect, Layer, Order, Schema } from "effect";
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
  Schema.Struct({ project: ProjectName, seq: Schema.Int })
);

const decodeCursors = Schema.decodeUnknownEffect(Cursors);

/**
 * Whether the client is D1's: every client `@effect/sql-d1` makes carries
 * its `TypeId`, and only its `batch` writes several statements atomically
 * there (its `withTransaction` dies).
 */
const isD1 = (client: SqlClient): client is D1Client => TypeId in client;

const bySeq = Order.mapInput(
  Order.Tuple([Order.String, Order.Number]),
  ({ event, project }: ProjectedEvent) => [project, event.seq] as const
);

/** Each project, with the last event the rows carry for it. */
const lastOf = (events: readonly ProjectedEvent[]) =>
  new Map(events.map(({ event, project }) => [project, event.seq]));

/**
 * Each person a landing credits, once per role, by the key `sameHandle`
 * compares handles by (`handleKey`): the rule of
 * `creditsByArea` (`attention/credits.ts`, W2 220) for one landing, whose
 * area the projection reads from D1. Only `credits` counts: `assisted` (the
 * `Assisted-by` trailers) names agents, never people.
 */
const creditedOn = (landing: Pick<LandingView, "credits">) =>
  Array.dedupeWith(
    landing.credits.map(({ handle, role }) => ({
      person: handleKey(handle),
      role,
    })),
    (one, other) => one.person === other.person && one.role === other.role
  );

export const ProjectionD1: Layer.Layer<Projection, never, SqlClient> =
  Layer.effect(
    Projection,
    Effect.gen(function* () {
      const sql = yield* SqlClient;

      /** The statements in order, all or none. */
      const atomically = (
        statements: readonly Statement<object>[]
      ): Effect.Effect<readonly (readonly object[])[], SqlError> =>
        isD1(sql)
          ? sql.batch(statements)
          : sql.withTransaction(Effect.all(statements));

      /** Whether the project's cursor stands just before event `seq`. */
      const isNext = (project: ProjectName, seq: number) =>
        sql`(SELECT COALESCE(MAX(seq), 0) FROM cursor WHERE project = ${project}) = ${seq - 1}`;

      /**
       * What one event changes in the read model, if anything: the project's
       * row first, so every event lists its project.
       */
      const writes = ({ event, project }: ProjectedEvent) => {
        const next = isNext(project, event.seq);

        const listed = sql`INSERT INTO projects (project, posture, open_asks, landed_at)
          SELECT ${project}, 'open', 0, NULL WHERE ${next}
          ON CONFLICT (project) DO NOTHING`;

        const counted = sql`UPDATE projects SET open_asks =
            (SELECT COUNT(*) FROM front_page WHERE front_page.project = ${project})
          WHERE project = ${project} AND ${next}`;

        const claims = (ask: AskId, change: number) =>
          sql`UPDATE front_page SET claimed = MAX(claimed + ${change}, 0)
            WHERE project = ${project} AND ask = ${ask} AND ${next}`;

        /**
         * One more landing for each person `landing` credits, in each role,
         * in its ask's area. A landing that names a project other than the
         * one whose outbox carried it credits nothing: ask ids are unique
         * only within a project (`areaOf` in `attention/record.ts` checks
         * the same).
         */
        const credited = ({ ask, ...landing }: LandingView) =>
          ask === undefined || landing.project !== project
            ? []
            : creditedOn(landing).map(
                ({ person, role }) =>
                  sql`INSERT INTO credits (handle_key, project, area, role, count)
                    SELECT ${person}, ${project}, page.territory, ${role}, 1
                    FROM front_page AS page
                    WHERE page.project = ${project} AND page.ask = ${ask} AND ${next}
                    ON CONFLICT (handle_key, project, area, role)
                      DO UPDATE SET count = credits.count + 1`
              );

        const changes = ProjectEvent.match(event, {
          AskClosed: ({ ask }) => [
            sql`DELETE FROM front_page
              WHERE project = ${project} AND ask = ${ask} AND ${next}`,
            counted,
          ],
          AskOpened: ({ ask, at }) => [
            sql`INSERT INTO front_page
                (project, ask, kind, reserve, want, territory, claimed, blocked_by, opened_at)
              SELECT ${project}, ${ask.ask}, ${ask.kind}, ${ask.reserve ?? null},
                ${ask.want}, ${ask.territory}, ${ask.claimed ? 1 : 0},
                ${JSON.stringify(ask.blockedBy)}, ${DateTime.formatIso(at)}
              WHERE ${next}
              ON CONFLICT (project, ask) DO UPDATE SET
                kind = excluded.kind, reserve = excluded.reserve,
                want = excluded.want, territory = excluded.territory,
                claimed = excluded.claimed, blocked_by = excluded.blocked_by,
                opened_at = excluded.opened_at`,
            counted,
          ],
          Claimed: ({ ask }) => [claims(ask, 1)],
          Decided: () => [],
          Judged: () => [],
          Landed: ({ landing }) => [
            sql`UPDATE projects SET landed_at = ${DateTime.formatIso(landing.landedAt)}
              WHERE project = ${project} AND ${next}`,
            ...credited(landing),
          ],
          Lapsed: ({ ask }) => [claims(ask, -1)],
          LedgerAppended: ({ entry }) =>
            LedgerEntry.guards.PostureChanged(entry)
              ? [
                  sql`UPDATE projects SET posture = ${entry.to}
                    WHERE project = ${project} AND ${next}`,
                ]
              : [],
          ProposalOpened: () => [],
          Pushed: () => [],
          Released: ({ ask }) => [claims(ask, -1)],
          Warned: () => [],
        });

        return [listed, ...changes];
      };

      /** Moves the project's cursor on to `seq`, if it stands just before it. */
      const advance = (project: ProjectName, seq: number) =>
        sql`INSERT INTO cursor (project, seq)
          SELECT ${project}, ${seq} WHERE ${isNext(project, seq)}
          ON CONFLICT (project) DO UPDATE SET seq = excluded.seq`;

      const cursorsOf = (projects: readonly ProjectName[]) =>
        sql`SELECT project, seq FROM cursor WHERE ${sql.in("project", projects)}`;

      /**
       * Applies the events in one write, then reads where each project's
       * cursor stands: short of a project's last event means a gap.
       */
      const deliver = (events: Array.NonEmptyReadonlyArray<ProjectedEvent>) =>
        Effect.gen(function* () {
          const last = lastOf(events);

          const results = yield* atomically([
            ...events.flatMap((projected) => [
              ...writes(projected),
              advance(projected.project, projected.event.seq),
            ]),
            cursorsOf([...last.keys()]),
          ]).pipe(
            Effect.mapError(
              (failed) => new ProjectionFailed({ reason: failed.message })
            )
          );

          const reached = new Map(
            (yield* Effect.orDie(decodeCursors(results.at(-1) ?? []))).map(
              ({ project, seq }) => [project, seq]
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
