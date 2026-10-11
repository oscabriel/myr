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

import { envSchemaAtom } from "../../client/env.ts";
import { watchAtom } from "../../client/watch.ts";
import { EnvView, NothingLanded } from "../../features/env/env-page.tsx";
import { UnknownProjectView } from "../../features/project/unknown-project.tsx";
import { pageHead } from "../../features/shared/head.ts";
import { useProjectList } from "../../features/shared/shell/context.ts";
import { branchPage } from "../../server/cache-headers.ts";
import { serverClient } from "../../server/client.ts";

// A project's env shape, as anyone may read it: never a value, and no form
// (a value is set from a terminal only). The loader reads it on the server,
// so the page arrives whole and an address naming no project is a 404
// showing the platform's `UnknownProject` refusal; in the browser it reads
// again when a value is set or a landing changes the schema.

/**
 * What the page's loader carries from the server, encoded: the project, its
 * env shape (absent before its main first lands), and when it was read.
 */
const EnvPageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  schema: Schema.UndefinedOr(EnvSchemaView),
});

type EnvPageData = typeof EnvPageData.Type;

/**
 * The env shape of the project `name`; none when nothing has landed there
 * yet; or a not-found when there is no such project (a 404). Before a
 * project's first landing `envShape` has no commit to read and names no
 * project, so whether the project exists is `listAsks`' to say.
 */
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

/** The page over the env shape's atom, which starts from what the loader read and reads again when the env shape changes. */
const FreshEnv = ({
  atom,
  now,
  read,
}: {
  readonly atom: ReturnType<typeof envSchemaAtom>;
  readonly now: DateTime.Utc;
  readonly read: EnvSchemaView;
}) => {
  // Live: a value set, or a landing, makes the env shape read again.
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

export const Route = createFileRoute("/$project/env")({
  loader: ({ params }) => envPage({ data: params.project }),
  // The env shape moves with the next landing or value set: kept briefly, read again behind.
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Env shape · ${project}`,
      description: `${project}'s env items, never a value.`,
    }),
  component: EnvPage,
  notFoundComponent: Unknown,
});
