/**
 * The soft landing for a missing path (the nearest folder, with the
 * refusal above it): when a code page's path is not at a revision
 * that exists, the folders above it are read, nearest first, and the
 * first that exists travels in the 404 with the platform's `UnknownPath`,
 * so the page shows that folder with the refusal's own words as its
 * notice. The root always exists where the revision does. Not a route:
 * the `-` prefix keeps the router from reading it as one.
 */
import { Client } from "@repo/protocol/contracts";
import type { TreeListing } from "@repo/protocol/domain/code";
import { RepoPath } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import type { UnknownPath } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { DateTime, Effect, Option, Schema } from "effect";

import { ancestorsOf } from "../../../features/code/paths.ts";
import { SoftLanding } from "../../../features/code/soft-landing.ts";
import { notFoundFor } from "../../../features/shared/refusals.ts";

/** Each folder above `path`, nearest first, then the root (none). */
const above = (path: string): readonly Option.Option<RepoPath>[] => [
  ...ancestorsOf(path)
    .toReversed()
    .map((folder) => Option.some(RepoPath.make(folder))),
  Option.none(),
];

/** A 404 for `refusal` that lands on the nearest folder above its path at its commit. */
export const softLanding = (
  refusal: UnknownPath,
  project: ProjectName,
  rev: string
) =>
  Effect.gen(function* () {
    const client = yield* Client;

    const read = (folder: Option.Option<RepoPath>) =>
      client
        .readTree({
          at: refusal.commit,
          project,
          ...Option.match(folder, {
            onNone: () => ({}),
            onSome: (path) => ({ path }),
          }),
        })
        .pipe(Effect.option);

    let nearest = Option.none<TreeListing>();

    for (const folder of above(refusal.path)) {
      nearest = yield* read(folder);

      if (Option.isSome(nearest)) {
        break;
      }
    }

    if (Option.isNone(nearest)) {
      return yield* notFoundFor(refusal);
    }

    const data = yield* Schema.encodeEffect(SoftLanding)({
      nearest: nearest.value,
      now: yield* DateTime.now,
      project,
      refusals: [refusal],
      rev,
    });

    return yield* Effect.fail(notFound({ data }));
  });
