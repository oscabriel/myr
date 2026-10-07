import { describe, expect, it } from "@effect/vitest";
import { RepoPath } from "@repo/protocol/ids";
import { NotClaimed, OutOfScope, TouchedJudge } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Effect, Option } from "effect";

import { pushStages, runGate } from "../src/gate.ts";
import type { Stage } from "../src/stage.ts";
import { ask, modified, testFacts, wire } from "./facts.ts";

/** What the gate answered, as it crosses the wire; `None` stays `None`. */
const wired = (answer: Option.Option<readonly Refusal[]>) =>
  Option.map(answer, wire);

/** A stage that answers every push with `refusals`. */
const always = (
  accumulate: boolean,
  refusals: readonly Refusal[]
): Stage<never> => ({
  accumulate,
  name: "cheap",
  run: () => Effect.succeed(refusals),
});

const outside = new OutOfScope({ paths: [RepoPath.make("docs/guide.md")] });

const judged = new TouchedJudge({
  paths: [RepoPath.make(".github/workflows/ci.yml")],
});

describe(runGate, () => {
  it.effect("stops after parse when parse refuses, so shape is not heard", () =>
    Effect.gen(function* () {
      const answer = yield* runGate(
        pushStages,
        testFacts({
          changes: modified("docs/guide.md"),
          claim: Option.none(),
        })
      );

      expect(wired(answer)).toStrictEqual(
        Option.some(wire([NotClaimed.of(ask.id)]))
      );
    })
  );

  it.effect(
    "returns every shape refusal when parse lets the push through",
    () =>
      Effect.gen(function* () {
        const answer = yield* runGate(
          pushStages,
          testFacts({
            changes: modified("docs/guide.md", ".github/workflows/ci.yml"),
          })
        );

        expect(wired(answer)).toStrictEqual(
          Option.some(wire([outside, judged]))
        );
      })
  );

  it.effect("returns None when every stage lets the push through", () =>
    Effect.gen(function* () {
      const answer = yield* runGate(pushStages, testFacts());

      expect(answer).toStrictEqual(Option.none());
    })
  );

  it.effect("stops a stage that does not accumulate at its first refusal", () =>
    Effect.gen(function* () {
      const answer = yield* runGate(
        [always(false, [outside, judged]), always(true, [judged])],
        testFacts()
      );

      expect(wired(answer)).toStrictEqual(Option.some(wire([outside])));
    })
  );

  it.effect("keeps every refusal of a stage that accumulates", () =>
    Effect.gen(function* () {
      const answer = yield* runGate(
        [always(true, []), always(true, [outside, judged])],
        testFacts()
      );

      expect(wired(answer)).toStrictEqual(Option.some(wire([outside, judged])));
    })
  );
});
