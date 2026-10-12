import type { Handle } from "@repo/protocol/ids";
import { Context, Data } from "effect";
import type { Effect, Option } from "effect";

import type { PasswordHash } from "./password.ts";

export interface Account {
  readonly handle: Handle;
  readonly hash: PasswordHash;
}

export class HandleTaken extends Data.TaggedError("HandleTaken")<{
  readonly handle: Handle;
}> {}

// The rule `sameHandle` compares by, so a racing second sign-up fails on the key.
export const handleKey = (handle: Handle) => handle.toLowerCase();

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
