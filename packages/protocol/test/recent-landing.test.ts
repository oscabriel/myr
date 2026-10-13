import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { ShownRefusal, shownRefusal } from "../src/domain/recent-landing.ts";
import { RepoPath } from "../src/ids.ts";
import {
  ChecksFailed,
  HeldBackFailed,
  OutOfScope,
  SecretInOutput,
} from "../src/refusal.ts";
import type { Refusal } from "../src/refusal.ts";
import { examples } from "./examples.ts";

describe(shownRefusal, () => {
  it("shows a held-back check's area and never its suite", () => {
    expect(
      shownRefusal(new HeldBackFailed({ area: "parser", suite: "edge-cases" }))
    ).toStrictEqual({ area: "parser", tag: "HeldBackFailed" });
  });

  it("shows a failed lane, a path or a secret's name by its tag alone", () => {
    expect([
      shownRefusal(
        new ChecksFailed({ lane: "unit", logRef: "logs/7", next: "bun test" })
      ),
      shownRefusal(new OutOfScope({ paths: [RepoPath.make("src/secret.ts")] })),
      shownRefusal(
        new SecretInOutput({ item: "PAYMENTS_KEY", where: "output" })
      ),
    ]).toStrictEqual([
      { tag: "ChecksFailed" },
      { tag: "OutOfScope" },
      { tag: "SecretInOutput" },
    ]);
  });

  it("shows every refusal of the union as no more than a tag and an area", () => {
    const fields = new Set(
      examples.flatMap((refusal: Refusal) => Object.keys(shownRefusal(refusal)))
    );

    expect(fields).toStrictEqual(new Set(["area", "tag"]));
  });

  it("refuses a tag the union does not have", () => {
    expect(
      Schema.decodeUnknownOption(ShownRefusal)({ tag: "SomethingElse" })._tag
    ).toBe("None");
  });
});
