/**
 * The paths the platform serves and the web host only passes on:
 * the CLI's install script and releases, the projects'
 * skills (`/.well-known/agent-skills/*`) and a project's raw files
 * (`/<project>/raw/<rev>/<path>`, under the platform's sandboxing headers). The request goes to the backend
 * as it came, for GET and for HEAD only: the platform only reads on these
 * paths (it answers any other method 405), so the web passes no other
 * method on.
 */
import type { Backend } from "../../server/rpc.ts";

/** A route's GET and HEAD handlers, each handing the request to `backend` with `env`. */
export const forwarded = (backend: Backend, env: Env) => {
  const forward = ({ request }: { readonly request: Request }) =>
    backend(request, env);

  return { GET: forward, HEAD: forward };
};
