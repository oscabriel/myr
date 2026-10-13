import { redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import {
  ENVIRONMENT_ANCHOR,
  LEDGER_ANCHOR,
  visibilityHref,
} from "../shared/paths.ts";

interface Moving {
  readonly location: { readonly searchStr: string };
  readonly params: { readonly project: string };
}

// A project's old ledger and env pages folded into the Visibility tab (ADR 0041). The worker answers a document load with
// its own 301 (`canonicalAddress`); this sends on a navigation inside the app, from a page kept before the move.
// It rejects with the redirect: the lint keeps a bare `throw` for `Error`s, which a redirect is not.
const movedFrom =
  (anchor: string) =>
  ({ location, params }: Moving): Promise<never> =>
    Effect.runPromise(
      Effect.fail(
        redirect({
          href: visibilityHref(params.project, anchor, location.searchStr),
          statusCode: 301,
        })
      )
    );

export const movedToEnvironment = movedFrom(ENVIRONMENT_ANCHOR);

export const movedToLedger = movedFrom(LEDGER_ANCHOR);
