/**
 * The code façade both handler files call: a project's code read from its
 * canonical repo alone, with main resolved through the project's record.
 * Until 903 and 912 land, each read names the issue that builds it.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { ProjectApi } from "@repo/project/project";
import {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Cause, Effect, Exit, Option } from "effect";

import {
  codeProjectOf,
  commitOf,
  fileOf,
  logOf,
  pathsOf,
  refsOf,
  treeOf,
  whyOf,
} from "../src/code.ts";
import { CodeCache } from "../src/code/cache.ts";

const project = ProjectName.make("datekit");

const landed = LandedSha.make("4".repeat(40));

const sha = CommitSha.make("4".repeat(40));

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

  it.effect("names the issue that builds each read", () =>
    Effect.gen(function* () {
      const none = Option.none();

      expect(
        yield* Effect.all([
          diedWith(refsOf(code)),
          diedWith(treeOf(code, none, none)),
          diedWith(pathsOf(code, none)),
          diedWith(fileOf(code, none, path)),
          diedWith(logOf(code, { at: none, from: 0, limit: 30, path: none })),
          diedWith(commitOf(code, sha)),
          diedWith(whyOf(code, none, path)),
        ])
      ).toStrictEqual([
        ...Array.from({ length: 6 }, () => Option.some("not built: 903")),
        Option.some("not built: 912"),
      ]);
    })
  );
});
