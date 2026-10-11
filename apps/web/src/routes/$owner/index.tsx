import { Handle } from "@repo/protocol/ids";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

// `/<owner>` alone: a handle leads to the person's page,
// `/people/<handle>`, by a 302, since the address may yet hold a page of
// its own. An owner that is no handle (a source host, `/github.com`) is
// not found.

/** The redirect to the person's page, or a 404, as the route's loader rejects. */
export const ownerLoader = ({
  params,
}: {
  readonly params: { readonly owner: string };
}) =>
  Effect.runPromise(
    Schema.decodeEffect(Handle)(params.owner).pipe(
      Effect.mapError(() => notFound()),
      Effect.flatMap((handle) =>
        Effect.fail(
          redirect({
            params: { handle },
            statusCode: 302,
            to: "/people/$handle",
          })
        )
      )
    )
  );

export const Route = createFileRoute("/$owner/")({
  loader: ownerLoader,
});
