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
import { pageHead } from "../features/shared/head.ts";
import {
  reloadOnEnter,
  useSelection,
} from "../features/shared/shell/selection.ts";
import {
  readOfCause,
  readToday,
  TodayPageData,
  TodayRead,
} from "../features/today/read.ts";
import { TodayView } from "../features/today/today-page.tsx";
import { personalPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";

// `/today`: the signed-in decider's decisions across their projects, or in
// the one `?project=` names. The loader reads it on the server with the
// reader's own session (their cookie goes with the call), so the page
// arrives with its rows; in the browser the same read stays live, and a
// choice reads it again. A page about its reader is kept by no cache.

/** What the address may name: a project to narrow to, and the decision selected. */
const TodaySearch = Schema.Struct({
  decision: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(ProjectName),
});

type TodaySearch = typeof TodaySearch.Type;

const searchOf = Schema.decodeUnknownOption(TodaySearch);

/** A page about its reader, kept by no cache. */
export const todayHeaders = () => personalPage;

/** What the atom holds now, or the loader's read until it has read. */
const readFrom = (
  result: AsyncResult.AsyncResult<Today, unknown>,
  loaded: TodayRead
): TodayRead => {
  if (AsyncResult.isSuccess(result)) {
    return TodayRead.cases.Read.make({ today: result.value });
  }

  return AsyncResult.isFailure(result) ? readOfCause(result.cause) : loaded;
};

const todayPage = createServerFn({ method: "GET" })
  .validator((search: { readonly project?: ProjectName }) => search)
  .handler(({ data }) =>
    Effect.runPromise(
      readToday(data).pipe(Effect.provide(serverClient(env, getRequest())))
    )
  );

/** Today over its atom, which starts from what the loader read and reads again after a choice. */
const LiveToday = ({
  data,
  project,
}: {
  readonly data: TodayPageData;
  readonly project: ProjectName | undefined;
}) => {
  const result = useAtomValue(todayAtom(project));
  const [decided, decide] = useAtom(decideAtom);
  const { select, selected } = useSelection("decision");

  const read = readFrom(result, data.read);

  return (
    <TodayView
      decided={decided}
      now={data.now}
      onDecide={decide}
      onSelect={select}
      read={read}
      selected={selected}
    />
  );
};

const TodayPage = () => {
  const { project } = Route.useSearch();
  const data = Schema.decodeSync(TodayPageData)(Route.useLoaderData());

  const seeds = TodayRead.match(data.read, {
    Read: ({ today }) => [seedSuccess(todayAtom(project), today)],
    Refused: () => [],
    SignedOut: () => [],
    Unreachable: () => [],
  });

  return (
    <SeededAtoms id={`today/${project ?? ""}`} seeds={seeds}>
      <LiveToday data={data} project={project} />
    </SeededAtoms>
  );
};

export const Route = createFileRoute("/today")({
  validateSearch: (search: {
    readonly decision?: unknown;
    readonly project?: unknown;
  }): TodaySearch => Option.getOrElse(searchOf(search), () => ({})),
  // A selection lives in the address; it never reads Today again.
  loaderDeps: ({ search }) =>
    search.project === undefined ? {} : { project: search.project },
  loader: ({ deps }) => todayPage({ data: deps }),
  shouldReload: reloadOnEnter,
  headers: todayHeaders,
  head: () => pageHead({ title: "Today" }),
  component: TodayPage,
});
