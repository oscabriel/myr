/**
 * The facts a list of asks shows beside it: with nothing selected on the
 * front page, where to start and every project with its posture; with an
 * ask selected (the front page and a project's home alike), that ask's
 * state, how to take it, where it may change things, its family and its
 * project's posture, and the way to its page.
 *
 * Only what the list read is needed to draw them; what the full ask adds
 * (its territory's paths, its check, its mentor) fills in once the browser
 * has read it, in a block of the same size.
 */
import { Brand } from "@repo/brand";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { ArrowRight } from "lucide-react";

import { postureLabel } from "../project/posture-label.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { CommandLine } from "../shared/command.tsx";
import {
  FactBlock,
  FamilyFacts,
  PostureFacts,
  TerritoryFacts,
} from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath, projectPath } from "../shared/paths.ts";
import { PostureBadge } from "../shared/posture.tsx";
import { MetaCode } from "../shared/row.tsx";
import { FactsSkeleton } from "../shared/skeleton.tsx";
import { StatusLine } from "../shared/status-line.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

/** One numbered step: what it does, then its command. */
export const Step = ({
  command,
  label,
}: {
  readonly command: string;
  readonly label: string;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-label text-muted-foreground">{label}</p>
    <CommandLine command={command} numbered />
  </div>
);

/** A link onward, at a block's foot. */
export const Onward = ({
  children,
  to,
}: {
  readonly children: string;
  readonly to: string;
}) => (
  <AppLink
    className="text-ui decoration-rule inline-flex items-center gap-1.5 self-start underline hover:decoration-current"
    to={to}
  >
    {children}
    <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
  </AppLink>
);

/** Where an agent reads the same thing: a server route, so a plain link. */
export const ForAgents = ({ href }: { readonly href: string }) => (
  <p className="text-ui text-muted-foreground border-rule border-t pt-3 first:border-t-0">
    For agents:{" "}
    <a className={`text-foreground text-mono font-mono ${LINK}`} href={href}>
      {href.slice(1)}
    </a>
  </p>
);

/** The three ways in from the front page: the CLI, the asks it lists, a claim. */
export const StartHere = ({ webUrl }: { readonly webUrl: string }) => (
  <FactBlock label="Take an ask">
    <Step
      command={`curl -fsSL ${webUrl}/install.sh | sh`}
      label="Install the command line"
    />
    <Step command={`${Brand.cli} front`} label="List every open ask" />
    <Step
      command={`${Brand.cli} claim <ask> --project <project>`}
      label="Claim one you may take"
    />
    <ForAgents href="/llms.txt" />
  </FactBlock>
);

/** A count and its noun: "1 open ask", "7 open asks". */
export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Every project the platform lists, its posture and its open asks; bars until the list arrives. */
export const ProjectsFacts = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[] | undefined;
}) =>
  projects === undefined ? (
    <FactsSkeleton labels={["Projects"]} />
  ) : (
    <FactBlock label="Projects">
      <ul className="flex flex-col">
        {projects.map((listing) => (
          <li
            className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 py-1"
            data-project={listing.project}
            key={listing.project}
          >
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <AppLink
                className="text-ui decoration-rule truncate font-semibold no-underline hover:underline"
                to={projectPath(listing.project)}
              >
                {listing.project}
              </AppLink>
              <span className="text-label text-muted-foreground shrink-0 tabular-nums">
                {plural(listing.openAsks, "open ask", "open asks")}
              </span>
            </span>
            <PostureBadge
              label={postureLabel(listing.posture)}
              posture={listing.posture}
            />
          </li>
        ))}
      </ul>
    </FactBlock>
  );

/** Who may take an ask, from what its listing says (the full ask adds the mentor). */
const whoMayTake = (
  listing: AskListing,
  project: ProjectName,
  full: Ask | undefined
) => {
  if (listing.reserve === "newcomers") {
    return full?.mentor === undefined
      ? "Held for newcomers"
      : `Held for newcomers, mentored by ${full.mentor}`;
  }

  return listing.reserve === "people"
    ? "Held for people, not agents"
    : `Anyone vouched in ${project}, or with a record in its area`;
};

/** A family the selected ask belongs to, as the page knows it. */
export interface SelectedFamily {
  readonly parent: Ask;
  readonly finale: AskId;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}

/** The selected ask's project posture, in the platform's words. */
export interface SelectedPosture {
  readonly label: string;
  readonly posture: Posture;
}

/**
 * The selected ask: its state, how to take it (the claim numbered first),
 * where it may change things and what judges it, its family, its project's
 * posture, and its page.
 */
export const SelectedAskFacts = ({
  family,
  full,
  listing,
  platformUrl,
  posture,
  progress,
  project,
  takeable,
}: {
  readonly listing: AskListing;
  readonly project: ProjectName;
  /** Whether the viewer may take it (the front page knows); open and unheld when not known. */
  readonly takeable: boolean;
  /** The full ask, once the browser has read it. */
  readonly full: Ask | undefined;
  readonly progress: AskProgress | undefined;
  readonly family: SelectedFamily | undefined;
  readonly posture: SelectedPosture | undefined;
  readonly platformUrl: string;
}) => {
  const claim = `${Brand.cli} claim ${listing.ask} --project ${project}`;

  return (
    <>
      <FactBlock label="State">
        {full === undefined ? (
          <p className="text-want font-medium">{listing.want}</p>
        ) : (
          <StatusLine
            command={false}
            subject={{
              ask: full,
              claimant: progress?.claimant,
              kind: "ask",
              latest: progress?.latest,
              takeable,
            }}
          />
        )}
        <p className="text-ui text-muted-foreground">
          {listing.kind} · <MetaCode>{listing.ask}</MetaCode>
        </p>
      </FactBlock>
      <FactBlock label="Take it">
        <p className="text-ui">{whoMayTake(listing, project, full)}</p>
        {takeable ? (
          <>
            <Step command={claim} label="Claim it" />
            <Step
              command={`git clone ${platformUrl}/${project}.git`}
              label="Clone the project to answer in"
            />
            <Step
              command={`${Brand.cli} check`}
              label="Check your answer before you push"
            />
          </>
        ) : (
          <p className="text-ui text-muted-foreground">
            Not open to you now: its page says why.
          </p>
        )}
      </FactBlock>
      {full === undefined ? (
        <FactsSkeleton labels={["Territory and check"]} />
      ) : (
        <TerritoryFacts ask={full} />
      )}
      {family === undefined ? null : (
        <FamilyFacts
          current={listing.ask}
          finale={family.finale}
          parent={family.parent}
          project={project}
          states={family.states}
        />
      )}
      {posture === undefined ? null : (
        <PostureFacts
          label={posture.label}
          posture={posture.posture}
          project={project}
        />
      )}
      <FactBlock label="Its page">
        <Onward to={askPath(project, listing.ask)}>Open the ask</Onward>
      </FactBlock>
    </>
  );
};
