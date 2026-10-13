import { redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { INBOX_PATH } from "../shared/paths.ts";

// Home and Today folded into the inbox (ADR 0041). The worker answers a document load with its own 301
// (`canonicalAddress`); this sends on a navigation inside the app, from a page kept before the move.
// It rejects with the redirect: the lint keeps a bare `throw` for `Error`s, which a redirect is not.
export const movedToInbox = ({
  location,
}: {
  readonly location: { readonly searchStr: string };
}): Promise<never> =>
  Effect.runPromise(
    Effect.fail(
      redirect({ href: `${INBOX_PATH}${location.searchStr}`, statusCode: 301 })
    )
  );
