/**
 * A project's raw bytes: `GET /<project>/raw/<rev>/<path…>`, from its
 * canonical repo only, under a sandboxing CSP and `nosniff` so no file runs
 * as script on this origin. The answer is `@repo/project/code/raw`'s, the
 * one the web's dev world serves too. `rest` is everything after `raw/`,
 * undecoded: the revision and the path, each decoded there once.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { rawFor } from "@repo/project/code/raw";
import type { Projects } from "@repo/project/projects";
import type { ProjectName } from "@repo/protocol/ids";
import type { Effect } from "effect";

export const rawResponse = (
  _request: Request,
  project: ProjectName,
  rest: string
): Effect.Effect<Response, never, RepoHost | Projects> => rawFor(project, rest);
