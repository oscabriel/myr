import {
  RegistryProvider,
  useAtomMount,
  useAtomValue,
} from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { ledgerAtom } from "../../../client/ledger.ts";
import { watchAtom } from "../../../client/watch.ts";
import { LedgerView } from "../../../features/ledger/ledger-page.tsx";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

// A project's ledger, as anyone may read it. The loader reads it on the
// server, so the page arrives whole and an address naming no project is a
// 404 showing the platform's `UnknownProject` refusal; in the browser the
// ledger reads again as the platform appends entries.

/** What the page's loader carries from the server, encoded: the ledger, and when it was read. */
const LedgerPageData = Schema.Struct({
  ledger: Ledger,
  now: Schema.DateTimeUtcFromString,
});

type LedgerPageData = typeof LedgerPageData.Type;

/** The ledger of the project `name`, or a not-found when there is no such project (a 404). */
export const readLedger = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const ledger = yield* client
      .ledger({ project })
      .pipe(Effect.catchTag("UnknownProject", () => Effect.fail(notFound())));

    return yield* Schema.encodeEffect(LedgerPageData)({
      ledger,
      now: yield* DateTime.now,
    });
  });

const ledgerPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(readLedger(data).pipe(Effect.provide(serverClient(env))))
  );

/** The page over the ledger's atom, which starts from what the loader read and reads again when the ledger changes. */
const FreshLedger = ({
  atom,
  read,
}: {
  readonly atom: ReturnType<typeof ledgerAtom>;
  readonly read: LedgerPageData;
}) => {
  // Live: each entry the platform appends makes the ledger read again.
  useAtomMount(watchAtom(read.ledger.project));

  const ledger = Option.getOrElse(
    AsyncResult.value(useAtomValue(atom)),
    () => read.ledger
  );

  return <LedgerView ledger={ledger} now={read.now} />;
};

const LedgerPage = () => {
  const read = Schema.decodeSync(LedgerPageData)(Route.useLoaderData());
  const atom = ledgerAtom(read.ledger.project);

  return (
    <RegistryProvider
      initialValues={[
        Atom.initialValue(atom, AsyncResult.success(read.ledger)),
      ]}
      key={read.ledger.project}
    >
      <FreshLedger atom={atom} read={read} />
    </RegistryProvider>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$owner/$project/ledger")({
  loader: ({ params }) => ledgerPage({ data: params.project }),
  // A ledger moves with the project's next entry: kept briefly, read again behind.
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Ledger · ${project}`,
      description: `${project}'s layers and sealed checks.`,
    }),
  component: LedgerPage,
  notFoundComponent: Unknown,
});
