import { describe, expect, it } from "@effect/vitest";
import { Glob } from "@repo/protocol/domain/common";
import { Effect, Result } from "effect";

import { countLint } from "../../src/kinds/lint-count.ts";
import {
  lintToZeroGreen,
  lintToZeroRed,
} from "../../src/kinds/lint-to-zero.ts";
import { recorded } from "./recorded.ts";

// The recordings `lint-count.test.ts` describes: oxlint over a fixture with
// `any` in `packages/parser` and `packages/lexer`, none in `packages/printer`.

const anysIn = (output: string, territory: string) =>
  Result.getOrThrow(
    countLint({
      output,
      rule: "typescript/no-explicit-any",
      territory: [Glob.make(territory)],
    })
  );

describe("a lintToZero check", () => {
  it.effect.each(["packages/parser/**", "packages/lexer/**"])(
    "is red while the rule reports anything in %s",
    (territory) =>
      Effect.gen(function* () {
        const count = anysIn(yield* recorded("oxlint"), territory);

        expect(lintToZeroRed(count)).toBeTruthy();
        expect(lintToZeroGreen(count)).toBeFalsy();
      })
  );

  it.effect("is green where the rule reports nothing in its territory", () =>
    Effect.gen(function* () {
      const count = anysIn(yield* recorded("oxlint"), "packages/printer/**");

      expect(lintToZeroGreen(count)).toBeTruthy();
      expect(lintToZeroRed(count)).toBeFalsy();
    })
  );

  it.effect("is green on a clean run", () =>
    Effect.gen(function* () {
      const count = anysIn(yield* recorded("oxlint-clean"), "packages/**");

      expect(lintToZeroGreen(count)).toBeTruthy();
      expect(lintToZeroRed(count)).toBeFalsy();
    })
  );

  it("is red at one finding", () => {
    const count = Result.getOrThrow(
      countLint({
        output:
          '{"diagnostics": [{"code": "eslint(no-debugger)", "filename": "src/a.ts"}]}',
      })
    );

    expect(lintToZeroRed(count)).toBeTruthy();
    expect(lintToZeroGreen(count)).toBeFalsy();
  });
});
