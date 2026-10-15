import { redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { policyHref } from "../shared/paths.ts";

// A project's policy page was `/people` until the People tab folded into it. The worker answers a document load with
// its own 301 (`canonicalAddress`); this sends on a navigation inside the app, from a page kept before the move.
// It rejects with the redirect: the lint keeps a bare `throw` for `Error`s, which a redirect is not.
export const movedToPolicy = ({
  location,
  params,
}: {
  readonly location: { readonly searchStr: string };
  readonly params: { readonly project: string };
}): Promise<never> =>
  Effect.runPromise(
    Effect.fail(
      redirect({
        href: policyHref(params.project, location.searchStr),
        statusCode: 301,
      })
    )
  );
