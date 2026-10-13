import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import { RECENT_LANDINGS_CAP } from "@repo/protocol/domain/recent-landing";
import type { RecentLanding } from "@repo/protocol/domain/recent-landing";
import type { CreditSummary } from "@repo/protocol/domain/record";
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";

import { FrontPage } from "../front-page.ts";
import type { FrontPageFilter } from "../front-page.ts";

export interface FrontPageSeed {
  readonly projects: readonly ProjectListing[];
  readonly entries: readonly FrontPageEntry[];
  readonly credits: readonly {
    readonly handle: Handle;
    readonly credit: CreditSummary;
  }[];
  /** The latest first; none when absent. */
  readonly landings?: readonly RecentLanding[];
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
        recentLandings: () =>
          Effect.succeed((seed.landings ?? []).slice(0, RECENT_LANDINGS_CAP)),
      })
    ),
};
