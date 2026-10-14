import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ownerOf, shortNameOf } from "@repo/protocol/ids";
import { DateTime } from "effect";
import type { ReactNode } from "react";

import { LandingProjects } from "../landing/projects.ts";
import { RUN_A_PROJECT } from "../landing/words.ts";
import { postureLabel } from "../project/posture-label.ts";
import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH, IMPORT_PATH, projectPath } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { exploreGroups } from "./groups.ts";
import { EXPLORE_LEDE, EXPLORE_TITLE } from "./words.ts";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// A day, never a span: the page is kept at the edge, where "5 min ago" would go stale.
const dayOf = (at: DateTime.Utc) =>
  DateTime.formatUtc(at, {
    day: "numeric",
    locale: "en-US",
    month: "short",
    year: "numeric",
  });

const LastLanded = ({ at }: { readonly at: DateTime.Utc | undefined }) =>
  at === undefined ? (
    <span>No landing yet</span>
  ) : (
    <span>
      Last landed <time dateTime={DateTime.formatIso(at)}>{dayOf(at)}</time>
    </span>
  );

/** A plain bordered surface: the name, its posture, one line, then its counts. */
const ProjectCard = ({
  listing: { description, landedAt, landings, openAsks, posture, project },
}: {
  readonly listing: ProjectListing;
}) => (
  <li
    className="border-rule bg-card flex min-w-0 flex-col gap-3 rounded-md border p-4"
    data-project={project}
  >
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <AppLink
        className="text-want min-w-0 [overflow-wrap:anywhere] no-underline hover:underline"
        to={projectPath(project)}
      >
        <span className="text-muted-foreground">{ownerOf(project)}/</span>
        <span className="font-semibold">{shortNameOf(project)}</span>
      </AppLink>
      <PostureBadge label={postureLabel(posture)} posture={posture} />
    </div>
    {description === undefined ? null : (
      <p className="text-ui text-muted-foreground line-clamp-2 flex-1">
        {description}
      </p>
    )}
    <p className="text-ui text-muted-foreground border-rule mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
      <span className={openAsks > 0 ? "text-foreground font-medium" : ""}>
        {openAsks > 0
          ? plural(openAsks, "open ask", "open asks")
          : "No open asks"}
      </span>
      {landings === undefined ? null : (
        <span>{plural(landings, "landing", "landings")}</span>
      )}
      <LastLanded at={landedAt} />
    </p>
  </li>
);

const CardGrid = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[];
}) => (
  <ul className="tablet:grid-cols-2 columns:grid-cols-3 grid grid-cols-1 gap-4">
    {projects.map((listing) => (
      <ProjectCard key={listing.project} listing={listing} />
    ))}
  </ul>
);

const Group = ({
  children,
  group,
  heading,
  note,
}: {
  readonly children: ReactNode;
  readonly group: "rest" | "taking";
  readonly heading: string;
  readonly note: string;
}) => (
  <section
    aria-labelledby={`explore-${group}`}
    className="flex flex-col gap-4"
    data-group={group}
  >
    <div className="flex flex-col gap-1">
      <h2 className="text-title" id={`explore-${group}`}>
        {heading}
      </h2>
      <p className="text-ui text-muted-foreground">{note}</p>
    </div>
    {children}
  </section>
);

const Listed = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[];
}) => {
  const { rest, taking } = exploreGroups(projects);

  return (
    <>
      <Group
        group="taking"
        heading="Taking answers now"
        note="Projects with asks open to claim."
      >
        {taking.length === 0 ? (
          <EmptyState title="No project has an open ask right now." />
        ) : (
          <CardGrid projects={taking} />
        )}
      </Group>
      {rest.length === 0 ? null : (
        <Group
          group="rest"
          heading="Other projects"
          note="Projects with no open ask, to read and to watch."
        >
          <CardGrid projects={rest} />
        </Group>
      )}
    </>
  );
};

const Lede = ({ projects }: { readonly projects: LandingProjects }) =>
  LandingProjects.match(projects, {
    Listed: ({ projects: listed }) =>
      `${plural(listed.length, "public project", "public projects")}, the ones taking answers first.`,
    Unreachable: () => EXPLORE_LEDE,
  });

const Body = ({ projects }: { readonly projects: LandingProjects }) =>
  LandingProjects.match(projects, {
    Listed: ({ projects: listed }) => <Listed projects={listed} />,
    Unreachable: () => <UnreachableNotice />,
  });

/** The public projects as cards, in two groups, or a notice when the platform did not answer. */
export const ExploreView = ({
  projects,
}: {
  readonly projects: LandingProjects;
}) => (
  <main
    className={`flex flex-1 flex-col gap-12 pt-6 pb-16 outline-none ${GUTTER}`}
    id="main"
    tabIndex={-1}
  >
    <div className="flex flex-col gap-3">
      <h1 className="text-headline">{EXPLORE_TITLE}</h1>
      <p className="text-body text-muted-foreground max-w-(--measure)">
        <Lede projects={projects} /> Looking for something to work on?{" "}
        <AppLink to={ASKS_PATH}>See every open ask</AppLink>. Have a repo of
        your own?{" "}
        <AppLink data-action="import" to={IMPORT_PATH}>
          {RUN_A_PROJECT}
        </AppLink>
        .
      </p>
    </div>
    <Body projects={projects} />
  </main>
);
