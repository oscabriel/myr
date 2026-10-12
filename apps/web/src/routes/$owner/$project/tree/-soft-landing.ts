import { Client } from "@repo/protocol/contracts";
import type { TreeListing } from "@repo/protocol/domain/code";
import { RepoPath } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import type { UnknownPath } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { DateTime, Effect, Option, Schema } from "effect";

import { ancestorsOf } from "../../../../features/code/paths.ts";
import { SoftLanding } from "../../../../features/code/soft-landing.ts";
import { notFoundFor } from "../../../../features/shared/refusals.ts";

const above = (path: string): readonly Option.Option<RepoPath>[] => [
  ...ancestorsOf(path)
    .toReversed()
    .map((folder) => Option.some(RepoPath.make(folder))),
  Option.none(),
];

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
