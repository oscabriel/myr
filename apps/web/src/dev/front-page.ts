import { FrontPage } from "@repo/project/front-page";
import type { FrontPageFilter } from "@repo/project/front-page";
import type { ProjectedEvent } from "@repo/project/projection";
import { creditsFor, Projects } from "@repo/project/projects";
import type { AskListing } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Array, DateTime, Effect, Layer, Order } from "effect";

import { DevProjected } from "./projection.ts";

interface Row {
  readonly ask: AskListing;
  readonly claims: number;
  readonly openedAt: DateTime.Utc;
  readonly project: ProjectName;
}

interface Listed {
  readonly landedAt?: DateTime.Utc;
  readonly posture: Posture;
}

const keyOf = (project: ProjectName, ask: string) => `${project}/${ask}`;

const inOrder = Order.mapInput(
  Order.Tuple([Order.String, Order.Number]),
  ({ event, project }: ProjectedEvent) => [project, event.seq] as const
);

const withClaims = (
  rows: ReadonlyMap<string, Row>,
  key: string,
  change: number
): ReadonlyMap<string, Row> => {
  const row = rows.get(key);

  return row === undefined
    ? rows
    : new Map(rows).set(key, {
        ...row,
        claims: Math.max(row.claims + change, 0),
      });
};

const step = (
  rows: ReadonlyMap<string, Row>,
  { event, project }: ProjectedEvent
): ReadonlyMap<string, Row> =>
  ProjectEvent.match(event, {
    AskClosed: ({ ask }) => {
      const next = new Map(rows);

      next.delete(keyOf(project, ask));

      return next;
    },
    AskOpened: ({ ask, at }) =>
      new Map(rows).set(keyOf(project, ask.ask), {
        ask,
        claims: ask.claimed ? 1 : 0,
        openedAt: at,
        project,
      }),
    Claimed: ({ ask }) => withClaims(rows, keyOf(project, ask), 1),
    Decided: () => rows,
    Judged: () => rows,
    Landed: () => rows,
    Lapsed: ({ ask }) => withClaims(rows, keyOf(project, ask), -1),
    LedgerAppended: () => rows,
    ProposalDrafted: () => rows,
    ProposalOpened: () => rows,
    Pushed: () => rows,
    Released: ({ ask }) => withClaims(rows, keyOf(project, ask), -1),
    Warned: () => rows,
  });

const listedStep = (
  listed: ReadonlyMap<ProjectName, Listed>,
  { event, project }: ProjectedEvent
): ReadonlyMap<ProjectName, Listed> => {
  const was: Listed = listed.get(project) ?? { posture: "open" };

  if (ProjectEvent.guards.Landed(event)) {
    return new Map(listed).set(project, {
      ...was,
      landedAt: event.landing.landedAt,
    });
  }

  if (
    ProjectEvent.guards.LedgerAppended(event) &&
    LedgerEntry.guards.PostureChanged(event.entry)
  ) {
    return new Map(listed).set(project, { ...was, posture: event.entry.to });
  }

  return new Map(listed).set(project, was);
};

const empty: ReadonlyMap<string, Row> = new Map();

const unlisted: ReadonlyMap<ProjectName, Listed> = new Map();

const fold = (events: readonly ProjectedEvent[]) => {
  const ordered = Array.sort(events, inOrder);

  return {
    listed: Array.reduce(ordered, unlisted, listedStep),
    projects: Array.sort(
      Array.dedupe(events.map(({ project }) => project)),
      Order.String
    ),
    rows: [...Array.reduce(ordered, empty, step).values()],
  };
};

type Folded = ReturnType<typeof fold>;

const postureOf = (folded: Folded, project: ProjectName): Posture =>
  folded.listed.get(project)?.posture ?? "open";

const listingOf =
  (folded: Folded) =>
  (project: ProjectName): ProjectListing => {
    const listing = {
      openAsks: folded.rows.filter((row) => row.project === project).length,
      posture: postureOf(folded, project),
      project,
    };

    const landedAt = folded.listed.get(project)?.landedAt;

    return landedAt === undefined ? listing : { ...listing, landedAt };
  };

const newestFirst = Order.combineAll([
  Order.flip(Order.mapInput(DateTime.Order, ({ openedAt }: Row) => openedAt)),
  Order.mapInput(Order.String, ({ project }: Row) => project),
  Order.mapInput(Order.String, ({ ask }: Row) => ask.ask),
]);

const entryOf =
  (folded: Folded) =>
  (row: Row): FrontPageEntry => {
    const onPage = (ask: string) =>
      folded.rows.some(
        (other) => other.project === row.project && other.ask.ask === ask
      );

    const blockedBy = row.ask.blockedBy.filter(onPage);
    const claimed = row.claims > 0;

    return {
      ask: { ...row.ask, blockedBy, claimed },
      posture: postureOf(folded, row.project),
      project: row.project,
      takeable:
        !claimed && blockedBy.length === 0 && row.ask.reserve === undefined,
    };
  };

const matches =
  ({ kind, reserved }: FrontPageFilter) =>
  ({ ask }: Row) =>
    (kind === undefined || ask.kind === kind) &&
    (reserved === undefined || ask.reserve === reserved);

export const DevFrontPage: Layer.Layer<
  FrontPage,
  never,
  Projects | DevProjected
> = Layer.effect(
  FrontPage,
  Effect.gen(function* () {
    const projected = yield* DevProjected;
    const projects = yield* Projects;
    const page = Effect.map(projected.events, fold);

    return FrontPage.of({
      credits: (handle) =>
        Effect.flatMap(page, (folded) =>
          creditsFor(handle, folded.projects).pipe(
            Effect.provideService(Projects, projects)
          )
        ),
      entries: (filter) =>
        Effect.map(page, (folded) =>
          Array.sort(folded.rows.filter(matches(filter)), newestFirst).map(
            entryOf(folded)
          )
        ),
      projects: () =>
        Effect.map(page, (folded) => folded.projects.map(listingOf(folded))),
    });
  })
);
