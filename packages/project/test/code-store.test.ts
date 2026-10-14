import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Exit, Layer, Logger, Option } from "effect";

import { CodeStore } from "../src/code-store.ts";
import { CodeStoreR2 } from "../src/code-store/binding.ts";
import type { BucketLike } from "../src/code-store/binding.ts";
import { CodeStoreCounts, CodeStoreMemory } from "../src/code-store/memory.ts";
import { fileOf, treeOf } from "../src/code.ts";
import { datekit } from "./code-fixtures.ts";

const key = "datekit/why/v1/1111111111111111111111111111111111111111/main/ab";

/** A key one byte past R2's limit of 1,024. */
const tooLong = "k".repeat(1025);

const putThenGet = Effect.gen(function* () {
  const store = yield* CodeStore;

  yield* store.put(key, '{"lines":[]}');

  return yield* store.get(key);
});

const bucketOf = (fails: {
  readonly get?: boolean;
  readonly put?: boolean;
}) => {
  const objects = new Map<string, string>();

  const bucket: BucketLike = {
    get: (name) =>
      fails.get === true
        ? Promise.reject(new Error("R2 is down"))
        : Promise.resolve(
            Option.match(Option.fromUndefinedOr(objects.get(name)), {
              onNone: () => null,
              onSome: (text) => ({ text: () => Promise.resolve(text) }),
            })
          ),
    put: (name, value) => {
      if (fails.put === true) {
        return Promise.reject(new Error("R2 is down"));
      }

      objects.set(name, value);

      return Promise.resolve({ key: name });
    },
  };

  return bucket;
};

const logged = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const messages: unknown[] = [];

    const capture = Logger.make(({ message }) => {
      messages.push(message);
    });

    const exit = yield* Effect.exit(
      effect.pipe(Effect.provide(Logger.layer([capture])))
    );

    return { exit, messages };
  });

describe("the code store", () => {
  it.effect("stores nothing until a host gives it a store", () =>
    Effect.map(putThenGet, (got) => {
      expect(got).toStrictEqual(Option.none());
    })
  );

  it.effect("in memory, gives back what was put, and counts each call", () =>
    Effect.gen(function* () {
      const got = yield* putThenGet;

      const missed = yield* Effect.flatMap(CodeStore, (store) =>
        store.get(`${key}/other`)
      );

      expect({
        counts: yield* CodeStoreCounts.use(({ counts }) => counts),
        got,
        missed,
      }).toStrictEqual({
        counts: { gets: 2, puts: 1 },
        got: Option.some('{"lines":[]}'),
        missed: Option.none(),
      });
    }).pipe(Effect.provide(CodeStoreMemory))
  );

  it.effect("over R2, gives back what was put", () =>
    Effect.map(
      putThenGet.pipe(Effect.provide(CodeStoreR2(bucketOf({})))),
      (got) => {
        expect(got).toStrictEqual(Option.some('{"lines":[]}'));
      }
    )
  );

  it.effect("over R2, reads a failed get as a miss and logs it", () =>
    Effect.map(
      logged(
        putThenGet.pipe(Effect.provide(CodeStoreR2(bucketOf({ get: true }))))
      ),
      ({ exit, messages }) => {
        expect(exit).toStrictEqual(Exit.succeed(Option.none()));
        expect(messages.length).toBeGreaterThan(0);
      }
    )
  );

  it.effect("over R2, never fails its caller on a failed put", () =>
    Effect.map(
      logged(
        Effect.flatMap(CodeStore, (store) => store.put(key, "{}")).pipe(
          Effect.provide(CodeStoreR2(bucketOf({ put: true })))
        )
      ),
      ({ exit, messages }) => {
        expect(exit).toStrictEqual(Exit.void);
        expect(messages.length).toBeGreaterThan(0);
      }
    )
  );

  it.effect.each([
    ["the default", Layer.empty],
    ["memory", CodeStoreMemory],
    ["R2", CodeStoreR2(bucketOf({}))],
  ] as const)(
    "%s refuses a key over 1,024 bytes as a defect, so callers hash paths",
    ([, layer]) =>
      Effect.gen(function* () {
        const store = yield* CodeStore;

        expect([
          Exit.hasDies(yield* Effect.exit(store.get(tooLong))),
          Exit.hasDies(yield* Effect.exit(store.put(tooLong, "{}"))),
          Exit.hasDies(yield* Effect.exit(store.get("k".repeat(1024)))),
        ]).toStrictEqual([true, true, false]);
      }).pipe(Effect.provide(layer))
  );
});

const folderAndReadme = Effect.gen(function* () {
  const { code } = yield* datekit;

  return yield* Effect.all([
    treeOf(code, Option.none(), Option.none()),
    fileOf(code, Option.none(), RepoPath.make("README.md")),
  ]);
});

describe("the code reads over the code store", () => {
  it.effect(
    "answer a folder and a file over R2 that is down as over a store that keeps nothing, and log it",
    () =>
      Effect.gen(function* () {
        const plain = yield* folderAndReadme.pipe(
          Effect.provide(RepoHostMemory)
        );

        const { exit, messages } = yield* logged(
          folderAndReadme.pipe(
            Effect.provide(
              Layer.merge(
                RepoHostMemory,
                CodeStoreR2(bucketOf({ get: true, put: true }))
              )
            )
          )
        );

        expect(exit).toStrictEqual(Exit.succeed(plain));
        expect(messages.length).toBeGreaterThan(0);
      })
  );

  it.effect("keep a folder's and a file's objects over R2 that is up", () =>
    Effect.gen(function* () {
      const objects = new Map<string, string>();
      const bucket = bucketOf({});

      const kept = {
        ...bucket,
        put: (name: string, value: string) => {
          objects.set(name, value);

          return bucket.put(name, value);
        },
      };

      yield* folderAndReadme.pipe(
        Effect.provide(Layer.merge(RepoHostMemory, CodeStoreR2(kept)))
      );

      expect(
        [...objects.keys()]
          .map((name) => name.split("/").at(1) ?? "")
          .toSorted((one, other) => one.localeCompare(other))
      ).toStrictEqual(["blob", "commit-object", "file", "tree"]);
    })
  );
});
