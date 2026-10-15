import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Option } from "effect";

import { signOutHandler } from "../../server/session.ts";

// A development build serves the dev world, which has no platform to sign out of, as in `signin.ts`.
const signOut = signOutHandler(
  import.meta.env.DEV ? Option.none() : Option.some(env)
);

export const Route = createFileRoute("/auth/signout")({
  server: {
    handlers: {
      GET: signOut,
      POST: signOut,
    },
  },
});
