import { Brand } from "@repo/brand";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { ArrowRight } from "lucide-react";

import type { AskProgress } from "../shared/ask-progress.ts";
import { CommandLine } from "../shared/command.tsx";
import {
  FactBlock,
  FamilyFacts,
  PostureFacts,
  TerritoryFacts,
} from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { MetaCode } from "../shared/row.tsx";
import { FactsSkeleton } from "../shared/skeleton.tsx";
import { StatusLine } from "../shared/status-line.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

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

/** A server route, so a plain link. */
export const ForAgents = ({ href }: { readonly href: string }) => (
  <p className="text-ui text-muted-foreground border-rule border-t pt-3 first:border-t-0">
    For agents:{" "}
    <a className={`text-foreground text-mono font-mono ${LINK}`} href={href}>
      {href.slice(1)}
    </a>
  </p>
);

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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

export interface SelectedFamily {
  readonly parent: Ask;
  readonly finale: AskId;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}

export interface SelectedPosture {
  readonly label: string;
  readonly posture: Posture;
}

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
  readonly takeable: boolean;
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
          <p className="text-want font-medium" data-said="">
            {listing.want}
          </p>
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
