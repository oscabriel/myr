import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import type { Handled } from "../../server/session.ts";
import { signInHandler } from "../../server/session.ts";

// A development build serves the dev world (src/dev), which has no platform to authorize against, so its sign-in
// goes to the dev sign-in instead. Vite writes `import.meta.env.DEV` as `false` in a production build, so the
// `import()` is dead code there and the dev module never enters the bundle, as in `$.ts`.
const devRoute = import.meta.env.DEV
  ? () => Effect.promise(() => import("./-dev.ts"))
  : undefined;

const signIn =
  devRoute === undefined
    ? signInHandler(env)
    : (handled: Handled) =>
        Effect.runPromise(
          Effect.map(devRoute(), ({ toDevSignIn }) => toDevSignIn(handled))
        );

export const Route = createFileRoute("/auth/signin")({
  server: {
    handlers: {
      GET: signIn,
    },
  },
});
