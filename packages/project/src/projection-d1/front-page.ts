/**
 * `FrontPage` over D1: the open asks of every project in one query, read
 * from the rows `ProjectionD1` keeps (`tables.ts`), so no project wakes.
 *
 * An entry is what the anonymous viewer sees: an ask is takeable when no
 * live claim holds it, nothing it waits on is still open, and it is held for
 * nobody. Its `blockedBy` names only the asks it still waits on: one that
 * landed has left the front page. Newest asks come first. Every project's
 * posture reads `open` until visibility (W6) projects a posture change, and
 * `projects()` and `credits()` read nothing until W5 514 adds their tables to
 * this module. A failed read is a defect: the port's reads cannot fail.
 */
import { Reserve } from "@repo/protocol/domain/ask";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { AskId, KindName, ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../front-page.ts";
import type { FrontPageFilter } from "../front-page.ts";

const AskIds = Schema.fromJsonString(Schema.Array(AskId));

/** One row of the front page query. */
const EntryRow = Schema.Struct({
  ask: AskId,
  blocked_by: AskIds,
  claimed: Schema.Int,
  kind: KindName,
  /** The asks it waits on that are still on the front page. */
  open_blockers: AskIds,
  project: ProjectName,
  reserve: Schema.NullOr(Reserve),
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

type EntryRow = typeof EntryRow.Type;

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(EntryRow));

const entryOf = (row: EntryRow): FrontPageEntry => {
  const blockedBy = row.blocked_by.filter((ask) =>
    row.open_blockers.includes(ask)
  );

  const claimed = row.claimed > 0;

  const listing = {
    ask: row.ask,
    blockedBy,
    claimed,
    kind: row.kind,
    territory: row.territory,
    want: row.want,
  };

  return {
    ask: row.reserve === null ? listing : { ...listing, reserve: row.reserve },
    posture: "open",
    project: row.project,
    takeable: !claimed && blockedBy.length === 0 && row.reserve === null,
  };
};

export const FrontPageD1: Layer.Layer<FrontPage, never, SqlClient> =
  Layer.effect(
    FrontPage,
    Effect.gen(function* () {
      const sql = yield* SqlClient;

      const entries = ({ kind, reserved }: FrontPageFilter) =>
        sql`SELECT project, ask, kind, reserve, want, territory, claimed, blocked_by,
            (SELECT json_group_array(blocker.value)
              FROM json_each(page.blocked_by) AS blocker
              WHERE EXISTS (
                SELECT 1 FROM front_page AS other
                WHERE other.project = page.project AND other.ask = blocker.value
              )) AS open_blockers
          FROM front_page AS page
          WHERE ${sql.and([
            ...(kind === undefined ? [] : [sql`kind = ${kind}`]),
            ...(reserved === undefined ? [] : [sql`reserve = ${reserved}`]),
          ])}
          ORDER BY opened_at DESC, project, ask`.pipe(
          Effect.flatMap(decodeRows),
          Effect.map((rows) => rows.map(entryOf)),
          Effect.orDie
        );

      return FrontPage.of({
        credits: () => Effect.succeed([]),
        entries,
        projects: () => Effect.succeed([]),
      });
    })
  );
