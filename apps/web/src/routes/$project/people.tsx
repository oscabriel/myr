import {
  RegistryProvider,
  useAtomMount,
  useAtomValue,
} from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { PublicPolicy } from "@repo/protocol/domain/policy";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { ledgerAtom } from "../../client/ledger.ts";
import { policyAtom } from "../../client/policy.ts";
import { watchAtom } from "../../client/watch.ts";
import { PeopleView } from "../../features/project-people/people-view.tsx";
import { UnknownProjectView } from "../../features/project/unknown-project.tsx";
import { pageTitle } from "../../features/shared/layout.tsx";
import { serverClient } from "../../server/client.ts";

// Who decides what in a project, who is vouched for, and who reads and
// writes each layer: the evaluated policy at the landed commit beside the
// ledger. The loader reads both on the server, so the page arrives whole
// and an address naming no project is a 404; in the browser each reads
// again as the platform lands changes and appends entries.

/** What the page's loader carries from the server, encoded: the policy (absent until evaluated) and the ledger. */
const PeoplePageData = Schema.Struct({
  ledger: Ledger,
  policy: Schema.optionalKey(PublicPolicy),
});

type PeoplePageData = typeof PeoplePageData.Type;

/** The policy and ledger of the project `name`, or a not-found when there is no such project (a 404). */
export const readPeople = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const [{ policy }, ledger] = yield* Effect.all(
      [client.projectPolicy({ project }), client.ledger({ project })],
      { concurrency: 2 }
    ).pipe(Effect.catchTag("UnknownProject", () => Effect.fail(notFound())));

    return yield* Schema.encodeEffect(PeoplePageData)(
      policy === undefined ? { ledger } : { ledger, policy }
    );
  });

const peoplePage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(readPeople(data).pipe(Effect.provide(serverClient(env))))
  );

/** The page over the two atoms, which start from what the loader read and read again as the project changes. */
const FreshPeople = ({
  project,
  read,
}: {
  readonly project: ProjectName;
  readonly read: PeoplePageData;
}) => {
  // Live: a landing re-reads the policy, a ledger entry the layers.
  useAtomMount(watchAtom(project));

  const { policy } = Option.getOrElse(
    AsyncResult.value(useAtomValue(policyAtom(project))),
    () => read
  );

  const ledger = Option.getOrElse(
    AsyncResult.value(useAtomValue(ledgerAtom(project))),
    () => read.ledger
  );

  return (
    <PeopleView
      ledger={ledger}
      policy={Option.fromUndefinedOr(policy)}
      project={project}
    />
  );
};

const PeoplePage = () => {
  const read = Schema.decodeSync(PeoplePageData)(Route.useLoaderData());
  const { project } = read.ledger;

  return (
    <RegistryProvider
      initialValues={[
        Atom.initialValue(
          policyAtom(project),
          AsyncResult.success(
            read.policy === undefined ? {} : { policy: read.policy }
          )
        ),
        Atom.initialValue(
          ledgerAtom(project),
          AsyncResult.success(read.ledger)
        ),
      ]}
      key={project}
    >
      <FreshPeople project={project} read={read} />
    </RegistryProvider>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$project/people")({
  loader: ({ params }) => peoplePage({ data: params.project }),
  head: ({ params: { project } }) => ({
    meta: [{ title: pageTitle(`${project}: people`) }],
  }),
  component: PeoplePage,
  notFoundComponent: Unknown,
});
