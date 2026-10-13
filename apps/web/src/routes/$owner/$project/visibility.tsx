import {
  RegistryProvider,
  useAtomMount,
  useAtomValue,
} from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { envSchemaAtom } from "../../../client/env.ts";
import { ledgerAtom } from "../../../client/ledger.ts";
import { watchAtom } from "../../../client/watch.ts";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { VisibilityView } from "../../../features/visibility/visibility-page.tsx";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

export const VisibilityPageData = Schema.Struct({
  env: Schema.UndefinedOr(EnvSchemaView),
  ledger: Ledger,
  now: Schema.DateTimeUtcFromString,
});

type VisibilityPageData = typeof VisibilityPageData.Type;

// The ledger answers for every project the platform knows; the env's schema only once its main has landed, so the
// ledger says whether the project exists and the schema's `UnknownProject` means nothing has landed yet.
export const readVisibility = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const { ledger, schema } = yield* Effect.all(
      {
        ledger: client
          .ledger({ project })
          .pipe(
            Effect.catchTag("UnknownProject", () => Effect.fail(notFound()))
          ),
        schema: client.envShape({ project }).pipe(
          Effect.asSome,
          Effect.catchTag("UnknownProject", () =>
            Effect.succeedNone
          )
        ),
      },
      { concurrency: "unbounded" }
    );

    return yield* Schema.encodeEffect(VisibilityPageData)({
      env: Option.getOrUndefined(schema),
      ledger,
      now: yield* DateTime.now,
    });
  });

const visibilityPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readVisibility(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const FreshVisibility = ({
  env,
  ledger,
  read,
}: {
  readonly env: EnvSchemaView | undefined;
  readonly ledger: ReturnType<typeof ledgerAtom>;
  readonly read: VisibilityPageData;
}) => {
  useAtomMount(watchAtom(read.ledger.project));

  const fresh = Option.getOrElse(
    AsyncResult.value(useAtomValue(ledger)),
    () => read.ledger
  );

  return <VisibilityView env={env} ledger={fresh} now={read.now} />;
};

// Read again only once a main has landed: before one, there is no schema to read.
const WithFreshEnv = ({
  env,
  ledger,
  read,
  schema,
}: {
  readonly env: ReturnType<typeof envSchemaAtom>;
  readonly ledger: ReturnType<typeof ledgerAtom>;
  readonly read: VisibilityPageData;
  readonly schema: EnvSchemaView;
}) => (
  <FreshVisibility
    env={Option.getOrElse(AsyncResult.value(useAtomValue(env)), () => schema)}
    ledger={ledger}
    read={read}
  />
);

const VisibilityPage = () => {
  const read = Schema.decodeSync(VisibilityPageData)(Route.useLoaderData());
  const { project } = read.ledger;
  const ledger = ledgerAtom(project);
  const env = envSchemaAtom(project);

  return (
    <RegistryProvider
      initialValues={[
        Atom.initialValue(ledger, AsyncResult.success(read.ledger)),
        ...(read.env === undefined
          ? []
          : [Atom.initialValue(env, AsyncResult.success(read.env))]),
      ]}
      key={project}
    >
      {read.env === undefined ? (
        <FreshVisibility env={undefined} ledger={ledger} read={read} />
      ) : (
        <WithFreshEnv env={env} ledger={ledger} read={read} schema={read.env} />
      )}
    </RegistryProvider>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$owner/$project/visibility")({
  staticData: { shell: "project" },
  loader: ({ params }) => visibilityPage({ data: params.project }),
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Visibility · ${project}`,
      description: `${project}'s posture, layers, held-back checks, environment and ledger; never a value.`,
    }),
  component: VisibilityPage,
  notFoundComponent: Unknown,
});
