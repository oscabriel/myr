/**
 * A project's raw bytes: `GET /<project>/raw/<rev>/<path…>`, from its
 * canonical repo only, under a sandboxing CSP and `nosniff` so no file runs
 * as script on this origin. A stub until 903 lands: it answers 501.
 * `rest` is everything after `raw/`, undecoded: the revision and the path.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import type { Projects } from "@repo/project/projects";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";

export const rawResponse = (
  _request: Request,
  _project: ProjectName,
  _rest: string
): Effect.Effect<Response, never, RepoHost | Projects> =>
  Effect.succeed(new Response("not built: 903", { status: 501 }));
