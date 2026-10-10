import { FileView, TreeListing } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";

import { PathsTree } from "../-paths-tree.tsx";
import {
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../../features/code/address.ts";
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { TreeView } from "../../../../features/code/tree-view.tsx";
import { pageTitle } from "../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../features/shared/refusals.ts";
import { serverClient } from "../../../../server/client.ts";
import { readFolderWithReadme } from "../../../../server/folder.ts";

// A folder at a revision: its breadcrumb, its entries and its README, read
// on the server, so the page arrives whole; the file tree beside it is the
// browser's. An address naming no project, revision or folder is a 404
// showing the platform's refusal.

const TreePageData = Schema.Struct({
  listing: TreeListing,
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
        UnknownPath: notFoundFor,
        UnknownProject: notFoundFor,
        UnknownRevision: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(TreePageData)({
      listing,
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

const TreePage = () => {
  const { listing, project, readme, rev } = Schema.decodeSync(TreePageData)(
    Route.useLoaderData()
  );

  return (
    <TreeView
      listing={listing}
      project={project}
      readme={readme}
      rev={rev}
      sidebar={
        <PathsTree
          at={listing.at}
          current={listing.path}
          project={project}
          rev={rev}
        />
      }
    />
  );
};

export const Route = createFileRoute("/$project/tree/$rev/$")({
  loader: ({ params }) => treePage({ data: params }),
  head: ({ params: { _splat, project, rev } }) => ({
    meta: [
      {
        title: pageTitle(
          `${_splat === undefined || _splat === "" ? project : _splat} at ${rev}`
        ),
      },
    ],
  }),
  component: TreePage,
  notFoundComponent: CodeNotFound,
});
