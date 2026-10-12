// `#backend` picks one: under the `development` condition an in-process world, otherwise the `PLATFORM` binding.
export type Backend = (request: Request, env: Env) => Promise<Response>;

export const rpcHandler =
  (backend: Backend, env: Env) =>
  ({ request }: { readonly request: Request }) =>
    backend(request, env);
