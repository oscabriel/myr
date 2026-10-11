/**
 * The agents' indexes as handlers of a request, each a function of its
 * client and the platform's URL: `/llms.txt` for the platform and
 * `/<owner>/<name>/llms.txt` for one project. Their routes serve them, and the
 * front page and a project's page answer a request for Markdown with them,
 * so the text is written once.
 */
import { Client } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { Array as Arr, Effect, Option, Schema } from "effect";
import type { Layer } from "effect";

import { commands } from "../features/agents/catalog.ts";
import {
  frontLlms,
  missingProjectLlms,
  projectLlms,
} from "../features/agents/llms.ts";
import { markdown, unavailable } from "../features/agents/respond.ts";
import { stillWaiting } from "../features/front/families.ts";

/** A route's client, for the request it answers. */
export type ClientFor = (request: Request) => Layer.Layer<Client>;

/**
 * `/llms.txt`: the platform for an agent, with the projects it lists now,
 * read through the same backend the browser's calls take.
 */
export const frontLlmsHandler =
  (clientFor: ClientFor, platformUrl: string) =>
  ({ request }: { readonly request: Request }): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client;
        const { projects } = yield* client.listProjects({});

        return markdown(
          frontLlms({
            commands,
            platformUrl,
            projects,
            webUrl: new URL(request.url).origin,
          })
        );
      }).pipe(
        Effect.orElseSucceed(unavailable),
        Effect.provide(clientFor(request))
      )
    );

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/**
 * `/<owner>/<name>/llms.txt`: one project for an agent, as the platform lists
 * it, with its open asks. A name the platform does not list is not found.
 */
export const projectLlmsHandler =
  (clientFor: ClientFor, platformUrl: string) =>
  ({
    params,
    request,
  }: {
    readonly params: { readonly project: string };
    readonly request: Request;
  }): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const webUrl = new URL(request.url).origin;
        const project = decodeProject(params.project);

        const missing = () =>
          markdown(missingProjectLlms({ project, webUrl }), 404);

        if (Option.isNone(project)) {
          return missing();
        }

        const client = yield* Client;
        const { projects } = yield* client.listProjects({});

        const listing = Arr.findFirst(
          projects,
          (each) => each.project === project.value
        );

        if (Option.isNone(listing)) {
          return missing();
        }

        const asks = yield* client.listAsks({ project: project.value }).pipe(
          Effect.map((listed) => Option.some(listed.asks)),
          Effect.catchTag("UnknownProject", () => Effect.succeedNone)
        );

        if (Option.isNone(asks)) {
          return missing();
        }

        return markdown(
          projectLlms({
            // An ask waits only on asks still open, as the page says.
            asks: stillWaiting(asks.value),
            commands,
            listing: listing.value,
            platformUrl,
            webUrl,
          })
        );
      }).pipe(
        Effect.orElseSucceed(unavailable),
        Effect.provide(clientFor(request))
      )
    );
