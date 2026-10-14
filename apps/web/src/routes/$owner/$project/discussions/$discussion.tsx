import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Client, ShowDiscussion } from "@repo/protocol/contracts";
import { DiscussionId, ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { discussionAtom } from "../../../../client/discussion.ts";
import { SeededAtoms, seedSuccess } from "../../../../client/seeded.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { NotFoundView } from "../../../../features/ask/refused.tsx";
import { DiscussionView } from "../../../../features/discussion/discussion-view.tsx";
import { pageHead } from "../../../../features/shared/head.ts";
import { notFoundFor, Refusals } from "../../../../features/shared/refusals.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";

type Shown = typeof ShowDiscussion.successSchema.Type;

export const readDiscussion = (name: string, id: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const discussion = yield* Schema.decodeEffect(DiscussionId)(id).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const shown = yield* client.showDiscussion({ discussion, project }).pipe(
      Effect.catchTags({
        UnknownDiscussion: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(ShowDiscussion.successSchema)(shown);
  });

const discussionPage = createServerFn({ method: "GET" })
  .validator(
    (params: { readonly discussion: string; readonly project: string }) =>
      params
  )
  .handler(({ data }) =>
    Effect.runPromise(
      readDiscussion(data.project, data.discussion).pipe(
        Effect.provide(serverClient(env))
      )
    )
  );

const FreshDiscussion = ({
  project,
  read,
}: {
  readonly project: ProjectName;
  readonly read: Shown;
}) => {
  useAtomMount(watchAtom(project));

  const { discussion } = Option.getOrElse(
    AsyncResult.value(
      useAtomValue(discussionAtom(project)(read.discussion.id))
    ),
    () => read
  );

  return <DiscussionView discussion={discussion} now={DateTime.nowUnsafe()} />;
};

const DiscussionPage = () => {
  const read = Schema.decodeSync(ShowDiscussion.successSchema)(
    Route.useLoaderData()
  );

  const { id, project } = read.discussion;

  return (
    <SeededAtoms
      id={`${project}/${id}`}
      seeds={[seedSuccess(discussionAtom(project)(id), read)]}
    >
      <FreshDiscussion project={project} read={read} />
    </SeededAtoms>
  );
};

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

const Unknown = ({ data }: { readonly data?: unknown }) => (
  <NotFoundView
    nothing="Nothing is at this address: a project's name is lowercase words joined by single dashes, and a discussion's id reads disc- and six digits."
    refusals={Option.getOrUndefined(decodeRefusals(data))}
    title="No such discussion"
  />
);

export const Route = createFileRoute(
  "/$owner/$project/discussions/$discussion"
)({
  staticData: { shell: "project" },
  loader: ({ params }) => discussionPage({ data: params }),
  headers: () => branchPage,
  head: ({ loaderData, params: { discussion, project } }) =>
    pageHead(
      loaderData === undefined
        ? { title: `${discussion} · ${project}` }
        : {
            description: loaderData.discussion.title,
            title: `${loaderData.discussion.title} · ${project}`,
          }
    ),
  component: DiscussionPage,
  notFoundComponent: Unknown,
});
