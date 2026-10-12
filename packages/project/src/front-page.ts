import type { Reserve } from "@repo/protocol/domain/ask";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, KindName } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect } from "effect";

export interface FrontPageFilter {
  readonly kind?: KindName;
  readonly reserved?: Reserve;
}

export class FrontPage extends Context.Service<
  FrontPage,
  {
    /** A listing's `posture` is a fallback only: callers read each project's own ledger (`withStandingPosture`). */
    readonly projects: () => Effect.Effect<readonly ProjectListing[]>;
    readonly entries: (
      filter: FrontPageFilter
    ) => Effect.Effect<readonly FrontPageEntry[]>;
    readonly credits: (
      handle: Handle
    ) => Effect.Effect<readonly CreditSummary[]>;
  }
>()("project/FrontPage") {}
