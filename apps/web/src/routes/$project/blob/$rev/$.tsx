import { Client } from "@repo/protocol/contracts";
import { FileView } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { notFoundFor } from "../../../../features/ask/refused.tsx";
import {
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../../features/code/address.ts";
import {
  BlobView,
  NumberedLines,
} from "../../../../features/code/blob-view.tsx";
import { ClientFile } from "../../../../features/code/client-code.tsx";
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { pageTitle } from "../../../../features/shared/layout.tsx";
import { serverClient } from "../../../../server/client.ts";
import { PathsTree } from "../../tree/-paths-tree.tsx";

// A file at a revision, read on the server: its text arrives as numbered,
// anchored lines, and the browser then draws it highlighted, with the
// `#L10-L20` selection kept in the address. `?plain=1` shows a Markdown
// file's source. An address naming no project, revision or file is a 404
// showing the platform's refusal.

const BlobPageData = Schema.Struct({
  file: FileView,
  project: ProjectName,
  rev: Schema.String,
});

interface BlobParams {
  readonly _splat?: string | undefined;
  readonly project: string;
  readonly rev: string;
}

/** The file for its page, or a not-found carrying the platform's refusal. */
export const readBlobPage = (params: BlobParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = yield* Effect.fromOption(repoPathOf(params._splat));
    const client = yield* Client;

    const file = yield* client.readFile({ at: rev, path, project }).pipe(
      Effect.catchTags({
        UnknownPath: notFoundFor,
        UnknownProject: notFoundFor,
        UnknownRevision: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(BlobPageData)({ file, project, rev });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const blobPage = createServerFn({ method: "GET" })
  .validator((params: BlobParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readBlobPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const BlobPage = () => {
  const { file, project, rev } = Schema.decodeSync(BlobPageData)(
    Route.useLoaderData()
  );

  const plain = Route.useSearch().plain === 1;

  return (
    <BlobView
      code={
        file.text === undefined ? undefined : (
          <ClientFile
            fallback={<NumberedLines text={file.text} />}
            path={file.path}
            sha={file.sha}
            text={file.text}
          />
        )
      }
      file={file}
      plain={plain}
      project={project}
      rev={rev}
      sidebar={
        <PathsTree
          at={file.at}
          current={file.path}
          project={project}
          rev={rev}
        />
      }
    />
  );
};

export const Route = createFileRoute("/$project/blob/$rev/$")({
  // The router writes back what this returns, dropping only `undefined`,
  // so a rendered file's address carries no `plain`.
  validateSearch: ({ plain }: { readonly plain?: unknown }) => ({
    plain: plain === 1 || plain === "1" ? (1 as const) : undefined,
  }),
  loader: ({ params }) => blobPage({ data: params }),
  head: ({ params: { _splat, project, rev } }) => ({
    meta: [{ title: pageTitle(`${_splat ?? project} at ${rev}`) }],
  }),
  component: BlobPage,
  notFoundComponent: CodeNotFound,
});
