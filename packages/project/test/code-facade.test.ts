import { describe, expect, it } from "@effect/vitest";
import type { ProjectApi } from "@repo/project/project";
import { keyOf, LandedSha, ProjectName } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Option } from "effect";

import { codeProjectOf } from "../src/code.ts";
import { CodeCache } from "../src/code/cache.ts";

const project = ProjectName.make("alice/datekit");

const landed = LandedSha.make("4".repeat(40));

const api = untouchable<ProjectApi>("ProjectApi", {
  forks: () => Effect.succeed([]),
  head: () => Effect.succeed({ landed }),
  landings: () => Effect.succeed([]),
});

const code = codeProjectOf(api, project);

describe("a project's code, read through the façade", () => {
  it.effect(
    "reads the canonical repo, with main from the project's record",
    () =>
      Effect.gen(function* () {
        expect(code.repo).toBe(keyOf(project));
        expect(yield* code.head).toStrictEqual(Option.some(landed));
        expect(yield* code.forks).toStrictEqual([]);
      })
  );

  it.effect("caches nothing until a cache is given", () =>
    Effect.gen(function* () {
      const cache = yield* CodeCache;
      let reads = 0;

      const read = Effect.sync(() => {
        reads += 1;

        return reads;
      });

      expect(yield* cache.through("datekit:tree:x", read)).toBe(1);
      expect(yield* cache.through("datekit:tree:x", read)).toBe(2);
    })
  );
});
