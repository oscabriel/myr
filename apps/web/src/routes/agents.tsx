import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { INSTALL_PATH } from "../features/shared/paths.ts";

// The setup page moved to `/install` (ADR 0041), for good: a 301, so a browser and the edge keep it.
// The loader rejects with the redirect: the lint keeps a bare `throw` for `Error`s, which a redirect is not.
export const agentsLoader = (): Promise<never> =>
  Effect.runPromise(
    Effect.fail(redirect({ href: INSTALL_PATH, statusCode: 301 }))
  );

export const Route = createFileRoute("/agents")({
  loader: agentsLoader,
});
