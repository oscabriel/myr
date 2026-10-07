import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";

import { EnvKey } from "../src/ids.ts";
import {
  DirectPush,
  OutOfScope,
  StaleBase,
  TouchedJudge,
  ValueTooShort,
  Weakened,
} from "../src/refusal.ts";
import { explain, headline } from "../src/render.ts";
import { base, examples, main, path } from "./examples.ts";

const outOfScope = new OutOfScope({ paths: [path] });

const touchedJudge = new TouchedJudge({ paths: [path] });

describe(headline, () => {
  it("names the refusal for git's ng line", () => {
    expect(headline([new StaleBase({ base, conflicts: [], main })])).toBe(
      "StaleBase"
    );
  });

  it("names the first refusal and counts the rest", () => {
    expect(headline([outOfScope, touchedJudge, outOfScope])).toBe(
      "OutOfScope and 2 more"
    );
  });
});

describe(explain, () => {
  it("gives the reason, then next, then whether retrying can help", () => {
    expect(
      explain([new StaleBase({ base, conflicts: [path], main })])
    ).toStrictEqual([
      "StaleBase: main moved to 2222222, past your base 1111111; conflicts in src/a.ts",
      "  next: git pull --rebase",
      "  retryable: yes",
    ]);
  });

  it("points at the line when the refusal has one", () => {
    expect(
      explain([
        new Weakened({
          at: { line: 3, path },
          weakening: { marker: "it.skip" },
        }),
      ])
    ).toStrictEqual([
      "Weakened: adds it.skip without a reason",
      "  at: src/a.ts:3",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
    ]);
  });

  it("lists every refusal, in order", () => {
    expect(
      explain([outOfScope, touchedJudge]).filter(
        (line) => !line.startsWith(" ")
      )
    ).toStrictEqual([
      "OutOfScope: changes paths outside the ask's territory: src/a.ts",
      "TouchedJudge: changes files that decide what the checks do: src/a.ts",
    ]);
  });

  it.each(examples)("explains $_tag, opening with its tag", (refusal) => {
    expect(explain([refusal])[0]).toMatch(
      new RegExp(`^${refusal._tag}: \\S`, "u")
    );
  });

  it.each(examples)(
    "explains $_tag with every field it names filled in",
    (refusal) => {
      expect(explain([refusal]).join("\n")).not.toMatch(
        /undefined|null|\[object Object\]/u
      );
    }
  );

  it("tells a direct push to main where answers go instead", () => {
    expect(explain([new DirectPush({ ref: "refs/heads/main" })])).toStrictEqual(
      [
        "DirectPush: main moves only by a landing, so refs/heads/main takes no direct push; push your answer to your claim's fork",
        `  next: ${Brand.cli} asks`,
        "  retryable: no",
      ]
    );
  });

  // The refusal never holds the value, so no reader learns it, or its length,
  // from the reason.
  it("says a value is too short by the minimum alone", () => {
    expect(
      explain([ValueTooShort.of(EnvKey.make("PAYMENTS_KEY"), 32)])
    ).toStrictEqual([
      "ValueTooShort: the value for PAYMENTS_KEY is shorter than the 32 characters it needs",
      `  next: ${Brand.cli} env set PAYMENTS_KEY --acknowledge-short`,
      "  retryable: no",
    ]);
  });
});
