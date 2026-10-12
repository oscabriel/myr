import { Client, ShowAsk, Visibility } from "@repo/protocol/contracts";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Context, Effect, Option, Schema } from "effect";
import type { Layer } from "effect";

import {
  askMarkdownResponse,
  noAskAt,
} from "../../../../features/ask/markdown.ts";
import { serverClient } from "../../../../server/client.ts";

export interface AskParams {
  readonly ask: string;
  readonly project: string;
}

export const AskPath = Schema.Struct({ ask: AskId, project: ProjectName });

export type ClientFor = (request: Request) => Layer.Layer<Client>;

// `showAsk` is public, so its Markdown may be cached; the annotation says so.
const visibility = Context.get(ShowAsk.annotations, Visibility);

export const askMarkdownHandler =
  (clientFor: ClientFor) =>
  ({
    params,
    request,
  }: {
    readonly params: AskParams;
    readonly request: Request;
  }): Promise<Response> =>
    Effect.runPromise(
      Option.match(Schema.decodeOption(AskPath)(params), {
        onNone: () => Effect.succeed(noAskAt(new URL(request.url).pathname)),
        onSome: (path) =>
          Effect.flatMap(Effect.service(Client), (client) =>
            client.showAsk(path)
          ).pipe(
            Effect.exit,
            Effect.map((exit) =>
              askMarkdownResponse(exit, visibility, {
                project: path.project,
                webUrl: new URL(request.url).origin,
              })
            ),
            Effect.provide(clientFor(request))
          ),
      })
    );

export const Route = createFileRoute("/$owner/$project/asks/{$ask}.md")({
  server: {
    handlers: {
      GET: askMarkdownHandler((request) => serverClient(env, request)),
    },
  },
});
