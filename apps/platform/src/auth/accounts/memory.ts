import { Effect, Layer, Option, Ref } from "effect";

import { Accounts, handleKey, HandleTaken } from "../accounts.ts";
import type { Account } from "../accounts.ts";

export const AccountsMemory = {
  layer: Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const store = yield* Ref.make(new Map<string, Account>());

      return Accounts.of({
        create: (handle, hash) =>
          Ref.modify(store, (accounts) => {
            const key = handleKey(handle);

            return accounts.has(key)
              ? [false, accounts]
              : [true, new Map(accounts).set(key, { handle, hash })];
          }).pipe(
            Effect.filterOrFail(
              (created) => created,
              () => new HandleTaken({ handle })
            ),
            Effect.asVoid
          ),
        find: (handle) =>
          Ref.get(store).pipe(
            Effect.map((accounts) =>
              Option.fromUndefinedOr(accounts.get(handleKey(handle)))
            )
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
