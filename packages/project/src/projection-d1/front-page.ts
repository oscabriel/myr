import { Reserve } from "@repo/protocol/domain/ask";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import {
  RECENT_LANDINGS_CAP,
  ShownRefusal,
} from "@repo/protocol/domain/recent-landing";
import type { RecentLanding } from "@repo/protocol/domain/recent-landing";
import { CreditSummary } from "@repo/protocol/domain/record";
import {
  AskId,
  KindName,
  LandedSha,
  nameOfKey,
  ProjectKey,
} from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Array as Arr, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../front-page.ts";
import type { FrontPageFilter } from "../front-page.ts";
import { handleKey } from "./tables.ts";

const AskIds = Schema.fromJsonString(Schema.Array(AskId));

const EntryRow = Schema.Struct({
  ask: AskId,
  blocked_by: AskIds,
  claimed: Schema.Int,
  kind: KindName,
  open_blockers: AskIds,
  posture: Posture,
  project: ProjectKey,
  reserve: Schema.NullOr(Reserve),
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

type EntryRow = typeof EntryRow.Type;

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(EntryRow));

const ProjectRow = Schema.Struct({
  landed_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  open_asks: Schema.Int,
  posture: Posture,
  project: ProjectKey,
});

type ProjectRow = typeof ProjectRow.Type;

const decodeProjectRows = Schema.decodeUnknownEffect(Schema.Array(ProjectRow));

// A row whose key no project can have is left out of every list.
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

const RecentRow = Schema.Union([
  Schema.Struct({
    ask: Schema.NullOr(AskId),
    at: Schema.DateTimeUtcFromString,
    opened: Schema.NullOr(AskId),
    outcome: Schema.Literal("landed"),
    project: ProjectKey,
    sha: LandedSha,
    want: Schema.NullOr(Schema.NonEmptyString),
  }),
  Schema.Struct({
    ask: AskId,
    at: Schema.DateTimeUtcFromString,
    outcome: Schema.Literal("refused"),
    project: ProjectKey,
    refusals: Schema.fromJsonString(Schema.NonEmptyArray(ShownRefusal)),
    want: Schema.NullOr(Schema.NonEmptyString),
  }),
]);

type RecentRow = typeof RecentRow.Type;

const decodeRecent = Schema.decodeUnknownEffect(Schema.Array(RecentRow));

const recentOf = (row: RecentRow): Option.Option<RecentLanding> =>
  Option.map(nameOfKey(row.project), (project): RecentLanding => {
    const want = row.want === null ? {} : { want: row.want };

    return row.outcome === "landed"
      ? {
          _tag: "Landed",
          at: row.at,
          project,
          sha: row.sha,
          ...(row.ask === null ? {} : { answered: row.ask }),
          ...(row.opened === null ? {} : { opened: row.opened }),
          ...want,
        }
      : {
          _tag: "Refused",
          ask: row.ask,
          at: row.at,
          project,
          refusals: row.refusals,
          ...want,
        };
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

      const credits = (handle: Handle) =>
        sql`SELECT project, area, role, count
          FROM credits
          WHERE handle_key = ${handleKey(handle)}
          ORDER BY project, area, role`.pipe(
          Effect.flatMap(decodeCredits),
          Effect.map((rows) => Arr.getSomes(rows.map(creditOf))),
          Effect.orDie
        );

      const recentLandings = () =>
        sql`SELECT project, at, outcome, ask, opened, sha, want, refusals
          FROM recent_landings
          ORDER BY at DESC, project, seq DESC
          LIMIT ${RECENT_LANDINGS_CAP}`.pipe(
          Effect.flatMap(decodeRecent),
          Effect.map((rows) => Arr.getSomes(rows.map(recentOf))),
          Effect.orDie
        );

      return FrontPage.of({ credits, entries, projects, recentLandings });
    })
  );
