import { Brand } from "@repo/brand";
import type {
  DiscussionListing,
  DiscussionState,
} from "@repo/protocol/domain/discussion";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath, discussionPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Every state reads as a word beside its mark, never by colour alone. */
export const STATE_LABEL = {
  asked: "Became an ask",
  closed: "Closed",
  open: "Open",
} as const satisfies Record<DiscussionState, string>;

export const openCommand = (project: ProjectName) =>
  `${Brand.cli} discussion post --project ${project} --title "<title>" --body "<post>"`;

export const replyCommand = (
  listing: Pick<DiscussionListing, "id" | "project">
) =>
  `${Brand.cli} discussion post ${listing.id} --project ${listing.project} --body "<post>"`;

const Row = ({
  listing,
  now,
}: {
  readonly listing: DiscussionListing;
  readonly now: DateTime.Utc;
}) => (
  <li
    className="border-rule flex min-w-0 flex-col gap-1 border-b py-3"
    data-discussion={listing.id}
    data-state={listing.state}
  >
    <AppLink
      className={`text-ui font-medium ${LINK}`}
      to={discussionPath(listing.project, listing.id)}
    >
      {listing.title}
    </AppLink>
    <p className="text-label text-muted-foreground flex flex-wrap gap-x-3">
      <span>
        <code className="text-mono font-mono">{listing.id}</code>
      </span>
      <span>
        {"opened by "}
        <HandleLink handle={listing.opener} />
      </span>
      <span>{plural(listing.posts, "post", "posts")}</span>
      <span>
        {"last post "}
        <When at={listing.lastPostAt} now={now} />
      </span>
      <span>{STATE_LABEL[listing.state]}</span>
      {listing.ask === undefined ? null : (
        <AppLink
          className={`text-mono font-mono ${LINK}`}
          to={askPath(listing.project, listing.ask)}
        >
          {listing.ask}
        </AppLink>
      )}
    </p>
  </li>
);

const PostFacts = ({ project }: { readonly project: ProjectName }) => (
  <FactBlock label="How to post">
    <p className="text-ui">
      Anyone not denounced may open a thread or reply, from a terminal. A
      discussion lands nothing itself; a maintainer may open an ask from one.
    </p>
    <CommandLine command={openCommand(project)} numbered />
  </FactBlock>
);

export const DiscussionsView = ({
  discussions,
  now,
  project,
}: {
  readonly discussions: readonly DiscussionListing[];
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}): ReactNode => (
  <Workspace
    count={plural(discussions.length, "discussion", "discussions")}
    facts={<PostFacts project={project} />}
    factsHeading="Discussions here"
    title="Discussions"
    variant="list"
  >
    {discussions.length === 0 ? (
      <EmptyState
        command={openCommand(project)}
        title="No discussions yet. Open one from a terminal; anyone not denounced may."
      />
    ) : (
      <ul className="border-rule flex flex-col border-t" data-discussions="">
        {discussions.map((listing) => (
          <Row key={listing.id} listing={listing} now={now} />
        ))}
      </ul>
    )}
  </Workspace>
);
