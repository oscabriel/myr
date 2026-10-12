import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Handle } from "@repo/protocol/ids";
import { Effect, Exit, FileSystem, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { AccountsD1 } from "../src/adapters/accounts-d1.ts";
import {
  Accounts,
  DisplayName,
  Email,
  EmailTaken,
  HandleTaken,
} from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { PasswordHash } from "../src/auth/password.ts";

const alice = Handle.make("alice");

const first = PasswordHash.make("pbkdf2-sha256$100000$Zmlyc3Q$Zmlyc3Q");

const second = PasswordHash.make("pbkdf2-sha256$100000$c2Vjb25k$c2Vjb25k");

const aliceEmail = Email.make("alice@mail.example");

const aliceName = DisplayName.make("Alice Example");

const find = (handle: string) =>
  Accounts.use((accounts) => accounts.find(Handle.make(handle)));

const describeAccounts = (adapter: string, layer: Layer.Layer<Accounts>) => {
  describe(`Accounts over ${adapter}`, () => {
    it.effect("finds an account by its handle, in any case", () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts;

        yield* accounts.create({ handle: Handle.make("Alice"), hash: first });

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

          yield* accounts.create({ handle: alice, hash: first });

          const taken = yield* Effect.flip(
            accounts.create({ handle: Handle.make("ALICE"), hash: second })
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
            Effect.exit(accounts.create({ handle: alice, hash: first })),
            Effect.exit(
              accounts.create({ handle: Handle.make("Alice"), hash: second })
            ),
          ],
          { concurrency: "unbounded" }
        );

        expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
      }).pipe(Effect.provide(layer))
    );

    it.effect("replaces an account's password hash", () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts;

        yield* accounts.create({ handle: alice, hash: first });
        yield* accounts.setPasswordHash(Handle.make("ALICE"), second);

        expect(yield* find("alice")).toStrictEqual(
          Option.some({ handle: alice, hash: second })
        );
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "keeps an account's email and display name, and finds it by its email in any case",
      () =>
        Effect.gen(function* () {
          const accounts = yield* Accounts;

          const account = {
            displayName: aliceName,
            email: aliceEmail,
            handle: alice,
            hash: first,
          };

          yield* accounts.create(account);

          expect(yield* find("ALICE")).toStrictEqual(Option.some(account));
          expect(
            yield* accounts.findByEmail(Email.make("ALICE@Mail.Example"))
          ).toStrictEqual(Option.some(account));
          expect(
            yield* accounts.findByEmail(Email.make("bob@mail.example"))
          ).toStrictEqual(Option.none());
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "refuses a second account with the same email in another case, and lets any number have none",
      () =>
        Effect.gen(function* () {
          const accounts = yield* Accounts;

          yield* accounts.create({
            email: aliceEmail,
            handle: alice,
            hash: first,
          });
          yield* accounts.create({ handle: Handle.make("carol"), hash: first });
          yield* accounts.create({ handle: Handle.make("dave"), hash: first });

          const shouted = Email.make("ALICE@mail.example");

          expect(
            yield* Effect.flip(
              accounts.create({
                email: shouted,
                handle: Handle.make("bob"),
                hash: second,
              })
            )
          ).toStrictEqual(new EmailTaken({ email: shouted }));
          expect(yield* find("bob")).toStrictEqual(Option.none());
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "sets an account's email, unless another account holds it or no account has the handle",
      () =>
        Effect.gen(function* () {
          const accounts = yield* Accounts;

          const bobEmail = Email.make("bob@mail.example");

          yield* accounts.create({ handle: alice, hash: first });
          yield* accounts.create({
            email: bobEmail,
            handle: Handle.make("bob"),
            hash: second,
          });

          yield* accounts.setEmail(Handle.make("ALICE"), aliceEmail);

          expect(yield* find("alice")).toStrictEqual(
            Option.some({ email: aliceEmail, handle: alice, hash: first })
          );
          expect(
            yield* Effect.flip(accounts.setEmail(alice, bobEmail))
          ).toStrictEqual(new EmailTaken({ email: bobEmail }));
          expect(
            yield* Effect.exit(
              accounts.setEmail(
                Handle.make("nobody"),
                Email.make("n@mail.example")
              )
            )
          ).toStrictEqual(
            Exit.fail(new EmailTaken({ email: Email.make("n@mail.example") }))
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

    for (const migration of ["0002_accounts.sql", "0006_account_email.sql"]) {
      const ddl = yield* fs.readFileString(
        new URL(`../migrations/${migration}`, import.meta.url).pathname
      );

      // One statement a call; a comment may hold a semicolon, so comments go first.
      const statements = ddl
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .split(";")
        .filter((part) => part.trim() !== "");

      for (const statement of statements) {
        yield* sql.unsafe(statement);
      }
    }
  })
).pipe(Layer.orDie, Layer.provide(NodeServices.layer));

const database = migrated.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie
);

describeAccounts("D1 (sqlite-node)", AccountsD1.pipe(Layer.provide(database)));
