import { useAtom, useAtomValue } from "@effect/atom-react";
import type { Today } from "@repo/protocol/domain/decision";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { decideAtom } from "../client/decide.ts";
import { SeededAtoms, seedSuccess } from "../client/seeded.ts";
import { todayAtom } from "../client/today.ts";
import { InboxView } from "../features/inbox/inbox-page.tsx";
import {
  Decisions,
  InboxPageData,
  InboxRead,
  readInbox,
} from "../features/inbox/read.ts";
import { pageHead } from "../features/shared/head.ts";
import {
  reloadOnEnter,
  useSelection,
} from "../features/shared/shell/selection.ts";
import { personalPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";

const InboxSearch = Schema.Struct({
  decision: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(ProjectName),
});

type InboxSearch = typeof InboxSearch.Type;

const searchOf = Schema.decodeUnknownOption(InboxSearch);

// The reader's own page: never kept by the edge or the browser.
export const inboxHeaders = () => personalPage;

// The decisions read again after a choice replace the loaded ones; the rest of the page stays as it was read.
const withLiveDecisions = (
  read: InboxRead,
  result: AsyncResult.AsyncResult<Today, unknown>
): InboxRead =>
  InboxRead.guards.Read(read) &&
  Decisions.guards.Decides(read.decisions) &&
  AsyncResult.isSuccess(result)
    ? {
        ...read,
        decisions: Decisions.cases.Decides.make({ today: result.value }),
      }
    : read;

const inboxPage = createServerFn({ method: "GET" })
  .validator((search: { readonly project?: ProjectName }) => search)
  .handler(({ data }) =>
    Effect.runPromise(
      readInbox(data).pipe(Effect.provide(serverClient(env, getRequest())))
    )
  );

const LiveInbox = ({
  data,
  project,
}: {
  readonly data: InboxPageData;
  readonly project: ProjectName | undefined;
}) => {
  const result = useAtomValue(todayAtom(project));
  const [decided, decide] = useAtom(decideAtom);
  const { selected } = useSelection("decision");

  return (
    <InboxView
      decided={decided}
      now={data.now}
      onDecide={decide}
      read={withLiveDecisions(data.read, result)}
      selected={selected}
    />
  );
};

const InboxPage = () => {
  const { project } = Route.useSearch();
  const data = Schema.decodeSync(InboxPageData)(Route.useLoaderData());

  const seeds =
    InboxRead.guards.Read(data.read) &&
    Decisions.guards.Decides(data.read.decisions)
      ? [seedSuccess(todayAtom(project), data.read.decisions.today)]
      : [];

  return (
    <SeededAtoms id={`inbox/${project ?? ""}`} seeds={seeds}>
      <LiveInbox data={data} project={project} />
    </SeededAtoms>
  );
};

export const Route = createFileRoute("/inbox")({
  staticData: { shell: "project" },
  validateSearch: (search: {
    readonly decision?: unknown;
    readonly project?: unknown;
  }): InboxSearch => Option.getOrElse(searchOf(search), () => ({})),
  // A selection lives in the address; it never reads the inbox again.
  loaderDeps: ({ search }) =>
    search.project === undefined ? {} : { project: search.project },
  loader: ({ deps }) => inboxPage({ data: deps }),
  shouldReload: reloadOnEnter,
  headers: inboxHeaders,
  head: () => pageHead({ title: "Inbox" }),
  component: InboxPage,
});
