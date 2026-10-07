import { describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { AskInput } from "@repo/protocol/domain/policy";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Schema } from "effect";

import { defaultPolicyInput } from "../src/defaults.ts";
import { finishPolicy } from "../src/finish.ts";
import { at, facts, finishers } from "./world.ts";

/** An ask with the given id, declared in `file`. */
const askIn = (id: string, file: string) =>
  Schema.decodeSync(AskInput)({
    askedBy: "olivia",
    blockedBy: [],
    brief: { want: "Parse dates" },
    check: CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make("test/dates.test.ts"),
    }),
    file,
    id,
    kind: "fix",
    territory: { module: ".", paths: ["**"] },
  });

describe(finishPolicy, () => {
  it.effect("refuses a vouch file line that names no handle, by its line", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        finishPolicy({
          at,
          facts: { ...facts, vouchFile: "priya\n@bob\n" },
          finishers,
          policy: defaultPolicyInput,
        })
      );

      expect(failure.reason).toBe("decode");
      expect(failure.detail).toContain('line 2 ("@bob")');
    })
  );

  it.effect("refuses two asks that share an id", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        finishPolicy({
          at,
          facts,
          finishers,
          policy: {
            ...defaultPolicyInput,
            asks: [
              askIn("dates", "a/dates.ask.ts"),
              askIn("dates", "b/dates.ask.ts"),
            ],
          },
        })
      );

      expect(failure.reason).toBe("decode");
      expect(failure.detail).toContain("a/dates.ask.ts");
    })
  );
});
