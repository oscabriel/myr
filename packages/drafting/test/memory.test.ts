import { describe, expect, it } from "@effect/vitest";
import { AskId, LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Effect } from "effect";

import { DraftFailed } from "../src/drafted.ts";
import type { DraftedAsk, DraftInput } from "../src/drafted.ts";
import { Drafter } from "../src/drafter.ts";
import { DrafterMemory, DraftsAsked } from "../src/drafter/memory.ts";

const drafted: DraftedAsk = {
  id: AskId.make("iso-week"),
  kind: "fix",
  rationale: "The parser has no week dates.",
  territory: [RepoPath.make("src/parse.ts")],
  test: {
    path: RepoPath.make("test/iso-week.test.ts"),
    source: 'it("parses", () => expect(parse("2026-W01")).toBe(1));\n',
  },
  want: "An ISO week date parses to the Monday of that week.",
};

const input = (attempt: number): DraftInput => ({
  attempt,
  context: {
    at: LandedSha.make("4".repeat(40)),
    files: [],
    policy: "kinds: fix",
    project: ProjectName.make("datekit"),
  },
  want: "Parse ISO week dates.",
});

describe("the memory drafter", () => {
  it.effect(
    "answers its script in order, failures too, and keeps every input",
    () =>
      Effect.gen(function* () {
        const drafter = yield* Drafter;
        const failed = new DraftFailed({ reason: "schema" });

        const first = yield* Effect.flip(drafter.draft(input(1)));
        const second = yield* drafter.draft(input(2));

        expect(first).toStrictEqual(failed);
        expect(second).toStrictEqual(drafted);
        expect(
          (yield* DraftsAsked.use(({ inputs }) => inputs)).map(
            ({ attempt }) => attempt
          )
        ).toStrictEqual([1, 2]);
      }).pipe(
        Effect.provide(
          DrafterMemory([new DraftFailed({ reason: "schema" }), drafted])
        )
      )
  );
});
