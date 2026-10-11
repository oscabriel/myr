import { useAtomValue } from "@effect/atom-react";
import type { CommitView } from "@repo/protocol/domain/code";
import { FileView, TreeListing } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { CodeRail } from "../-code-rail.tsx";
import { FilesButton } from "../-files-button.tsx";
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
import { readFolderWithReadme } from "../../../../../server/folder.ts";

// A folder at a revision: its entries and its README, read on the server,
// so the page arrives whole; the tree in the rail and what last changed
// each entry are the browser's. A path missing at a revision that exists
// lands on the nearest folder above it, the refusal as its notice; any
// other address naming nothing is a 404 showing the platform's refusal.

const TreePageData = Schema.Struct({
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

/** The folder for its page, or a not-found carrying the platform's refusal. */
export const readTreePage = (params: TreeParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = repoPathOf(params._splat);

    const { listing, readme } = yield* readFolderWithReadme({
      path,
      project,
      rev,
    }).pipe(
      Effect.catchTags({
        UnknownPath: (refusal) => softLanding(refusal, project, rev),
        UnknownProject: notFoundFor,
        UnknownRevision: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(TreePageData)({
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
      files={<FilesButton />}
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
  staticData: { rail: CodeRail },
  loader: ({ params }) => treePage({ data: params }),
  headers: () => branchPage,
  head: ({ params: { _splat, project, rev } }) =>
    pageHead({
      title: `${_splat === undefined || _splat === "" ? project : _splat} at ${rev}`,
    }),
  component: TreePage,
  notFoundComponent: ({ data }) => (
    <CodeNotFound data={data} files={<FilesButton />} />
  ),
});
