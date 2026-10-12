import { Handle } from "@repo/protocol/ids";
import { Array, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { handleKey } from "../auth/accounts.ts";
import { Identities, IdentityTaken } from "../auth/identities.ts";

const Rows = Schema.Array(Schema.Struct({ handle_key: Handle }));

const decodeRows = Schema.decodeUnknownEffect(Rows);

export const IdentitiesD1 = Layer.effect(
  Identities,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const handleOf = (provider: string, subject: string) =>
      sql`
        SELECT handle_key FROM identities
        WHERE provider = ${provider} AND subject = ${subject}`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
        Effect.map((rows) =>
          Option.map(Array.head(rows), (row) => row.handle_key)
        )
      );

    return Identities.of({
      handleOf,
      // One statement decides who holds the subject, however two links race;
      // a subject already held is fine only when it names the same handle.
      link: (provider, subject, handle) =>
        sql`
          INSERT INTO identities (provider, subject, handle_key)
          VALUES (${provider}, ${subject}, ${handleKey(handle)})
          ON CONFLICT (provider, subject) DO NOTHING`.pipe(
          Effect.orDie,
          Effect.andThen(handleOf(provider, subject)),
          Effect.filterOrFail(
            (held) =>
              Option.exists(held, (linked) => linked === handleKey(handle)),
            () => new IdentityTaken({ provider, subject })
          ),
          Effect.asVoid
        ),
    });
  })
);
