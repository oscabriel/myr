// Development only: the leading `-` keeps this module out of the route tree, and only a development build imports it.
// The dev world (src/dev) has no platform to authorize against, so a development build's sign-in ends here: a page
// that lists the dev world's people, each a link that sets the session to that person's dev token.
import { Handle } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { devPeople } from "../../dev/seed.ts";
import type { Handled } from "../../server/session.ts";
import { redirect, returnPath, sessionCookie } from "../../server/session.ts";

const DEV_SESSION_SECONDS = 8 * 60 * 60;

const DEV_SIGN_IN_PATH = "/auth/dev";

const decodeHandle = Schema.decodeUnknownOption(Handle);

const attribute = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const devSignInHref = (back: string, handle?: Handle) => {
  const query = new URLSearchParams();

  if (handle !== undefined) {
    query.set("handle", handle);
  }

  query.set("return", back);

  return `${DEV_SIGN_IN_PATH}?${query.toString()}`;
};

const chooser = (back: string) =>
  new Response(
    [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>Sign in (dev)</title>",
      "<style>body{font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:28rem;padding:0 1rem}li{margin:.25rem 0}</style>",
      "</head><body><h1>Sign in to the dev world</h1>",
      "<p>No platform runs here. Pick a person of the dev world; the session is theirs for eight hours.</p>",
      "<ul>",
      ...devPeople.map(
        (handle) =>
          `<li><a href="${attribute(devSignInHref(back, handle))}">${attribute(handle)}</a></li>`
      ),
      "</ul></body></html>",
    ].join("\n"),
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    }
  );

/** Where a development build's `/auth/signin` sends the browser, its `return` kept. */
export const toDevSignIn = ({ request }: Handled): Response => {
  const here = new URL(request.url);

  return redirect(
    devSignInHref(returnPath(here.origin, here.searchParams.get("return"))),
    []
  );
};

export const devSignIn = ({ request }: Handled): Response => {
  const here = new URL(request.url);
  const back = returnPath(here.origin, here.searchParams.get("return"));
  const wanted = here.searchParams.get("handle");

  if (wanted === null) {
    return chooser(back);
  }

  return Option.match(decodeHandle(wanted), {
    onNone: () =>
      new Response(`Give a handle: ${DEV_SIGN_IN_PATH}?handle=<handle>`, {
        headers: { "cache-control": "no-store" },
        status: 400,
      }),
    onSome: (handle) =>
      redirect(back, [sessionCookie(`dev-${handle}`, DEV_SESSION_SECONDS)]),
  });
};
