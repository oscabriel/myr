/**
 * `FrontPage` over D1: the open asks of every project, the project list and
 * a person's credits, each in one query, read from the rows `ProjectionD1`
 * keeps (`tables.ts`), so no project wakes.
 *
 * An entry is what the anonymous viewer sees: an ask is takeable when no
 * live claim holds it, nothing it waits on is still open, and it is held for
 * nobody. Its `blockedBy` names only the asks it still waits on: one that
 * landed has left the front page. Newest asks come first, each with its
 * project's posture. Projects are listed by name, and a person's credits by
 * project, area and role: counts by role and area, never a score or a total
 * across roles. A failed read is a defect: the port's reads cannot fail.
 */
import { Reserve } from "@repo/protocol/domain/ask";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import { CreditSummary } from "@repo/protocol/domain/record";
import { AskId, KindName, nameOfKey, ProjectKey } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Array as Arr, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../front-page.ts";
import type { FrontPageFilter } from "../front-page.ts";
import { handleKey } from "./tables.ts";

const AskIds = Schema.fromJsonString(Schema.Array(AskId));

/** One row of the front page query. */
const EntryRow = Schema.Struct({
  ask: AskId,
  blocked_by: AskIds,
  claimed: Schema.Int,
  kind: KindName,
  /** The asks it waits on that are still on the front page. */
  open_blockers: AskIds,
  posture: Posture,
  project: ProjectKey,
  reserve: Schema.NullOr(Reserve),
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

type EntryRow = typeof EntryRow.Type;

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(EntryRow));

/** One row of the projects query. */
const ProjectRow = Schema.Struct({
  landed_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  open_asks: Schema.Int,
  posture: Posture,
  project: ProjectKey,
});

type ProjectRow = typeof ProjectRow.Type;

const decodeProjectRows = Schema.decodeUnknownEffect(Schema.Array(ProjectRow));

// Each row keeps the project's key (ADR 0032); a row whose key no project
// can have (a throwaway torn down before owners) is left out of every list.
const CreditRow = Schema.Struct({
  ...CreditSummary.fields,
  project: ProjectKey,
});

type CreditRow = typeof CreditRow.Type;

const decodeCredits = Schema.decodeUnknownEffect(Schema.Array(CreditRow));

const creditOf = (row: CreditRow): Option.Option<CreditSummary> =>
  Option.map(nameOfKey(row.project), (project) => ({ ...row, project }));

const listingOf = (row: ProjectRow): Option.Option<ProjectListing> =>
  Option.map(nameOfKey(row.project), (project) => {
    const listing = {
      openAsks: row.open_asks,
      posture: row.posture,
      project,
    };

    return row.landed_at === null
      ? listing
      : { ...listing, landedAt: row.landed_at };
  });

const entryOf = (row: EntryRow): Option.Option<FrontPageEntry> => {
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

  return Option.map(nameOfKey(row.project), (project) => ({
    ask: row.reserve === null ? listing : { ...listing, reserve: row.reserve },
    posture: row.posture,
    project,
    takeable: !claimed && blockedBy.length === 0 && row.reserve === null,
  }));
};

export const FrontPageD1: Layer.Layer<FrontPage, never, SqlClient> =
  Layer.effect(
    FrontPage,
    Effect.gen(function* () {
      const sql = yield* SqlClient;

      const entries = ({ kind, reserved }: FrontPageFilter) =>
        sql`SELECT page.project, ask, kind, reserve, want, territory, claimed, blocked_by,
            (SELECT json_group_array(blocker.value)
              FROM json_each(page.blocked_by) AS blocker
              WHERE EXISTS (
                SELECT 1 FROM front_page AS other
                WHERE other.project = page.project AND other.ask = blocker.value
              )) AS open_blockers,
            COALESCE(listed.posture, 'open') AS posture
          FROM front_page AS page
          LEFT JOIN projects AS listed ON listed.project = page.project
          WHERE ${sql.and([
            ...(kind === undefined ? [] : [sql`kind = ${kind}`]),
            ...(reserved === undefined ? [] : [sql`reserve = ${reserved}`]),
          ])}
          ORDER BY opened_at DESC, page.project, ask`.pipe(
          Effect.flatMap(decodeRows),
          Effect.map((rows) => Arr.getSomes(rows.map(entryOf))),
          Effect.orDie
        );

      const projects = () =>
        sql`SELECT project, posture, open_asks, landed_at
          FROM projects
          ORDER BY project`.pipe(
          Effect.flatMap(decodeProjectRows),
          Effect.map((rows) => Arr.getSomes(rows.map(listingOf))),
          Effect.orDie
        );

      // By the key the projection keeps: the handle as `sameHandle` compares it.
      const credits = (handle: Handle) =>
        sql`SELECT project, area, role, count
          FROM credits
          WHERE handle_key = ${handleKey(handle)}
          ORDER BY project, area, role`.pipe(
          Effect.flatMap(decodeCredits),
          Effect.map((rows) => Arr.getSomes(rows.map(creditOf))),
          Effect.orDie
        );

      return FrontPage.of({ credits, entries, projects });
    })
  );
