import { Context, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient, RpcClientError } from "effect/rpc";

import { Description } from "./annotations.ts";
import { AskId, CommitSha, ProjectName } from "./ids.ts";
import { Authenticated } from "./principal.ts";
import { ClaimLapsed, NotClaimed, RepoBusy, StaleBase } from "./refusal.ts";

/** One open ask, as a list of asks shows it. */
export const AskListing = Schema.Struct({
  ask: AskId,
  claimed: Schema.Boolean,
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

export class ListAsks extends Rpc.make("listAsks", {
  payload: { project: ProjectName },
  success: Schema.Struct({ asks: Schema.Array(AskListing) }),
}).annotate(Description, "List a project's open asks.") {}

export class SubmitAnswer extends Rpc.make("submitAnswer", {
  error: Schema.Union([NotClaimed, ClaimLapsed, StaleBase, RepoBusy]),
  payload: { ask: AskId, base: CommitSha, head: CommitSha },
  success: Schema.Struct({ main: CommitSha }),
}).annotate(
  Description,
  "Offer the commit `head`, built on `base`, as an answer to an ask; once it lands, `main` is the new tip."
) {}

/** The one schema: every surface is a projection of this group. */
export class Contracts extends RpcGroup.make(ListAsks, SubmitAnswer).middleware(
  Authenticated
) {}

/** A way to call the contracts, in process or over the wire. */
export class Client extends Context.Service<
  Client,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof Contracts>,
    RpcClientError.RpcClientError
  >
>()("protocol/Client") {}
