import type { Backend } from "../../server/rpc.ts";

export const forwarded = (backend: Backend, env: Env) => {
  const forward = ({ request }: { readonly request: Request }) =>
    backend(request, env);

  return { GET: forward, HEAD: forward };
};
