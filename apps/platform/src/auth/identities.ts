/**
 * Identities: a person's account at an outside provider, linked to a
 * platform handle (issue 419). Only the provider's stable subject id is
 * kept against the handle's key: no email, no name, no token. Google is
 * the one provider; the handle stays how the platform knows the person.
 */
import type { Handle } from "@repo/protocol/ids";
import { Context, Data } from "effect";
import type { Effect, Option } from "effect";

/** The outside providers a person may sign in with. */
export type IdentityProvider = "google";

/**
 * The provider's account is already linked to another handle. Internal to
 * `auth/`: it renders as a page with a plain message, never a refusal.
 */
export class IdentityTaken extends Data.TaggedError("IdentityTaken")<{
  readonly provider: IdentityProvider;
  readonly subject: string;
}> {}

/**
 * Where links live: `/memory` for tests, D1 on Cloudflare
 * (`adapters/identities-d1.ts`). A link is keyed by (provider, subject), so
 * one outside account names one handle; linking it again to the same
 * handle, in any case, changes nothing.
 */
export class Identities extends Context.Service<
  Identities,
  {
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
