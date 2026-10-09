/**
 * A project's page: its posture, how to take part, its open asks, and its
 * recent landings with their credit trailers. Props in, markup out: the
 * route reads the listing, the asks and the landings (`src/client/project.ts`)
 * and the platform URL (the root loader), and hands them here.
 */
import { Brand } from "@repo/brand";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";

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

/** The steps that take a newcomer from nothing to a checked answer. */
const steps = (project: ProjectName, platformUrl: string) =>
  [
    {
      command: `git clone ${platformUrl}/${project}.git`,
      label: "Clone it with plain git",
    },
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

export const ProjectView = ({
  asks,
  landings,
  listing,
  now,
  platformUrl,
}: {
  readonly asks: readonly AskListing[];
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
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-labelledby="open-asks"
          className="flex min-w-0 flex-col gap-3 lg:col-start-1"
        >
          <h2 className={SECTION} id="open-asks">
            Open asks
          </h2>
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
            {steps(project, platformUrl).map(({ command, label }) => (
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
    </PageShell>
  );
};
