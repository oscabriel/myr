/**
 * The platform's `/`: a page saying what this host serves (clone URLs, MCP,
 * agent skills, sign-in, the CLI and its releases, the web app), in HTML
 * for a browser and in Markdown for an agent. A stub until 906 lands: it
 * answers 501, naming what it read.
 */
import type { FrontPage } from "@repo/project/front-page";
import { Effect } from "effect";

import { HostInfo } from "./host-info.ts";

export const homeResponse = (
  _request: Request
): Effect.Effect<Response, never, FrontPage | HostInfo> =>
  Effect.map(
    Effect.service(HostInfo),
    ({ draftModel }) =>
      new Response(`not built: 906 (draft model ${draftModel})`, {
        status: 501,
      })
  );
