/**
 * A project's raw bytes: `GET /<project>/raw/<rev>/<path…>`, from its
 * canonical repo only, under a sandboxing CSP and `nosniff` so no file runs
 * as script on this origin. The answer is `@repo/project/code/raw`'s, the
 * one the web's dev world serves too. The revision and the path are read
 * from the request's own URL, still encoded, and decoded there once: the
 * router's parameter has `%2F` decoded already, which would cut a tag's
 * name in two.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { rawFor } from "@repo/project/code/raw";
import type { Projects } from "@repo/project/projects";
import type { ProjectName } from "@repo/protocol/ids";
import type { Effect } from "effect";

export const rawResponse = (
  request: Request,
  project: ProjectName
): Effect.Effect<Response, never, RepoHost | Projects> =>
  rawFor(project, request.url);
