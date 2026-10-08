/**
 * The dev sign-in, for `vite dev` and tests only: `GET /auth/dev?handle=<h>`
 * sets the session cookie to `dev-<h>`, the token the dev backend (`#backend`
 * under the `development` condition) knows as that fictional
 * person, so Today and decide can be tried with no platform.
 *
 * The leading `-` keeps this module out of the route tree; `$.ts` reaches
 * it through an `import()` that only a development build keeps, so the
 * production bundle carries none of it (`test/production-bundle.test.ts`).
 */
import { Handle } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import type { Handled } from "../../server/session.ts";
import { redirect, returnPath, sessionCookie } from "../../server/session.ts";

/** How long a dev session lasts: a working day. */
const DEV_SESSION_SECONDS = 8 * 60 * 60;

const decodeHandle = Schema.decodeUnknownOption(Handle);

export const devSignIn = ({ request }: Handled): Response => {
  const here = new URL(request.url);

  return Option.match(decodeHandle(here.searchParams.get("handle")), {
    onNone: () =>
      new Response("Give a handle: /auth/dev?handle=<handle>", {
        headers: { "cache-control": "no-store" },
        status: 400,
      }),
    onSome: (handle) =>
      redirect(returnPath(here.origin, here.searchParams.get("return")), [
        sessionCookie(`dev-${handle}`, DEV_SESSION_SECONDS),
      ]),
  });
};
