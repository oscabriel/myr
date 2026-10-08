import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import type { Handled } from "../../server/session.ts";

/**
 * Any other `/auth/<name>`. A development build serves the dev sign-in
 * (`-dev.ts`) at `dev`; Vite writes `import.meta.env.DEV` as `false` in a
 * production build, so the `import()` below is dead code there and the dev
 * module never enters the bundle (W5 505's production-bundle test). It is
 * reached this way, not as a route of its own, so the route tree names no
 * dev path.
 */
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
