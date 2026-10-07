import { describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { AskInput } from "@repo/protocol/domain/policy";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Schema } from "effect";

import { defaultPolicyInput } from "../src/defaults.ts";
import { finishPolicy } from "../src/finish.ts";
import { at, facts, finishers } from "./world.ts";

/** The whole repo, as one module. */
const wholeRepo: (typeof AskInput.Encoded)["territory"] = {
  module: ".",
  paths: ["**"],
};

/** An ask with the given id, declared in `file`, in `territory`. */
const askIn = (
  id: string,
  file: string,
  territory: (typeof AskInput.Encoded)["territory"] = wholeRepo
) =>
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
    territory,
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

  // The sdk's `territory.package(name)` can't know the package's folder, so
  // it writes `{dir}`; the evaluator knows the workspaces.
  it.effect(
    "writes a package territory's folder and public files in from the workspaces",
    () =>
      Effect.gen(function* () {
        const policy = yield* finishPolicy({
          at,
          facts,
          finishers,
          policy: {
            ...defaultPolicyInput,
            asks: [
              askIn("parse", "a/parse.ask.ts", {
                module: "@datekit/parse",
                paths: ["{dir}/**"],
              }),
              askIn("format", "a/format.ask.ts", {
                module: "@datekit/format",
                paths: ["{dir}/src/**", "{dir}/test/**"],
              }),
              askIn("gone", "a/gone.ask.ts", {
                module: "@datekit/gone",
                paths: ["{dir}/**"],
              }),
            ],
          },
        });

        expect(policy.asks.map(({ territory }) => territory)).toStrictEqual([
          {
            module: "@datekit/parse",
            paths: ["packages/parse/**"],
            publicFiles: ["packages/parse/src/index.ts"],
          },
          {
            module: "@datekit/format",
            paths: ["packages/format/src/**", "packages/format/test/**"],
          },
          // A package no workspace names keeps the placeholder, which matches
          // no real path, so the gate refuses every change (fails closed).
          { module: "@datekit/gone", paths: ["{dir}/**"] },
        ]);
      })
  );
});
