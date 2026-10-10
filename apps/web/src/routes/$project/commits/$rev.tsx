import { Client } from "@repo/protocol/contracts";
import { CommitView } from "@repo/protocol/domain/code";
import { ProjectName, RepoPath } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Predicate, Schema } from "effect";

import {
  offsetOf,
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../features/code/address.ts";
import { LOG_PAGE } from "../../../features/code/log-page.ts";
import { LogView } from "../../../features/code/log-view.tsx";
import type { LogShow } from "../../../features/code/log-view.tsx";
import { CodeNotFound } from "../../../features/code/not-found.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { notFoundFor } from "../../../features/shared/refusals.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

// The landings: the log from a revision, a page at a time (`?from=` is
// where the page starts), only the commits that changed `?path=` when
// given, filtered to the answers or the asks' openings by `?show=`; read
// on the server, so the page arrives whole.

const LogPageData = Schema.Struct({
  commits: Schema.Array(CommitView),
  from: Schema.Int,
  next: Schema.UndefinedOr(Schema.Int),
  now: Schema.DateTimeUtcFromString,
  path: Schema.UndefinedOr(RepoPath),
  project: ProjectName,
  rev: Schema.String,
});

/** The kinds of commit a page may be filtered to. */
const SHOWS: readonly LogShow[] = ["answers", "openings"];

interface LogParams {
  readonly from?: number | undefined;
  readonly path?: string | undefined;
  readonly project: string;
  readonly rev: string;
}

/** The page of the log, or a not-found carrying the platform's refusal. */
export const readLogPage = (params: LogParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = repoPathOf(params.path);
    const from = params.from ?? 0;
    const client = yield* Client;

    const filter = Option.match(path, {
      onNone: () => ({}),
      onSome: (only) => ({ path: only }),
    });

    const page = yield* client
      .log({ at: rev, from, limit: LOG_PAGE, project, ...filter })
      .pipe(
        Effect.catchTags({
          UnknownProject: notFoundFor,
          UnknownRevision: notFoundFor,
        })
      );

    return yield* Schema.encodeEffect(LogPageData)({
      commits: page.commits,
      from,
      now: yield* DateTime.now,
      project,
      rev,
      next: page.next,
      path: Option.getOrUndefined(path),
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const logPage = createServerFn({ method: "GET" })
  .validator((params: LogParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(readLogPage(data).pipe(Effect.provide(serverClient(env))))
  );

const LogPage = () => {
  const read = Schema.decodeSync(LogPageData)(Route.useLoaderData());
  const { show } = Route.useSearch();

  return (
    <LogView
      commits={read.commits}
      from={read.from}
      next={read.next}
      now={read.now}
      path={read.path}
      project={read.project}
      rev={read.rev}
      show={show ?? "all"}
    />
  );
};

export const Route = createFileRoute("/$project/commits/$rev")({
  validateSearch: (search: {
    readonly from?: unknown;
    readonly path?: unknown;
    readonly show?: unknown;
  }) => ({
    from: Option.getOrUndefined(offsetOf(search.from)),
    path: Predicate.isString(search.path) ? search.path : undefined,
    show: SHOWS.find((each) => each === search.show),
  }),
  loaderDeps: ({ search }) => ({ from: search.from, path: search.path }),
  loader: ({ deps, params }) => logPage({ data: { ...params, ...deps } }),
  headers: () => branchPage,
  head: ({ params: { project, rev } }) =>
    pageHead({ title: `${project}: landings on ${rev}` }),
  component: LogPage,
  notFoundComponent: CodeNotFound,
});
