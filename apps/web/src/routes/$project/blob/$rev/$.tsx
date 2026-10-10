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
} from "../../../../features/code/address.ts";
import { BlobView } from "../../../../features/code/blob-view.tsx";
import { ClientFile } from "../../../../features/code/client-code.tsx";
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { NumberedLines } from "../../../../features/code/numbered-lines.tsx";
import { pageHead } from "../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../features/shared/refusals.ts";
import { serverClient } from "../../../../server/client.ts";
import { CodeRail } from "../../tree/-code-rail.tsx";
import { FilesButton } from "../../tree/-files-button.tsx";
import { codePageHeaders } from "../../tree/-headers.ts";
import { softLanding } from "../../tree/-soft-landing.ts";

// A file at a revision, read on the server with the commit that last
// changed it: its text arrives as numbered, anchored lines, and the
// browser then draws it highlighted, the `#L10-L20` selection kept in the
// address. `?plain=1` shows a Markdown file's source. A path missing at a
// revision that exists lands on the nearest folder above it; any other
// address naming nothing is a 404 showing the platform's refusal.

const BlobPageData = Schema.Struct({
  file: FileView,
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

/** The file for its page, or a not-found carrying the platform's refusal. */
export const readBlobPage = (params: BlobParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = yield* Effect.fromOption(repoPathOf(params._splat));
    const client = yield* Client;

    // The file and the commit that last changed it, at once; that commit
    // is only a fact beside the file, so the page goes without it.
    const [file, history] = yield* Effect.all(
      [
        client.readFile({ at: rev, path, project }),
        client.log({ at: rev, limit: 1, path, project }).pipe(Effect.option),
      ],
      { concurrency: 2 }
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
            fallback={<NumberedLines text={file.text} />}
            key={file.sha}
            path={file.path}
            sha={file.sha}
            text={file.text}
          />
        )
      }
      file={file}
      files={<FilesButton />}
      last={last}
      now={now}
      plain={plain}
      project={project}
      rev={rev}
    />
  );
};

export const Route = createFileRoute("/$project/blob/$rev/$")({
  staticData: { rail: CodeRail },
  // The router writes back what this returns, dropping only `undefined`,
  // so a rendered file's address carries no `plain`.
  validateSearch: ({ plain }: { readonly plain?: unknown }) => ({
    plain: plain === 1 || plain === "1" ? (1 as const) : undefined,
  }),
  loader: ({ params, preload }) => {
    const page = blobPage({ data: params });

    // A hover's preload warms the file's highlighting too, so the click
    // draws it at once; a failed read or warm-up changes nothing here.
    if (preload && !import.meta.env.SSR) {
      Effect.runFork(
        Effect.tryPromise(() =>
          Promise.all([page, import("../../../../features/code/warm.ts")])
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
  headers: ({ loaderData, params }) =>
    codePageHeaders(params.rev, loaderData !== undefined),
  head: ({ params: { _splat, project, rev } }) =>
    pageHead({ title: `${_splat ?? project} at ${rev}` }),
  component: BlobPage,
  notFoundComponent: ({ data }) => (
    <CodeNotFound data={data} files={<FilesButton />} />
  ),
});
