import { describe, expect, it } from "@effect/vitest";
import { LaneName, ProjectName, RequestId } from "@repo/protocol/ids";
import type { Layer } from "effect";
import { Cause, Effect, Exit, Option } from "effect";

import { EvidenceStore, LogRef } from "../src/evidence-store.ts";
import { EvidenceStoreR2 } from "../src/evidence-store/r2.ts";
import type { EvidenceBucket } from "../src/evidence-store/r2.ts";

/** One object as the fake bucket keeps it: its body and the options it was put with. */
interface Kept {
  readonly text: string;
  readonly options: Parameters<EvidenceBucket["put"]>[2];
}

/**
 * An R2 bucket in memory, in the shape the Worker's `EVIDENCE` binding has:
 * `put` keeps a body under its key, replacing any there, and `get` answers
 * the body or `null`.
 */
const fakeBucket = () => {
  const objects = new Map<string, Kept>();

  const bucket: EvidenceBucket = {
    get: (key) => {
      const kept = objects.get(key);

      return Promise.resolve(
        kept === undefined ? null : { text: () => Promise.resolve(kept.text) }
      );
    },
    put: (key, text, options) => {
      objects.set(key, { options, text });

      return Promise.resolve({ key });
    },
  };

  return { bucket, objects };
};

/** A bucket whose every call fails, as R2 does when it cannot be reached. */
const brokenBucket: EvidenceBucket = {
  get: () => Promise.reject(new Error("R2 is unreachable")),
  put: () => Promise.reject(new Error("R2 is unreachable")),
};

const unitLog = {
  attempt: 1,
  lane: LaneName.make("unit"),
  project: ProjectName.make("oscabriel/datekit"),
  requestId: RequestId.make("push-0123456789"),
  text: "FAIL test/parse.test.ts > parses ISO weeks\nexpected 52 to be 53",
};

const key = "datekit/push-0123456789/unit#1";

/** How a call ended, as its defect prints. */
const printed = <A>(call: Effect.Effect<A>) =>
  Effect.map(Effect.exit(call), (exit) =>
    Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "it succeeded"
  );

/** The store over `bucket`, as the Worker composes it. */
const over = (bucket: EvidenceBucket) =>
  Effect.provide(EvidenceStoreR2(bucket) satisfies Layer.Layer<EvidenceStore>);

describe("EvidenceStore over an R2 bucket", () => {
  it.effect(
    "keeps a lane's log under its project, request, lane and attempt, as plain text",
    () => {
      const { bucket, objects } = fakeBucket();

      return Effect.gen(function* () {
        const store = yield* EvidenceStore;
        const ref = yield* store.put(unitLog);

        expect({
          got: yield* store.get(ref),
          kept: [...objects].map(([name, { options, text }]) => ({
            contentType: options.httpMetadata.contentType,
            name,
            text,
          })),
          ref,
        }).toStrictEqual({
          got: Option.some(unitLog.text),
          kept: [
            {
              contentType: "text/plain; charset=utf-8",
              name: key,
              text: unitLog.text,
            },
          ],
          ref: key,
        });
      }).pipe(over(bucket));
    }
  );

  it.effect(
    "overwrites a replayed attempt's log under the same key, never a second object",
    () => {
      const { bucket, objects } = fakeBucket();

      return Effect.gen(function* () {
        const store = yield* EvidenceStore;
        const first = yield* store.put(unitLog);
        const replayed = yield* store.put({ ...unitLog, text: "replayed" });

        expect({
          got: yield* store.get(first),
          keys: [...objects.keys()],
          refs: [first, replayed],
        }).toStrictEqual({
          got: Option.some("replayed"),
          keys: [key],
          refs: [key, key],
        });
      }).pipe(over(bucket));
    }
  );

  it.effect("keeps a log over 1 MiB whole, and gives it back whole", () => {
    const { bucket } = fakeBucket();
    const long = `${"x".repeat(1024 * 1024)}\nexpected 52 to be 53`;

    return Effect.gen(function* () {
      const store = yield* EvidenceStore;
      const ref = yield* store.put({ ...unitLog, text: long });

      expect(yield* store.get(ref)).toStrictEqual(Option.some(long));
    }).pipe(over(bucket));
  });

  it.effect("has nothing under a key it never kept", () =>
    Effect.gen(function* () {
      const store = yield* EvidenceStore;

      expect(
        yield* store.get(LogRef.make("datekit/push-0123456789/lint#1"))
      ).toStrictEqual(Option.none());
    }).pipe(over(fakeBucket().bucket))
  );

  it.effect(
    "labels each object with its project and lane, and nothing else",
    () => {
      const { bucket, objects } = fakeBucket();

      return Effect.gen(function* () {
        yield* (yield* EvidenceStore).put(unitLog);

        expect(objects.get(key)?.options.customMetadata).toStrictEqual({
          lane: "unit",
          project: "oscabriel/datekit",
        });
      }).pipe(over(bucket));
    }
  );

  it.effect(
    "dies naming the key, never the log, when the bucket cannot be reached",
    () =>
      Effect.gen(function* () {
        const store = yield* EvidenceStore;

        const deaths = [
          yield* printed(store.put(unitLog)),
          yield* printed(store.get(LogRef.make(key))),
        ];

        expect(deaths.map((death) => death.includes(key))).toStrictEqual([
          true,
          true,
        ]);
        expect(
          deaths.some((death) => death.includes("expected 52"))
        ).toBeFalsy();
      }).pipe(over(brokenBucket))
  );
});
