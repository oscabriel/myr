/**
 * Accounts: the platform's own people, each a handle and a password hash.
 * The handle is how the platform knows them; two handles that differ only
 * in case are one account (protocol's `sameHandle`).
 */
import type { Handle } from "@repo/protocol/ids";
import { Context, Data } from "effect";
import type { Effect, Option } from "effect";

import type { PasswordHash } from "./password.ts";

/** An account as the platform keeps it: its handle as it was chosen, and its hash. */
export interface Account {
  readonly handle: Handle;
  readonly hash: PasswordHash;
}

/** Someone already signed up with this handle, in some case. Internal to `auth/`. */
export class HandleTaken extends Data.TaggedError("HandleTaken")<{
  readonly handle: Handle;
}> {}

/**
 * The key an account is stored under: the handle lowercased, the same rule
 * `sameHandle` compares by, so a racing second sign-up fails on the key.
 */
export const handleKey = (handle: Handle) => handle.toLowerCase();

/** Where accounts live: `/memory` for tests, D1 on Cloudflare (`adapters/accounts-d1.ts`). */
export class Accounts extends Context.Service<
  Accounts,
  {
    readonly create: (
      handle: Handle,
      hash: PasswordHash
    ) => Effect.Effect<void, HandleTaken>;
    readonly find: (handle: Handle) => Effect.Effect<Option.Option<Account>>;
    readonly setPasswordHash: (
      handle: Handle,
      hash: PasswordHash
    ) => Effect.Effect<void>;
  }
>()("platform/Accounts") {}
