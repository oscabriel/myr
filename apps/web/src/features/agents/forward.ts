/**
 * The paths the platform serves and the web host only passes on (issue
 * 505): the CLI's install script and releases (W4 420) and the projects'
 * skills (`/.well-known/agent-skills/*`). The request goes to the backend
 * as it came, for GET and for HEAD; the platform answers every other
 * method on these paths itself, so the web never sees one.
 */
import type { Backend } from "../../server/rpc.ts";

/** A route's GET and HEAD handlers, each handing the request to `backend` with `env`. */
export const forwarded = (backend: Backend, env: Env) => {
  const forward = ({ request }: { readonly request: Request }) =>
    backend(request, env);

  return { GET: forward, HEAD: forward };
};
