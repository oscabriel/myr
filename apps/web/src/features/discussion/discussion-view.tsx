import { Brand } from "@repo/brand";
import type {
  Discussion,
  DiscussionPost,
} from "@repo/protocol/domain/discussion";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { CommandLine } from "../shared/command.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { replyCommand, STATE_LABEL } from "./discussions-view.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

const proposalPath = (project: ProjectName, proposal: ProposalId) =>
  `/${project}/proposals/${proposal}`;

const Post = ({
  now,
  post,
}: {
  readonly now: DateTime.Utc;
  readonly post: DiscussionPost;
}) => (
  <article
    className="border-rule flex min-w-0 flex-col gap-2 border-b py-3"
    data-post={post.by}
  >
    <p className="text-label text-muted-foreground">
      <HandleLink handle={post.by} />
      {" · "}
      <When at={post.at} now={now} />
    </p>
    <p className="text-ui max-w-(--measure) [overflow-wrap:anywhere] whitespace-pre-wrap">
      {post.body}
    </p>
  </article>
);

const Became = ({ discussion }: { readonly discussion: Discussion }) =>
  discussion.proposal === undefined ? null : (
    <p className="text-ui" data-became={discussion.proposal}>
      {"A maintainer turned this discussion into "}
      <AppLink
        className={`text-mono font-mono ${LINK}`}
        to={proposalPath(discussion.project, discussion.proposal)}
      >
        {discussion.proposal}
      </AppLink>
      , which expires unless a maintainer accepts it.
    </p>
  );

const ThreadFacts = ({ discussion }: { readonly discussion: Discussion }) => (
  <FactBlock label="This discussion">
    {discussion.state === "open" ? (
      <>
        <p className="text-ui">
          Reply from a terminal; anyone not denounced may. A maintainer may turn
          the thread into a proposal with{" "}
          <code className="text-mono font-mono">{`${Brand.cli} propose --discussion ${discussion.id}`}</code>
          .
        </p>
        <CommandLine command={replyCommand(discussion)} numbered />
      </>
    ) : (
      <p className="text-ui">
        {discussion.state === "closed"
          ? "This discussion is closed: it takes no more posts."
          : "This discussion became a proposal: it takes no more posts."}
      </p>
    )}
  </FactBlock>
);

export const DiscussionView = ({
  discussion,
  now,
}: {
  readonly discussion: Discussion;
  readonly now: DateTime.Utc;
}): ReactNode => (
  <Workspace
    facts={<ThreadFacts discussion={discussion} />}
    factsHeading="This discussion"
    meta={
      <>
        <code className="text-mono font-mono">{discussion.id}</code>
        {" · opened by "}
        <HandleLink handle={discussion.opener} />{" "}
        <When at={discussion.openedAt} now={now} />
      </>
    }
    state={
      <span data-state={discussion.state}>{STATE_LABEL[discussion.state]}</span>
    }
    title={discussion.title}
    variant="document"
  >
    <Became discussion={discussion} />
    <div className="border-rule flex flex-col border-t" data-posts="">
      {discussion.posts.map((post, index) => (
        <Post key={index} now={now} post={post} />
      ))}
    </div>
  </Workspace>
);
