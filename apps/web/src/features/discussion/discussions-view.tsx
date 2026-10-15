import type {
  DiscussionListing,
  DiscussionState,
} from "@repo/protocol/domain/discussion";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { EmptyState } from "../shared/empty.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath, discussionPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { PostForm } from "./post-form.tsx";
import type { Poster } from "./post-form.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Every state reads as a word beside its mark, never by colour alone. */
export const STATE_LABEL = {
  asked: "Became an ask",
  closed: "Closed",
  open: "Open",
} as const satisfies Record<DiscussionState, string>;

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

const PostFacts = () => (
  <FactBlock label="Who may post">
    <p className="text-ui">
      Anyone not denounced may open a thread or reply. A discussion lands
      nothing itself; a maintainer may open an ask from one.
    </p>
  </FactBlock>
);

const OpenOne = ({ poster }: { readonly poster: Poster }) => (
  <section
    aria-labelledby="open-a-discussion"
    className="flex flex-col gap-3"
    data-open-discussion=""
  >
    <h2 className="text-ui font-semibold" id="open-a-discussion">
      Open a discussion
    </h2>
    <PostForm {...poster} doing="open a discussion" kind="open" />
  </section>
);

/** Without a `poster`, the list alone: no way to post is drawn. */
export const DiscussionsView = ({
  discussions,
  now,
  poster,
}: {
  readonly discussions: readonly DiscussionListing[];
  readonly now: DateTime.Utc;
  readonly poster?: Poster | undefined;
}): ReactNode => (
  <Workspace
    count={plural(discussions.length, "discussion", "discussions")}
    facts={<PostFacts />}
    factsHeading="Discussions here"
    title="Discussions"
    variant="list"
  >
    {discussions.length === 0 ? (
      <EmptyState title="No discussions yet." />
    ) : (
      <ul className="border-rule flex flex-col border-t" data-discussions="">
        {discussions.map((listing) => (
          <Row key={listing.id} listing={listing} now={now} />
        ))}
      </ul>
    )}
    {poster === undefined ? null : <OpenOne poster={poster} />}
  </Workspace>
);
