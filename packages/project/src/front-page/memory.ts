/**
 * `FrontPage` in memory, seeded from data: what tests read the front page,
 * the project list and credits from (W3 312, 317). It filters as the D1
 * adapter does and never changes.
 */
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { CreditSummary } from "@repo/protocol/domain/record";
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";

import { FrontPage } from "../front-page.ts";
import type { FrontPageFilter } from "../front-page.ts";

/** What the memory front page reads back. */
export interface FrontPageSeed {
  readonly projects: readonly ProjectListing[];
  readonly entries: readonly FrontPageEntry[];
  /** Each credit, with the person it credits. */
  readonly credits: readonly {
    readonly handle: Handle;
    readonly credit: CreditSummary;
  }[];
}

const matches =
  (filter: FrontPageFilter) =>
  ({ ask }: FrontPageEntry) =>
    (filter.kind === undefined || ask.kind === filter.kind) &&
    (filter.reserved === undefined || ask.reserve === filter.reserved);

export const FrontPageMemory = {
  layer: (seed: FrontPageSeed): Layer.Layer<FrontPage> =>
    Layer.succeed(
      FrontPage,
      FrontPage.of({
        credits: (handle) =>
          Effect.succeed(
            seed.credits.flatMap((kept) =>
              sameHandle(kept.handle, handle) ? [kept.credit] : []
            )
          ),
        entries: (filter) =>
          Effect.succeed(seed.entries.filter(matches(filter))),
        projects: () => Effect.succeed(seed.projects),
      })
    ),
};
