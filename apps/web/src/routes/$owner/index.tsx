import { Handle, reservedProjectNames } from "@repo/protocol/ids";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";

import { personPath } from "../../features/shared/paths.ts";

// A 302, since the address may yet hold a page of its own.

const decodeHandle = Schema.decodeOption(Handle);

const isReserved = (owner: string) =>
  reservedProjectNames.some((reserved) => reserved === owner.toLowerCase());

// The loader rejects with the redirect or the 404: the lint keeps a bare `throw` for `Error`s, which neither is.
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
