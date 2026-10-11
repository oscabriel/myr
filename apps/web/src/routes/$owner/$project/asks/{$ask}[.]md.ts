import { Client, ShowAsk, Visibility } from "@repo/protocol/contracts";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Context, Effect, Option, Schema } from "effect";
import type { Layer } from "effect";

import {
  askMarkdownResponse,
  noAskAt,
} from "../../../features/ask/markdown.ts";
import { serverClient } from "../../../server/client.ts";

// An ask as Markdown, always: `/<project>/asks/<ask>.md` (a literal `.` is
// `[.]` in a route file's name; `{$ask}` keeps the param apart from it). The
// ask page's own URL answers the same with `Accept: text/markdown`
// (`$ask.tsx`), so a harness reads an ask with one plain fetch.

/** The path params an ask's routes are handed, not yet decoded. */
export interface AskParams {
  readonly ask: string;
  readonly project: string;
}

/** An ask's path, decoded: names the platform could hold. */
export const AskPath = Schema.Struct({ ask: AskId, project: ProjectName });

/** The protocol client a route calls the platform with, for the request it answers. */
export type ClientFor = (request: Request) => Layer.Layer<Client>;

/** `showAsk` is public, so its Markdown may be cached; the annotation says so, not this file. */
const visibility = Context.get(ShowAsk.annotations, Visibility);

/**
 * The `.md` route's handler as a function of its client, which its test
 * drives with a stub platform: the brief `showAsk` gives, with the banner
 * naming this host's indexes under its title, a refusal as a 404, or a 404 without asking
 * when the path can name no ask.
 */
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

export const Route = createFileRoute("/$project/asks/{$ask}.md")({
  server: {
    handlers: {
      GET: askMarkdownHandler((request) => serverClient(env, request)),
    },
  },
});
