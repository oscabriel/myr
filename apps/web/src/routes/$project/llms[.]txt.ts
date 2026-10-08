import { Client } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Array as Arr, Effect, Option, Schema } from "effect";

import { commands } from "../../features/agents/catalog.ts";
import { missingProjectLlms, projectLlms } from "../../features/agents/llms.ts";
import { markdown, unavailable } from "../../features/agents/respond.ts";
import { serverClient } from "../../server/client.ts";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/**
 * `/<project>/llms.txt`: one project for an agent, as the platform lists
 * it, with its open asks. A name the platform does not list is not found.
 */
const llms = (request: Request, name: string) =>
  Effect.gen(function* () {
    const webUrl = new URL(request.url).origin;
    const project = decodeProject(name);

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
        asks: asks.value,
        commands: yield* commands,
        listing: listing.value,
        platformUrl: env.PUBLIC_PLATFORM_URL,
        webUrl,
      })
    );
  }).pipe(
    Effect.orElseSucceed(unavailable),
    Effect.provide(serverClient(env, request))
  );

export const Route = createFileRoute("/$project/llms.txt")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        Effect.runPromise(llms(request, params.project)),
    },
  },
});
