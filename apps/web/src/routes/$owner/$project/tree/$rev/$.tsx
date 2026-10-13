import { useAtomValue } from "@effect/atom-react";
import { CommitView, FileView, TreeListing } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { CodeColumn } from "../-code-column.tsx";
import { softLanding } from "../-soft-landing.ts";
import { lastChangesAtom } from "../../../../../client/code.ts";
import {
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../../../features/code/address.ts";
import { CodeNotFound } from "../../../../../features/code/not-found.tsx";
import { TreeView } from "../../../../../features/code/tree-view.tsx";
import { pageHead } from "../../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../../features/shared/refusals.ts";
import { branchPage } from "../../../../../server/cache-headers.ts";
import { serverClient } from "../../../../../server/client.ts";
import { headField, readHead } from "../../../../../server/code-head.ts";
import { readFolderWithReadme } from "../../../../../server/folder.ts";

const TreePageData = Schema.Struct({
  head: Schema.optionalKey(CommitView),
  listing: TreeListing,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  readme: Schema.optionalKey(FileView),
  rev: Schema.String,
});

interface TreeParams {
  readonly _splat?: string | undefined;
  readonly project: string;
  readonly rev: string;
}

export const readTreePage = (params: TreeParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = repoPathOf(params._splat);

    // The folder and the revision's head commit at once: the entries'
    // last changes are read by the browser after the page is up.
    const [{ listing, readme }, head] = yield* Effect.all(
      [readFolderWithReadme({ path, project, rev }), readHead(project, rev)],
      { concurrency: 2 }
    ).pipe(
      Effect.catchTags({
        UnknownPath: (refusal) => softLanding(refusal, project, rev),
        UnknownProject: notFoundFor,
        UnknownRevision: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(TreePageData)({
      ...headField(head),
      listing,
      now: yield* DateTime.now,
      project,
      rev,
      ...Option.match(readme, {
        onNone: () => ({}),
        onSome: (file) => ({ readme: file }),
      }),
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const treePage = createServerFn({ method: "GET" })
  .validator((params: TreeParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readTreePage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const NO_CHANGES: ReadonlyMap<string, CommitView> = new Map();

const TreePage = () => {
  const { listing, now, project, readme, rev } = Schema.decodeSync(
    TreePageData
  )(Route.useLoaderData());

  const last = useAtomValue(
    lastChangesAtom({
      at: listing.at,
      paths: listing.entries.map(({ path }) => path),
      project,
    })
  );

  return (
    <TreeView
      last={AsyncResult.match(last, {
        onFailure: () => NO_CHANGES,
        onInitial: () => NO_CHANGES,
        onSuccess: ({ value }) => value,
      })}
      listing={listing}
      now={now}
      project={project}
      readme={readme}
      rev={rev}
    />
  );
};

export const Route = createFileRoute("/$owner/$project/tree/$rev/$")({
  staticData: { column: CodeColumn, shell: "project" },
  loader: ({ params }) => treePage({ data: params }),
  headers: () => branchPage,
  head: ({ params: { _splat, project, rev } }) =>
    pageHead({
      title: `${_splat === undefined || _splat === "" ? project : _splat} at ${rev}`,
    }),
  component: TreePage,
  notFoundComponent: CodeNotFound,
});
