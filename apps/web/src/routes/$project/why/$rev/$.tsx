import { Client } from "@repo/protocol/contracts";
import { WhyView } from "@repo/protocol/domain/code";
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
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { pageTitle } from "../../../../features/shared/layout.tsx";
import { ClientWhy } from "../../../../features/why/client-why.tsx";
import { WhyFallback, WhyLines } from "../../../../features/why/why-view.tsx";
import { serverClient } from "../../../../server/client.ts";

// Why each line of a file at a revision is there, read on the server: the
// blame's ranges with their commits and landings, and the file's text at
// the commit the blame resolved, so the two always agree (both asked for
// at once, the text again only if the revision moved between them). The
// browser then draws the file with a row above each range. An address
// naming no project, revision or file is a 404 showing the platform's
// refusal.

const WhyPageData = Schema.Struct({
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
      UnknownPath: notFoundFor,
      UnknownProject: notFoundFor,
      UnknownRevision: notFoundFor,
    };

    // Both at once: a cold why takes seconds, and the file's text needs
    // none of it. Should the revision have moved between the two reads,
    // the text is read again at the why's own commit.
    const [view, read] = yield* Effect.all(
      [
        client.why({ at: rev, path, project }),
        client.readFile({ at: rev, path, project }),
      ],
      { concurrency: 2 }
    ).pipe(Effect.catchTags(refused));

    const file =
      read.at === view.at
        ? read
        : yield* client
            .readFile({ at: view.at, path, project })
            .pipe(Effect.catchTags(refused));

    return yield* Schema.encodeEffect(WhyPageData)({
      project,
      rev,
      text: file.text,
      view,
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const whyPage = createServerFn({ method: "GET" })
  .validator((params: WhyParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(readWhyPage(data).pipe(Effect.provide(serverClient(env))))
  );

const WhyPage = () => {
  const { project, rev, text, view } = Schema.decodeSync(WhyPageData)(
    Route.useLoaderData()
  );

  return (
    <WhyLines
      code={
        text === undefined ? undefined : (
          <ClientWhy
            fallback={<WhyFallback project={project} text={text} view={view} />}
            project={project}
            text={text}
            view={view}
          />
        )
      }
      project={project}
      rev={rev}
      view={view}
      {...(text === undefined ? {} : { text })}
    />
  );
};

export const Route = createFileRoute("/$project/why/$rev/$")({
  loader: ({ params }) => whyPage({ data: params }),
  head: ({ params: { _splat, project, rev } }) => ({
    meta: [{ title: pageTitle(`Why ${_splat ?? project} at ${rev}`) }],
  }),
  component: WhyPage,
  notFoundComponent: CodeNotFound,
});
