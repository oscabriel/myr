import type { Handle } from "@repo/protocol/ids";
import { Context, Data } from "effect";
import type { Effect, Option } from "effect";

export type IdentityProvider = "google";

export class IdentityTaken extends Data.TaggedError("IdentityTaken")<{
  readonly provider: IdentityProvider;
  readonly subject: string;
}> {}

export class Identities extends Context.Service<
  Identities,
  {
    // The handle's key, lowercased: show the account's own handle, never this one.
    readonly handleOf: (
      provider: IdentityProvider,
      subject: string
    ) => Effect.Effect<Option.Option<Handle>>;
    readonly link: (
      provider: IdentityProvider,
      subject: string,
      handle: Handle
    ) => Effect.Effect<void, IdentityTaken>;
  }
>()("platform/Identities") {}
