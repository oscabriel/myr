import {
  RegistryProvider,
  useAtomMount,
  useAtomValue,
} from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { envSchemaAtom } from "../../../client/env.ts";
import { watchAtom } from "../../../client/watch.ts";
import { EnvView, NothingLanded } from "../../../features/env/env-page.tsx";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { useProjectList } from "../../../features/shared/shell/context.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

const EnvPageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  schema: Schema.UndefinedOr(EnvSchemaView),
});

type EnvPageData = typeof EnvPageData.Type;

// Before a project's first landing `envShape` names no project, so whether it exists is `listAsks`' to say.
export const readEnv = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const schema = yield* client.envShape({ project }).pipe(
      Effect.asSome,
      Effect.catchTag("UnknownProject", () =>
        client.listAsks({ project }).pipe(
          Effect.as(Option.none<EnvSchemaView>()),
          Effect.catchTag("UnknownProject", () => Effect.fail(notFound()))
        )
      )
    );

    return yield* Schema.encodeEffect(EnvPageData)({
      now: yield* DateTime.now,
      project,
      schema: Option.getOrUndefined(schema),
    });
  });

const envPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(readEnv(data).pipe(Effect.provide(serverClient(env))))
  );

const FreshEnv = ({
  atom,
  now,
  read,
}: {
  readonly atom: ReturnType<typeof envSchemaAtom>;
  readonly now: DateTime.Utc;
  readonly read: EnvSchemaView;
}) => {
  useAtomMount(watchAtom(read.project));

  const schema = Option.getOrElse(
    AsyncResult.value(useAtomValue(atom)),
    () => read
  );

  // The posture rides with the list of projects, which may come after the page.
  const posture = useProjectList()?.find(
    (listing) => listing.project === read.project
  )?.posture;

  return <EnvView now={now} posture={posture} schema={schema} />;
};

const EnvPage = () => {
  const { now, project, schema } = Schema.decodeSync(EnvPageData)(
    Route.useLoaderData()
  );

  if (schema === undefined) {
    return <NothingLanded project={project} />;
  }

  const atom = envSchemaAtom(project);

  return (
    <RegistryProvider
      initialValues={[Atom.initialValue(atom, AsyncResult.success(schema))]}
      key={project}
    >
      <FreshEnv atom={atom} now={now} read={schema} />
    </RegistryProvider>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$owner/$project/env")({
  loader: ({ params }) => envPage({ data: params.project }),
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Env shape · ${project}`,
      description: `${project}'s env items, never a value.`,
    }),
  component: EnvPage,
  notFoundComponent: Unknown,
});
