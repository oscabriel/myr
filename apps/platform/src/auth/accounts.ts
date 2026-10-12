import type { Handle } from "@repo/protocol/ids";
import { Context, Data, Schema } from "effect";
import type { Effect, Option } from "effect";

import type { PasswordHash } from "./password.ts";

// Enough to catch a typo; the mailed code is what proves the address.
export const Email = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u)
).pipe(Schema.brand("Email"));

export type Email = typeof Email.Type;

// The rule two spellings of one address are compared by.
export const emailKey = (email: Email) => email.toLowerCase();

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export const DisplayName = Schema.String.check(
  Schema.makeFilter((name) => {
    const { length } = [...graphemes.segment(name)];

    return name === name.trim() &&
      length >= 1 &&
      length <= 64 &&
      !/\p{Cc}/u.test(name)
      ? true
      : "1 to 64 characters, with no space at either end";
  })
).pipe(Schema.brand("DisplayName"));

export type DisplayName = typeof DisplayName.Type;

// Sign-up always sets `email` and `displayName`; only accounts made before
// either existed lack them.
export interface Account {
  readonly displayName?: DisplayName;
  readonly email?: Email;
  readonly handle: Handle;
  readonly hash: PasswordHash;
}

export class HandleTaken extends Data.TaggedError("HandleTaken")<{
  readonly handle: Handle;
}> {}

export class EmailTaken extends Data.TaggedError("EmailTaken")<{
  readonly email: Email;
}> {}

// The rule `sameHandle` compares by, so a racing second sign-up fails on the key.
export const handleKey = (handle: Handle) => handle.toLowerCase();

export class Accounts extends Context.Service<
  Accounts,
  {
    readonly create: (
      account: Account
    ) => Effect.Effect<void, HandleTaken | EmailTaken>;
    readonly find: (handle: Handle) => Effect.Effect<Option.Option<Account>>;
    readonly findByEmail: (
      email: Email
    ) => Effect.Effect<Option.Option<Account>>;
    // Only once its person proved the address.
    readonly setEmail: (
      handle: Handle,
      email: Email
    ) => Effect.Effect<void, EmailTaken>;
    readonly setPasswordHash: (
      handle: Handle,
      hash: PasswordHash
    ) => Effect.Effect<void>;
  }
>()("platform/Accounts") {}
