import { AskId, RepoPath } from "@repo/protocol/ids";
import { Array } from "effect";
import type { Layer } from "effect";

import type { DraftedAsk } from "../drafted.ts";
import type { Drafter } from "../drafter.ts";
import { DrafterMemory } from "../drafter/memory.ts";
import type { DraftsAsked } from "../drafter/memory.ts";

const CANNED_DRAFTS = 64;

export const cannedDraft = {
  current: "src/parse.ts reads no ordinal date.",
  id: AskId.make("parse-ordinal"),
  kind: "fix",
  rationale:
    "src/parse.ts exports no parseOrdinal, so the test fails by its assertion on main.",
  territory: [RepoPath.make("src/parse.ts")],
  test: {
    path: RepoPath.make("test/asks/parse-ordinal.test.ts"),
    source: [
      'import { expect, test } from "bun:test";',
      "",
      'import * as parsing from "../../src/parse.ts";',
      "",
      'test("parse.ts exports parseOrdinal, for dates such as 2026-280", () => {',
      '  expect(typeof Reflect.get(parsing, "parseOrdinal")).toBe("function");',
      "});",
      "",
    ].join("\n"),
  },
  want: "src/parse.ts exports parseOrdinal, which reads an ordinal date such as 2026-280.",
} satisfies DraftedAsk;

export const cannedDrafter: Layer.Layer<Drafter | DraftsAsked> = DrafterMemory(
  Array.replicate(cannedDraft, CANNED_DRAFTS)
);
