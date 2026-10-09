/**
 * A project's page: its posture, how to take part, its open asks, and its
 * recent landings with their credit trailers. Props in, markup out: the
 * route reads the listing, the asks and the landings (`src/client/project.ts`),
 * the code (its loader on the server, then `src/client/code.ts`) and the
 * platform URL (the root loader), and hands them here. "Propose an
 * ask" shows for signed-in members only, once the browser knows who that is
 * (`features/propose/propose-link.tsx`).
 */
import { Brand } from "@repo/brand";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { FileView, TreeListing } from "@repo/protocol/domain/code";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";

import { EntriesTable, ReadmeSection } from "../code/tree-view.tsx";
import { ReadingRows } from "../front/reading.tsx";
import { SignedInProposeLink } from "../propose/propose-link.tsx";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { When } from "../shared/time.tsx";
import { AskFields, AskStanding, ID, askPath } from "./asks.tsx";
import { LandingList } from "./landings.tsx";
import { postureLabel } from "./posture-label.ts";
import { ProjectNav } from "./project-nav.tsx";

/** A section's heading, the "title" step of the type scale. */
export const SECTION = "text-lg font-semibold tracking-[-0.01em]";

const AskRow = ({
  listing,
  project,
}: {
  readonly listing: AskListing;
  readonly project: ProjectName;
}) => (
  <li
    className="border-rule flex flex-col gap-2 border-t py-4"
    data-ask={listing.ask}
  >
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
      <a
        className={`${ID} decoration-rule font-medium underline hover:decoration-current`}
        href={askPath(project, listing.ask)}
      >
        {listing.ask}
      </a>
      <AskStanding listing={listing} project={project} />
    </div>
    <p className="max-w-[70ch] text-base">{listing.want}</p>
    <AskFields listing={listing} />
  </li>
);

/**
 * The landings section with none to show. Before the project's main first
 * lands, the push that lands it is its initializer's (`init` would refuse
 * now: the project exists). After it, the replay may still hold no landing
 * event, since adopting main is not one: say so, never "nothing landed".
 */
const NoLandings = ({
  listing,
  platformUrl,
}: {
  readonly listing: ProjectListing;
  readonly platformUrl: string;
}) =>
  listing.landedAt === undefined ? (
    <EmptyState
      command={`git push ${platformUrl}/${listing.project}.git HEAD:main`}
      title="Nothing has landed yet. The first push to main, by whoever ran init, lands it."
    />
  ) : (
    <EmptyState title="No landings among the project's recent events." />
  );

/** The steps that take a newcomer from a clone (the box above) to a checked answer. */
const steps = (project: ProjectName) =>
  [
    {
      command: `${Brand.cli} asks --project ${project}`,
      label: "See what it asks for",
    },
    { command: `${Brand.cli} claim <ask>`, label: "Claim one, in the clone" },
    {
      command: `${Brand.cli} check`,
      label: "Check your answer before you push",
    },
  ] as const;

/** A project's code as its page shows it: the root folder at main, and its README. */
export interface ProjectCode {
  readonly readme?: FileView | undefined;
  readonly root: TreeListing;
}

/** The clone line, whole and copyable, and where to go once cloned. */
const CloneBox = ({
  platformUrl,
  project,
}: {
  readonly platformUrl: string;
  readonly project: ProjectName;
}) => (
  <section
    aria-label="Clone"
    className="border-rule bg-surface flex flex-col gap-2 border px-4 py-3"
    data-clone=""
  >
    <h2 className="text-muted-foreground text-xs font-medium">
      Clone it with plain git
    </h2>
    <CommandLine command={`git clone ${platformUrl}/${project}.git`} />
  </section>
);

/** The root folder's entries at main, and the README below them. */
const CodeSection = ({
  code,
  project,
}: {
  readonly code: ProjectCode;
  readonly project: ProjectName;
}) => (
  <section aria-labelledby="code" className="flex min-w-0 flex-col gap-3">
    <h2 className={SECTION} id="code">
      <a
        className="decoration-rule underline hover:decoration-current"
        href={`/${project}/tree/main`}
      >
        Code
      </a>
    </h2>
    <EntriesTable entries={code.root.entries} project={project} rev="main" />
    {code.readme === undefined ? null : (
      <ReadmeSection file={code.readme} project={project} />
    )}
  </section>
);

export const ProjectView = ({
  asks,
  code,
  landings,
  listing,
  now,
  platformUrl,
}: {
  readonly asks: readonly AskListing[];
  /** The root folder at main and its README, once read; nothing is shown before. */
  readonly code?: ProjectCode | undefined;
  readonly landings: readonly LandingView[];
  readonly listing: ProjectListing;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
}) => {
  const { project } = listing;

  return (
    <PageShell title={project}>
      <ProjectNav current="overview" project={project} />
      <div className="text-muted-foreground -mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <PostureBadge
          label={postureLabel(listing.posture)}
          posture={listing.posture}
        />
        <span>
          {listing.openAsks} open {listing.openAsks === 1 ? "ask" : "asks"}
        </span>
        <span>
          {listing.landedAt === undefined ? (
            "Nothing landed yet"
          ) : (
            <>
              Last landed <When at={listing.landedAt} now={now} />
            </>
          )}
        </span>
      </div>
      <CloneBox platformUrl={platformUrl} project={project} />
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-labelledby="open-asks"
          className="flex min-w-0 flex-col gap-3 lg:col-start-1"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className={SECTION} id="open-asks">
              Open asks
            </h2>
            <SignedInProposeLink project={project} />
          </div>
          {asks.length === 0 ? (
            <EmptyState
              command={`${Brand.cli} ask open <ask> --files <files>`}
              title="No open asks. A decider opens one from an ask file."
            />
          ) : (
            <ol className="border-rule flex flex-col border-b">
              {asks.map((ask) => (
                <AskRow key={ask.ask} listing={ask} project={project} />
              ))}
            </ol>
          )}
        </section>
        <aside
          aria-labelledby="take-part"
          className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <h2 className={SECTION} id="take-part">
            Take part
          </h2>
          <ol className="border-rule flex flex-col gap-4 border-t pt-4">
            {steps(project).map(({ command, label }) => (
              <li className="flex min-w-0 flex-col gap-1.5" key={command}>
                <span className="text-muted-foreground text-xs font-medium">
                  {label}
                </span>
                <CommandLine command={command} />
              </li>
            ))}
          </ol>
        </aside>
        <section
          aria-labelledby="recent-landings"
          className="flex min-w-0 flex-col gap-3 lg:col-start-1"
        >
          <h2 className={SECTION} id="recent-landings">
            Recent landings
          </h2>
          {landings.length === 0 ? (
            <NoLandings listing={listing} platformUrl={platformUrl} />
          ) : (
            <LandingList landings={landings} now={now} />
          )}
        </section>
      </div>
      {code === undefined ? null : (
        <CodeSection code={code} project={project} />
      )}
    </PageShell>
  );
};

/**
 * The page as the server sends it, while the browser reads the asks and
 * landings: the clone line, rows holding their place, and the code the
 * server read with the page (its root folder and README), so a reader
 * without JavaScript, and a crawler, still gets the README.
 */
export const ProjectReadingView = ({
  code,
  platformUrl,
  project,
}: {
  /** The root folder at main and its README, when the server could read them. */
  readonly code?: ProjectCode | undefined;
  readonly platformUrl: string;
  readonly project: ProjectName;
}) => (
  <PageShell title={project}>
    <ProjectNav current="overview" project={project} />
    <CloneBox platformUrl={platformUrl} project={project} />
    <ReadingRows />
    {code === undefined ? null : <CodeSection code={code} project={project} />}
  </PageShell>
);
