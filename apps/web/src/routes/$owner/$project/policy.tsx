import {
  RegistryProvider,
  useAtomMount,
  useAtomValue,
} from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { PolicyPending, PublicPolicy } from "@repo/protocol/domain/policy";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema, Struct } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { ledgerAtom } from "../../../client/ledger.ts";
import { policyAtom } from "../../../client/policy.ts";
import { watchAtom } from "../../../client/watch.ts";
import { PeopleView } from "../../../features/project-people/people-view.tsx";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

// The project's policy page; it was `/people` until the People tab folded into it.

const PeoplePageData = Schema.Struct({
  ledger: Ledger,
  policy: Schema.optionalKey(PublicPolicy),
  unevaluated: Schema.optionalKey(PolicyPending),
});

type PeoplePageData = typeof PeoplePageData.Type;

export const readPeople = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const [read, ledger] = yield* Effect.all(
      [client.projectPolicy({ project }), client.ledger({ project })],
      { concurrency: 2 }
    ).pipe(Effect.catchTag("UnknownProject", () => Effect.fail(notFound())));

    return yield* Schema.encodeEffect(PeoplePageData)({ ...read, ledger });
  });

const peoplePage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(readPeople(data).pipe(Effect.provide(serverClient(env))))
  );

const FreshPeople = ({
  project,
  read,
}: {
  readonly project: ProjectName;
  readonly read: PeoplePageData;
}) => {
  useAtomMount(watchAtom(project));

  const { policy, unevaluated } = Option.getOrElse(
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
      unevaluated={Option.fromUndefinedOr(unevaluated)}
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
          AsyncResult.success(Struct.pick(read, ["policy", "unevaluated"]))
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

export const Route = createFileRoute("/$owner/$project/policy")({
  staticData: { shell: "project" },
  loader: ({ params }) => peoplePage({ data: params.project }),
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Policy · ${project}`,
      description: `${project}'s maintainers and limits.`,
    }),
  component: PeoplePage,
  notFoundComponent: Unknown,
});
