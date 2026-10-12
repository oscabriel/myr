import { Handle } from "@repo/protocol/ids";
import { Array, Clock, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { Accounts, handleKey, HandleTaken } from "../auth/accounts.ts";
import { PasswordHash } from "../auth/password.ts";

const Rows = Schema.Array(
  Schema.Struct({ handle: Handle, password_hash: PasswordHash })
);

const decodeRows = Schema.decodeUnknownEffect(Rows);

export const AccountsD1 = Layer.effect(
  Accounts,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    return Accounts.of({
      // One statement: a second sign-up under the same key inserts nothing
      // and returns no row, however the two race.
      create: (handle, hash) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;

          yield* sql`
            INSERT INTO accounts (handle_key, handle, password_hash, created_at)
            VALUES (${handleKey(handle)}, ${handle}, ${hash}, ${now})
            ON CONFLICT (handle_key) DO NOTHING
            RETURNING handle_key`.pipe(
            Effect.orDie,
            Effect.filterOrFail(
              (inserted) => inserted.length > 0,
              () => new HandleTaken({ handle })
            )
          );
        }),
      find: (handle) =>
        sql`
          SELECT handle, password_hash FROM accounts
          WHERE handle_key = ${handleKey(handle)}`.pipe(
          Effect.flatMap(decodeRows),
          Effect.orDie,
          Effect.map((rows) =>
            Option.map(Array.head(rows), (row) => ({
              handle: row.handle,
              hash: row.password_hash,
            }))
          )
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
