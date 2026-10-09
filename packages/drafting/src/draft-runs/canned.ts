/**
 * The draft the worlds without a model give every proposal drafted in them
 * (the web's dev world, the platform's Node world): an ask for a reader of
 * ordinal dates in `src/parse.ts`, whose test fails on main by its
 * assertion wherever that file has none, in datekit and in smoke's
 * throwaway project alike. So `bun run dev` and `smoke --loop --draft`
 * show a draft end to end, offline.
 */
import { AskId, RepoPath } from "@repo/protocol/ids";
import { Array } from "effect";
import type { Layer } from "effect";

import type { DraftedAsk } from "../drafted.ts";
import type { Drafter } from "../drafter.ts";
import { DrafterMemory } from "../drafter/memory.ts";
import type { DraftsAsked } from "../drafter/memory.ts";

/** How many drafts a world gives before its drafter's script runs out. */
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

/** The memory drafter, scripted with the canned draft for every attempt a world makes. */
export const cannedDrafter: Layer.Layer<Drafter | DraftsAsked> = DrafterMemory(
  Array.replicate(cannedDraft, CANNED_DRAFTS)
);
