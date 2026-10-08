/**
 * The paths the platform serves and the web host only passes on (issue
 * 505): the CLI's install script and releases (W4 420) and the projects'
 * skills (`/.well-known/agent-skills/*`). The request goes to the backend
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
