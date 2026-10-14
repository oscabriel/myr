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
import { openAsks } from "../features/project/asks.tsx";

export type ClientFor = (request: Request) => Layer.Layer<Client>;

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
            // An ask waits only on asks still open, and a family's finale
            // is folded into its family while it waits, so the count is the
            // page's and the header's.
            asks: openAsks(stillWaiting(asks.value)),
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
