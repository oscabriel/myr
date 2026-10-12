import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Handle } from "@repo/protocol/ids";
import { Effect, Exit, FileSystem, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { AccountsD1 } from "../src/adapters/accounts-d1.ts";
import { Accounts, HandleTaken } from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { PasswordHash } from "../src/auth/password.ts";

const alice = Handle.make("alice");

const first = PasswordHash.make("pbkdf2-sha256$100000$Zmlyc3Q$Zmlyc3Q");

const second = PasswordHash.make("pbkdf2-sha256$100000$c2Vjb25k$c2Vjb25k");

const find = (handle: string) =>
  Accounts.use((accounts) => accounts.find(Handle.make(handle)));

const describeAccounts = (adapter: string, layer: Layer.Layer<Accounts>) => {
  describe(`Accounts over ${adapter}`, () => {
    it.effect("finds an account by its handle, in any case", () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts;

        yield* accounts.create(Handle.make("Alice"), first);

        const found = Option.some({
          handle: Handle.make("Alice"),
          hash: first,
        });

        expect(yield* find("Alice")).toStrictEqual(found);
        expect(yield* find("alice")).toStrictEqual(found);
        expect(yield* find("ALICE")).toStrictEqual(found);
      }).pipe(Effect.provide(layer))
    );

    it.effect("finds nobody under a handle no one signed up with", () =>
      Effect.gen(function* () {
        expect(yield* find("bob")).toStrictEqual(Option.none());
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "refuses a second account whose handle differs only in case, and keeps the first",
      () =>
        Effect.gen(function* () {
          const accounts = yield* Accounts;

          yield* accounts.create(alice, first);

          const taken = yield* Effect.flip(
            accounts.create(Handle.make("ALICE"), second)
          );

          expect(taken).toStrictEqual(
            new HandleTaken({ handle: Handle.make("ALICE") })
          );
          expect(yield* find("alice")).toStrictEqual(
            Option.some({ handle: alice, hash: first })
          );
        }).pipe(Effect.provide(layer))
    );

    it.effect("lets exactly one of two racing sign-ups have a handle", () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts;

        const exits = yield* Effect.all(
          [
            Effect.exit(accounts.create(alice, first)),
            Effect.exit(accounts.create(Handle.make("Alice"), second)),
          ],
          { concurrency: "unbounded" }
        );

        expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
      }).pipe(Effect.provide(layer))
    );

    it.effect("replaces an account's password hash", () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts;

        yield* accounts.create(alice, first);
        yield* accounts.setPasswordHash(Handle.make("ALICE"), second);

        expect(yield* find("alice")).toStrictEqual(
          Option.some({ handle: alice, hash: second })
        );
      }).pipe(Effect.provide(layer))
    );
  });
};

describeAccounts("memory", Layer.fresh(AccountsMemory.layer));

const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const sql = yield* SqlClient;

    const ddl = yield* fs.readFileString(
      new URL("../migrations/0002_accounts.sql", import.meta.url).pathname
    );

    yield* sql.unsafe(ddl);
  })
).pipe(Layer.orDie, Layer.provide(NodeServices.layer));

const database = migrated.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie
);

describeAccounts("D1 (sqlite-node)", AccountsD1.pipe(Layer.provide(database)));
