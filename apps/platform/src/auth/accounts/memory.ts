import { Effect, Layer, Option, Ref } from "effect";

import {
  Accounts,
  EmailTaken,
  emailKey,
  handleKey,
  HandleTaken,
} from "../accounts.ts";
import type { Account, Email } from "../accounts.ts";

const holderOf = (
  accounts: ReadonlyMap<string, Account>,
  email: Email
): Option.Option<Account> =>
  Option.fromUndefinedOr(
    [...accounts.values()].find(
      (account) =>
        account.email !== undefined &&
        emailKey(account.email) === emailKey(email)
    )
  );

export const AccountsMemory = {
  layer: Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const store = yield* Ref.make<ReadonlyMap<string, Account>>(new Map());

      return Accounts.of({
        create: (account) =>
          Effect.gen(function* () {
            const key = handleKey(account.handle);

            const refused = yield* Ref.modify(
              store,
              (
                accounts
              ): readonly [
                Option.Option<HandleTaken | EmailTaken>,
                ReadonlyMap<string, Account>,
              ] => {
                if (accounts.has(key)) {
                  return [
                    Option.some(new HandleTaken({ handle: account.handle })),
                    accounts,
                  ];
                }

                if (
                  account.email !== undefined &&
                  Option.isSome(holderOf(accounts, account.email))
                ) {
                  return [
                    Option.some(new EmailTaken({ email: account.email })),
                    accounts,
                  ];
                }

                return [Option.none(), new Map(accounts).set(key, account)];
              }
            );

            return yield* Option.isSome(refused)
              ? Effect.fail(refused.value)
              : Effect.void;
          }),
        find: (handle) =>
          Ref.get(store).pipe(
            Effect.map((accounts) =>
              Option.fromUndefinedOr(accounts.get(handleKey(handle)))
            )
          ),
        findByEmail: (email) =>
          Ref.get(store).pipe(
            Effect.map((accounts) => holderOf(accounts, email))
          ),
        setEmail: (handle, email) =>
          Ref.modify(store, (accounts) => {
            const key = handleKey(handle);

            const account = accounts.get(key);

            const holder = holderOf(accounts, email);

            // As D1's update, which changes no row for a handle nobody holds.
            if (
              account === undefined ||
              Option.exists(holder, (held) => handleKey(held.handle) !== key)
            ) {
              return [false, accounts];
            }

            return [true, new Map(accounts).set(key, { ...account, email })];
          }).pipe(
            Effect.filterOrFail(
              (set) => set,
              () => new EmailTaken({ email })
            ),
            Effect.asVoid
          ),
        setPasswordHash: (handle, hash) =>
          Ref.update(store, (accounts) => {
            const key = handleKey(handle);

            const account = accounts.get(key);

            return account === undefined
              ? accounts
              : new Map(accounts).set(key, { ...account, hash });
          }),
      });
    })
  ),
};
