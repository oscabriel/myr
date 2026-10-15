import type {
  Discussion,
  DiscussionPost,
} from "@repo/protocol/domain/discussion";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { STATE_LABEL } from "./discussions-view.tsx";
import { PostForm } from "./post-form.tsx";
import type { Poster } from "./post-form.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

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
  discussion.ask === undefined ? null : (
    <p className="text-ui" data-became={discussion.ask}>
      {"A maintainer opened the ask "}
      <AppLink
        className={`text-mono font-mono ${LINK}`}
        to={askPath(discussion.project, discussion.ask)}
      >
        {discussion.ask}
      </AppLink>
      {" from this discussion."}
    </p>
  );

const ThreadFacts = ({ discussion }: { readonly discussion: Discussion }) => (
  <FactBlock label="This discussion">
    {discussion.state === "open" ? (
      <p className="text-ui">
        Anyone not denounced may reply. A maintainer may open an ask from the
        thread.
      </p>
    ) : (
      <p className="text-ui">
        {discussion.state === "closed"
          ? "This discussion is closed: it takes no more posts."
          : "This discussion became an ask: it takes no more posts."}
      </p>
    )}
  </FactBlock>
);

const ReplyHere = ({ poster }: { readonly poster: Poster }) => (
  <section
    aria-labelledby="reply-here"
    className="flex flex-col gap-3"
    data-reply=""
  >
    <h2 className="text-ui font-semibold" id="reply-here">
      Reply
    </h2>
    <PostForm {...poster} doing="reply" kind="reply" />
  </section>
);

/** Without a `poster`, the thread alone; a closed or asked thread takes no reply. */
export const DiscussionView = ({
  discussion,
  now,
  poster,
}: {
  readonly discussion: Discussion;
  readonly now: DateTime.Utc;
  readonly poster?: Poster | undefined;
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
    {poster === undefined || discussion.state !== "open" ? null : (
      <ReplyHere poster={poster} />
    )}
  </Workspace>
);
