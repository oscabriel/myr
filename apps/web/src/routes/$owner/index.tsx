import { Handle, reservedProjectNames } from "@repo/protocol/ids";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";

import { personPath } from "../../features/shared/paths.ts";

// `/<owner>` alone: a handle leads to the person's page,
// `/people/<handle>` in lowercase (handles compare without case), by a
// 302, since the address may yet hold a page of its own. An owner that is
// no handle (a source host, `/github.com`) and a word the web keeps for
// itself (`/icons`) are not found.

const decodeHandle = Schema.decodeOption(Handle);

const isReserved = (owner: string) =>
  reservedProjectNames.some((reserved) => reserved === owner.toLowerCase());

/**
 * The redirect to the person's page, or a 404, as the loader's rejection:
 * the router reads either from a failed load (the lint keeps a bare
 * `throw` for `Error`s, which neither is).
 */
export const ownerLoader = ({
  params,
}: {
  readonly params: { readonly owner: string };
}): Promise<never> =>
  Effect.runPromise(
    Option.match(
      isReserved(params.owner)
        ? Option.none()
        : decodeHandle(params.owner.toLowerCase()),
      {
        onNone: () => Effect.fail(notFound()),
        onSome: (handle) =>
          Effect.fail(redirect({ href: personPath(handle), statusCode: 302 })),
      }
    )
  );

export const Route = createFileRoute("/$owner/")({
  loader: ownerLoader,
});
