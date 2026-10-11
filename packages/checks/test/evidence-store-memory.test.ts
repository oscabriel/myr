import { describe, expect, it } from "@effect/vitest";
import { LaneName, ProjectName, RequestId } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { EvidenceStore, LogRef } from "../src/evidence-store.ts";
import {
  EvidenceKept,
  EvidenceStoreMemory,
} from "../src/evidence-store/memory.ts";

const unitLog = {
  attempt: 1,
  lane: LaneName.make("unit"),
  project: ProjectName.make("oscabriel/datekit"),
  requestId: RequestId.make("push-0123456789"),
  text: "FAIL test/parse.test.ts > parses ISO weeks\nexpected 52 to be 53",
};

describe("EvidenceStore in memory", () => {
  it.effect("names a lane's log by project, request, lane and attempt", () =>
    Effect.gen(function* () {
      const store = yield* EvidenceStore;

      const ref = yield* store.put(unitLog);

      expect(ref).toBe("datekit/push-0123456789/unit#1");
      expect(yield* store.get(ref)).toStrictEqual(Option.some(unitLog.text));
    }).pipe(Effect.provide(EvidenceStoreMemory))
  );

  it.effect(
    "overwrites a replayed attempt's log under the same name, never a second one",
    () =>
      Effect.gen(function* () {
        const store = yield* EvidenceStore;

        const first = yield* store.put(unitLog);
        const replayed = yield* store.put({ ...unitLog, text: "replayed" });
        const second = yield* store.put({ ...unitLog, attempt: 2 });

        expect([first, replayed, second]).toStrictEqual([
          "datekit/push-0123456789/unit#1",
          "datekit/push-0123456789/unit#1",
          "datekit/push-0123456789/unit#2",
        ]);
        expect(yield* store.get(first)).toStrictEqual(Option.some("replayed"));
        expect(yield* (yield* EvidenceKept).puts).toHaveLength(3);
      }).pipe(Effect.provide(EvidenceStoreMemory))
  );

  it.effect("has nothing under a name it never kept", () =>
    Effect.gen(function* () {
      const store = yield* EvidenceStore;

      expect(
        yield* store.get(LogRef.make("datekit/push-0123456789/lint#1"))
      ).toStrictEqual(Option.none());
    }).pipe(Effect.provide(EvidenceStoreMemory))
  );
});
