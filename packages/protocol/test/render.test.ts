import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";

import {
  OutOfScope,
  StaleBase,
  TouchedJudge,
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
});
