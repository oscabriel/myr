// Development only: the leading `-` keeps this module out of the route tree, and only a development build imports it.
import { Handle } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import type { Handled } from "../../server/session.ts";
import { redirect, returnPath, sessionCookie } from "../../server/session.ts";

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
