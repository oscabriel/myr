import { Handle } from "@repo/protocol/ids";
import { Array, Clock, Effect, Layer, Option, Schema } from "effect";
import type { Types } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import {
  Accounts,
  DisplayName,
  Email,
  EmailTaken,
  emailKey,
  handleKey,
  HandleTaken,
} from "../auth/accounts.ts";
import type { Account } from "../auth/accounts.ts";
import { PasswordHash } from "../auth/password.ts";

const Rows = Schema.Array(
  Schema.Struct({
    display_name: Schema.NullOr(DisplayName),
    email: Schema.NullOr(Email),
    handle: Handle,
    password_hash: PasswordHash,
  })
);

const decodeRows = Schema.decodeUnknownEffect(Rows);

// An account made before emails has neither column set.
const accountOf = (row: (typeof Rows.Type)[number]): Account => {
  const account: Types.Mutable<Account> = {
    handle: row.handle,
    hash: row.password_hash,
  };

  if (row.display_name !== null) {
    account.displayName = row.display_name;
  }

  if (row.email !== null) {
    account.email = row.email;
  }

  return account;
};

const one = (rows: readonly unknown[]) =>
  Effect.map(decodeRows(rows), (decoded) =>
    Option.map(Array.head(decoded), accountOf)
  );

export const AccountsD1 = Layer.effect(
  Accounts,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const find = (handle: Handle) =>
      sql`
        SELECT handle, password_hash, email, display_name FROM accounts
        WHERE handle_key = ${handleKey(handle)}`.pipe(
        Effect.flatMap(one),
        Effect.orDie
      );

    const findByEmail = (email: Email) =>
      sql`
        SELECT handle, password_hash, email, display_name FROM accounts
        WHERE email_key = ${emailKey(email)}`.pipe(
        Effect.flatMap(one),
        Effect.orDie
      );

    return Accounts.of({
      // One statement: a second sign-up under the same handle or email
      // inserts nothing and returns no row, however the two race; which key
      // it lost on is read after.
      create: (account) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;

          const inserted = yield* sql`
            INSERT INTO accounts
              (handle_key, handle, password_hash, created_at, email, email_key, display_name)
            VALUES (
              ${handleKey(account.handle)},
              ${account.handle},
              ${account.hash},
              ${now},
              ${account.email ?? null},
              ${account.email === undefined ? null : emailKey(account.email)},
              ${account.displayName ?? null}
            )
            ON CONFLICT DO NOTHING
            RETURNING handle_key`.pipe(Effect.orDie);

          const lost = Effect.flatMap(
            find(account.handle),
            (held): Effect.Effect<never, HandleTaken | EmailTaken> =>
              Option.isSome(held) || account.email === undefined
                ? Effect.fail(new HandleTaken({ handle: account.handle }))
                : Effect.fail(new EmailTaken({ email: account.email }))
          );

          return yield* inserted.length > 0 ? Effect.void : lost;
        }),
      find,
      findByEmail,
      // `OR IGNORE` skips the row when another account holds the address,
      // so nothing comes back.
      setEmail: (handle, email) =>
        sql`
          UPDATE OR IGNORE accounts
          SET email = ${email}, email_key = ${emailKey(email)}
          WHERE handle_key = ${handleKey(handle)}
          RETURNING handle_key`.pipe(
          Effect.orDie,
          Effect.filterOrFail(
            (updated) => updated.length > 0,
            () => new EmailTaken({ email })
          ),
          Effect.asVoid
        ),
      setPasswordHash: (handle, hash) =>
        sql`
          UPDATE accounts SET password_hash = ${hash}
          WHERE handle_key = ${handleKey(handle)}`.pipe(
          Effect.orDie,
          Effect.asVoid
        ),
    });
  })
);
