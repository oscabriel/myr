import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Client, ListDiscussions } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { discussionsAtom } from "../../../../client/discussion.ts";
import { SeededAtoms, seedSuccess } from "../../../../client/seeded.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { DiscussionsView } from "../../../../features/discussion/discussions-view.tsx";
import { UnknownProjectView } from "../../../../features/project/unknown-project.tsx";
import { pageHead } from "../../../../features/shared/head.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";

type Listed = typeof ListDiscussions.successSchema.Type;

export const readDiscussions = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const listed = yield* client
      .listDiscussions({ project })
      .pipe(Effect.catchTag("UnknownProject", () => Effect.fail(notFound())));

    return {
      listed: yield* Schema.encodeEffect(ListDiscussions.successSchema)(listed),
      project,
    };
  });

const discussionsPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readDiscussions(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const FreshDiscussions = ({
  project,
  read,
}: {
  readonly project: ProjectName;
  readonly read: Listed;
}) => {
  useAtomMount(watchAtom(project));

  const { discussions } = Option.getOrElse(
    AsyncResult.value(useAtomValue(discussionsAtom(project))),
    () => read
  );

  return (
    <DiscussionsView
      discussions={discussions}
      now={DateTime.nowUnsafe()}
      project={project}
    />
  );
};

const DiscussionsPage = () => {
  const { listed, project } = Route.useLoaderData();
  const read = Schema.decodeSync(ListDiscussions.successSchema)(listed);
  const name = ProjectName.make(project);

  return (
    <SeededAtoms
      id={`${name}/discussions`}
      seeds={[seedSuccess(discussionsAtom(name), read)]}
    >
      <FreshDiscussions project={name} read={read} />
    </SeededAtoms>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$owner/$project/discussions/")({
  staticData: { shell: "project" },
  loader: ({ params }) => discussionsPage({ data: params.project }),
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Discussions · ${project}`,
      description: `${project}'s discussions: public threads that land nothing themselves.`,
    }),
  component: DiscussionsPage,
  notFoundComponent: Unknown,
});
