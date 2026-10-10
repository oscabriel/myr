/**
 * The `FrontPage` port: the read side of the projection every project feeds
 * (the write side is `Projection`, whose rows come from each project's
 * outbox). The front page and a person's credits read from here without
 * waking any project. The project list reads its rows here too, but a listed
 * project's `posture` is the fallback only: a list's callers read each
 * project's posture from its own ledger at list time (`withStandingPosture`),
 * since its standing changes without any event this read model hears, and
 * keep this one for a project whose ledger could not be read.
 *
 * Adapters: `/memory` here, seeded from data, for tests; `projection-d1`
 * over D1 in the Worker.
 */
import type { Reserve } from "@repo/protocol/domain/ask";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, KindName } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect } from "effect";

/** Which open asks to list: one kind, or the ones held for newcomers or for people. */
export interface FrontPageFilter {
  readonly kind?: KindName;
  readonly reserved?: Reserve;
}

export class FrontPage extends Context.Service<
  FrontPage,
  {
    /**
     * Every project, with how many asks it has open and the posture last
     * projected (the fallback for its standing posture).
     */
    readonly projects: () => Effect.Effect<readonly ProjectListing[]>;
    /** The open asks across every project, as the anonymous viewer sees them. */
    readonly entries: (
      filter: FrontPageFilter
    ) => Effect.Effect<readonly FrontPageEntry[]>;
    /** A person's credits across every project, by project, area and role. */
    readonly credits: (
      handle: Handle
    ) => Effect.Effect<readonly CreditSummary[]>;
  }
>()("project/FrontPage") {}
