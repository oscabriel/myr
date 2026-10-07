/**
 * git's smart HTTP on the platform: clones and pushes of every project's
 * repos, reached at `/<repo>(.git)/(info/refs|git-upload-pack|git-receive-pack)`.
 * `surfaces.ts` hands every such path here, outside the 401 gate, before the
 * RPC and MCP routes.
 *
 * A stub until W3 303 builds the gateway: it serves no path, so every git
 * path answers 404.
 */
import type { Upstream } from "@repo/git/upstream";
import type { Projects } from "@repo/project/projects";
import { Option } from "effect";
import type { Effect } from "effect";

import type { Sessions } from "./sessions.ts";

/** What serving git needs: who is calling, their projects, and the git server behind. */
export type GitServices = Sessions | Projects | Upstream;

/** The response to a git request, if `request` is one the gateway serves. */
export const serveGit = (
  _request: Request
): Option.Option<Effect.Effect<Response, never, GitServices>> => Option.none();
