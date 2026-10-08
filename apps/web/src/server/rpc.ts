/**
 * The web's `/rpc` route, as a function of its backend: what the route file
 * (`src/routes/rpc.ts`) wires, and what its test drives with a stub.
 */

/**
 * How the web reaches the platform. `#backend` picks one: under the
 * `development` condition an in-process world (`src/dev/backend.ts`, issue
 * 502), otherwise the `PLATFORM` service binding (`src/server/backend.ts`).
 */
export type Backend = (request: Request, env: Env) => Promise<Response>;

/** The `/rpc` route's handler: the request goes to `backend`, with the Worker's env. */
export const rpcHandler =
  (backend: Backend, env: Env) =>
  ({ request }: { readonly request: Request }) =>
    backend(request, env);
