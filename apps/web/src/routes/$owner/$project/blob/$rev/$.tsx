import { Client } from "@repo/protocol/contracts";
import { CommitView, FileView } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../../../features/code/address.ts";
import { BlobView } from "../../../../../features/code/blob-view.tsx";
import { ClientFile } from "../../../../../features/code/client-code.tsx";
import { CodeNotFound } from "../../../../../features/code/not-found.tsx";
import { showsCode } from "../../../../../features/code/paths.ts";
import { FileFallback } from "../../../../../features/code/server-code.tsx";
import { pageHead } from "../../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../../features/shared/refusals.ts";
import { branchPage } from "../../../../../server/cache-headers.ts";
import { serverClient } from "../../../../../server/client.ts";
import { headField, readHead } from "../../../../../server/code-head.ts";
import { CodeColumn } from "../../tree/-code-column.tsx";
import { softLanding } from "../../tree/-soft-landing.ts";

const BlobPageData = Schema.Struct({
  file: FileView,
  head: Schema.optionalKey(CommitView),
  last: Schema.optionalKey(CommitView),
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  rev: Schema.String,
});

interface BlobParams {
  readonly _splat?: string | undefined;
  readonly project: string;
  readonly rev: string;
}

export const readBlobPage = (params: BlobParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = yield* Effect.fromOption(repoPathOf(params._splat));
    const client = yield* Client;

    // The file, the commit that last changed it and the revision's head, at
    // once; both commits are only facts beside the file, so the page goes
    // without them.
    const [file, history, head] = yield* Effect.all(
      [
        client.readFile({ at: rev, path, project }),
        client.log({ at: rev, limit: 1, path, project }).pipe(Effect.option),
        readHead(project, rev),
      ],
      { concurrency: 3 }
    ).pipe(
      Effect.catchTags({
        UnknownPath: (refusal) => softLanding(refusal, project, rev),
        UnknownProject: notFoundFor,
        UnknownRevision: notFoundFor,
      })
    );

    const last = Option.flatMap(history, ({ commits }) =>
      Option.fromUndefinedOr(commits[0])
    );

    return yield* Schema.encodeEffect(BlobPageData)({
      ...headField(head),
      file,
      now: yield* DateTime.now,
      project,
      rev,
      ...Option.match(last, {
        onNone: () => ({}),
        onSome: (commit) => ({ last: commit }),
      }),
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const blobPage = createServerFn({ method: "GET" })
  .validator((params: BlobParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readBlobPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const BlobPage = () => {
  const { file, last, now, project, rev } = Schema.decodeSync(BlobPageData)(
    Route.useLoaderData()
  );

  const plain = Route.useSearch().plain === 1;

  return (
    <BlobView
      code={
        file.text === undefined ? undefined : (
          <ClientFile
            fallback={
              <FileFallback path={file.path} sha={file.sha} text={file.text} />
            }
            key={file.sha}
            path={file.path}
            sha={file.sha}
            text={file.text}
          />
        )
      }
      file={file}
      last={last}
      now={now}
      plain={plain}
      project={project}
      rev={rev}
    />
  );
};

export const Route = createFileRoute("/$owner/$project/blob/$rev/$")({
  staticData: { column: CodeColumn, shell: "project" },
  // The router writes back what this returns, dropping only `undefined`,
  // so a rendered file's address carries no `plain`.
  validateSearch: ({ plain }: { readonly plain?: unknown }) => ({
    plain: plain === 1 || plain === "1" ? (1 as const) : undefined,
  }),
  loader: ({ location, params, preload }) => {
    const page = blobPage({ data: params });

    // A document's file is highlighted on the server before the page
    // renders, so the render waits for nothing and sends it highlighted.
    // Imported here, not at the top: a loader stays in the chunks every
    // page preloads, and the browser's build drops this branch whole.
    if (import.meta.env.SSR) {
      const plain =
        new URLSearchParams(location.searchStr).get("plain") === "1";

      return Effect.runPromise(
        Effect.gen(function* () {
          const data = yield* Effect.promise(() => page);

          if (showsCode(data.file, plain)) {
            const { drawFileAhead } = yield* Effect.promise(
              () => import("../../../../../features/code/prerender.ts")
            );

            yield* Effect.promise(() => drawFileAhead(data.file));
          }

          return data;
        })
      );
    }

    // A hover's preload warms the file's highlighting too, so the click
    // draws it at once; a failed read or warm-up changes nothing here.
    if (preload && !import.meta.env.SSR) {
      Effect.runFork(
        Effect.tryPromise(() =>
          Promise.all([page, import("../../../../../features/code/warm.ts")])
        ).pipe(
          Effect.flatMap(([data, { warmFile }]) =>
            Effect.tryPromise(() => warmFile(data.file))
          ),
          Effect.ignore
        )
      );
    }

    return page;
  },
  headers: () => branchPage,
  head: ({ params: { _splat, project, rev } }) =>
    pageHead({ title: `${_splat ?? project} at ${rev}` }),
  component: BlobPage,
  notFoundComponent: CodeNotFound,
});
