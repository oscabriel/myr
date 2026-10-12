import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import type { Handled } from "../../server/session.ts";

// Vite writes `import.meta.env.DEV` as `false` in a production build, so this `import()` is dead code there
// and the dev module never enters the bundle. Reached this way so the route tree names no dev path.
const devRoute = import.meta.env.DEV
  ? () => Effect.promise(() => import("./-dev.ts"))
  : undefined;

const notFound = () =>
  new Response("Not found.", {
    headers: { "cache-control": "no-store" },
    status: 404,
  });

const elsewhere = ({
  params,
  request,
}: Handled & { readonly params: { readonly _splat?: string } }) =>
  params._splat === "dev" && devRoute !== undefined
    ? Effect.runPromise(
        Effect.map(devRoute(), ({ devSignIn }) => devSignIn({ request }))
      )
    : notFound();

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      GET: elsewhere,
    },
  },
});
