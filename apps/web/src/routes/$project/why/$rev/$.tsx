import { Client } from "@repo/protocol/contracts";
import { CommitView, FileView, WhyView } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import type { UnknownPath } from "@repo/protocol/refusal";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  projectOf,
  repoPathOf,
  revisionOf,
} from "../../../../features/code/address.ts";
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { pageHead } from "../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../features/shared/refusals.ts";
import { ClientWhy } from "../../../../features/why/client-why.tsx";
import { WhyFallback, WhyLines } from "../../../../features/why/why-view.tsx";
import { serverClient } from "../../../../server/client.ts";
import { CodeRail } from "../../tree/-code-rail.tsx";
import { FilesButton } from "../../tree/-files-button.tsx";
import { codePageHeaders } from "../../tree/-headers.ts";
import { softLanding } from "../../tree/-soft-landing.ts";

// Why each line of a file at a revision is there, read on the server: the
// blame's ranges with their commits and landings, the file at the commit
// the blame resolved, so the two always agree (all asked for at once, the
// file again only if the revision moved between them), and the commit
// that last changed it. The browser then draws the file with a band above
// each group of lines. A path missing at a revision that exists lands on
// the nearest folder above it; any other address naming nothing is a 404
// showing the platform's refusal.

const WhyPageData = Schema.Struct({
  file: FileView,
  last: Schema.optionalKey(CommitView),
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  rev: Schema.String,
  text: Schema.UndefinedOr(Schema.String),
  view: WhyView,
});

interface WhyParams {
  readonly _splat?: string | undefined;
  readonly project: string;
  readonly rev: string;
}

/** The view and the file's text, or a not-found carrying the platform's refusal. */
export const readWhyPage = (params: WhyParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const rev = yield* Effect.fromOption(revisionOf(params.rev));
    const path = yield* Effect.fromOption(repoPathOf(params._splat));
    const client = yield* Client;

    const refused = {
      UnknownPath: (refusal: UnknownPath) => softLanding(refusal, project, rev),
      UnknownProject: notFoundFor,
      UnknownRevision: notFoundFor,
    };

    // All at once: a cold why takes seconds, and the file's text needs
    // none of it. Should the revision have moved between the reads, the
    // text is read again at the why's own commit. The last change is only
    // a fact beside the file, so the page goes without it.
    const [view, read, history] = yield* Effect.all(
      [
        client.why({ at: rev, path, project }),
        client.readFile({ at: rev, path, project }),
        client.log({ at: rev, limit: 1, path, project }).pipe(Effect.option),
      ],
      { concurrency: 3 }
    ).pipe(Effect.catchTags(refused));

    const file =
      read.at === view.at
        ? read
        : yield* client
            .readFile({ at: view.at, path, project })
            .pipe(Effect.catchTags(refused));

    const last = Option.flatMap(history, ({ commits }) =>
      Option.fromUndefinedOr(commits[0])
    );

    return yield* Schema.encodeEffect(WhyPageData)({
      file,
      now: yield* DateTime.now,
      project,
      rev,
      text: file.text,
      view,
      ...Option.match(last, {
        onNone: () => ({}),
        onSome: (commit) => ({ last: commit }),
      }),
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const whyPage = createServerFn({ method: "GET" })
  .validator((params: WhyParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(readWhyPage(data).pipe(Effect.provide(serverClient(env))))
  );

const WhyPage = () => {
  const { file, last, now, project, rev, text, view } = Schema.decodeSync(
    WhyPageData
  )(Route.useLoaderData());

  return (
    <WhyLines
      code={
        text === undefined ? undefined : (
          <ClientWhy
            fallback={
              <WhyFallback
                now={now}
                project={project}
                text={text}
                view={view}
              />
            }
            key={`${view.at}:${view.path}`}
            now={now}
            project={project}
            text={text}
            view={view}
          />
        )
      }
      file={file}
      files={<FilesButton />}
      last={last}
      now={now}
      project={project}
      rev={rev}
      view={view}
      {...(text === undefined ? {} : { text })}
    />
  );
};

export const Route = createFileRoute("/$project/why/$rev/$")({
  staticData: { rail: CodeRail },
  headers: ({ params }) => codePageHeaders(params.rev),
  loader: ({ params }) => whyPage({ data: params }),
  head: ({ params: { _splat, project, rev } }) =>
    pageHead({ title: `Why ${_splat ?? project} at ${rev}` }),
  component: WhyPage,
  notFoundComponent: CodeNotFound,
});
