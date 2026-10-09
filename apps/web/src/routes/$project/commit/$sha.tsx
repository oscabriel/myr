import { Client } from "@repo/protocol/contracts";
import { CommitDiff } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Schema } from "effect";

import { notFoundFor } from "../../../features/ask/refused.tsx";
import { commitOf, projectOf } from "../../../features/code/address.ts";
import { ClientDiffs } from "../../../features/code/client-code.tsx";
import { ClientTree } from "../../../features/code/client-tree.tsx";
import {
  ChangedList,
  CommitView,
} from "../../../features/code/commit-view.tsx";
import { CodeNotFound } from "../../../features/code/not-found.tsx";
import { diffAnchor } from "../../../features/code/paths.ts";
import { pageTitle } from "../../../features/shared/layout.tsx";
import { serverClient } from "../../../server/client.ts";

// One commit and what it changed, read on the server: the browser then
// draws the changed files as a tree (marked added, modified or deleted)
// beside their diffs, unified unless `?style=split`.

const CommitPageData = Schema.Struct({
  diff: CommitDiff,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
});

interface CommitParams {
  readonly project: string;
  readonly sha: string;
}

/** The commit for its page, or a not-found carrying the platform's refusal. */
export const readCommitPage = (params: CommitParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const sha = yield* Effect.fromOption(commitOf(params.sha));
    const client = yield* Client;

    const diff = yield* client.showCommit({ project, sha }).pipe(
      Effect.catchTags({
        UnknownCommit: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(CommitPageData)({
      diff,
      now: yield* DateTime.now,
      project,
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const commitPage = createServerFn({ method: "GET" })
  .validator((params: CommitParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readCommitPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const CommitPage = () => {
  const { diff, now, project } = Schema.decodeSync(CommitPageData)(
    Route.useLoaderData()
  );

  const split = Route.useSearch().style === "split";

  return (
    <CommitView
      diff={diff}
      drawing={
        <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start">
            <ClientTree
              hrefOf={(path) => `#${diffAnchor(path)}`}
              paths={diff.files.map((file) => file.path)}
              status={diff.files.map((file) => ({
                path: file.path,
                status: file.status,
              }))}
            />
          </div>
          <ClientDiffs
            fallback={
              <ChangedList
                commit={diff.commit}
                files={diff.files}
                project={project}
              />
            }
            files={diff.files}
            split={split}
          />
        </div>
      }
      now={now}
      project={project}
      split={split}
    />
  );
};

export const Route = createFileRoute("/$project/commit/$sha")({
  // The router writes back what this returns, dropping only `undefined`,
  // so a unified diff's address carries no `style`.
  validateSearch: (search: { readonly style?: unknown }) => ({
    style: search.style === "split" ? ("split" as const) : undefined,
  }),
  loader: ({ params }) => commitPage({ data: params }),
  head: ({ params: { project, sha } }) => ({
    meta: [{ title: pageTitle(`${project}: commit ${sha.slice(0, 7)}`) }],
  }),
  component: CommitPage,
  notFoundComponent: CodeNotFound,
});
