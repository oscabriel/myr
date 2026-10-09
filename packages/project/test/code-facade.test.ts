/**
 * The code façade both handler files call: a project's code read from its
 * canonical repo alone, with main resolved through the project's record.
 * Until 912 lands, why each line is there names the issue that builds it.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { ProjectApi } from "@repo/project/project";
import { LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Cause, Effect, Exit, Option } from "effect";

import { codeProjectOf, whyOf } from "../src/code.ts";
import { CodeCache } from "../src/code/cache.ts";

const project = ProjectName.make("datekit");

const landed = LandedSha.make("4".repeat(40));

const path = RepoPath.make("README.md");

/** A project's record, as the façade reads it: only these three. */
const api = untouchable<ProjectApi>("ProjectApi", {
  forks: () => Effect.succeed([]),
  head: () => Effect.succeed({ landed }),
  landings: () => Effect.succeed([]),
});

const code = codeProjectOf(api, project);

/** What a stub died with, as text; none when it did not die. */
const diedWith = <A, E>(effect: Effect.Effect<A, E, RepoHost>) =>
  Effect.map(
    Effect.exit(
      Effect.provideService(
        effect,
        RepoHost,
        untouchable<RepoHost["Service"]>("RepoHost")
      )
    ),
    (exit) =>
      Exit.isFailure(exit) && Cause.hasDies(exit.cause)
        ? Option.some(String(Cause.squash(exit.cause)))
        : Option.none()
  );

describe("a project's code, read through the façade", () => {
  it.effect(
    "reads the canonical repo, with main from the project's record",
    () =>
      Effect.gen(function* () {
        expect(code.repo).toBe(project);
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

  it.effect("names the issue that builds why each line is there", () =>
    Effect.gen(function* () {
      expect(yield* diedWith(whyOf(code, Option.none(), path))).toStrictEqual(
        Option.some("not built: 912")
      );
    })
  );
});
