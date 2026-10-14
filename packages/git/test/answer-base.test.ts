import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost, RepoName } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CommitSha, LandedSha } from "@repo/protocol/ids";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { Effect, Option } from "effect";

import { answerBase } from "../src/answer-base.ts";

const canonical = RepoName.make("datekit");

const fork = RepoName.make("datekit--parse-iso--alice");

const main = RefName.make("refs/heads/main");

const start: Files = [
  ["packages/a/src/a.ts", "export const a = 1;\n"],
  ["packages/b/src/b.ts", "export const b = 1;\n"],
];

const bMoved: Files = [
  ["packages/a/src/a.ts", "export const a = 1;\n"],
  ["packages/b/src/b.ts", "export const b = 2;\n"],
];

const aMoved: Files = [
  ["packages/a/src/a.ts", "export const a = 2;\n"],
  ["packages/b/src/b.ts", "export const b = 1;\n"],
];

const bothMoved: Files = [
  ["packages/a/src/a.ts", "export const a = 2;\n"],
  ["packages/b/src/b.ts", "export const b = 2;\n"],
];

/**
 * main₀ is the claim's base; a sibling lands main₁, touching `packages/b`;
 * the answer's own commit changes `packages/a` on main₀.
 */
const history = Effect.gen(function* () {
  const repos = yield* RepoHost;
  const client = yield* gitClient(memoryFs());
  const main0 = yield* client.commit("start", start);
  const main1 = yield* client.commit("b lands", bMoved, [main0]);
  const own = yield* client.commit("a moves", aMoved, [main0]);

  yield* repos.create(canonical);
  yield* repos.create(fork);

  const push = (repo: RepoName, to: CommitSha) =>
    repos.push(repo, client.source, [{ from: Option.none(), ref: main, to }]);

  yield* push(canonical, main1);

  const chosen = (input: {
    readonly base: CommitSha;
    readonly head: CommitSha;
    readonly landed: CommitSha;
  }) =>
    push(fork, input.head).pipe(
      Effect.andThen(
        answerBase({
          base: input.base,
          canonical,
          head: input.head,
          landed: LandedSha.make(input.landed),
          repo: fork,
        })
      )
    );

  return { chosen, client, main0, main1, own };
});

describe("the base an answer is judged from", () => {
  it.effect("is the claim's base while the answer stays on it", () =>
    Effect.gen(function* () {
      const { chosen, main0, main1, own } = yield* history;

      expect(yield* chosen({ base: main0, head: own, landed: main1 })).toBe(
        main0
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("is the moved main once the answer merges it", () =>
    Effect.gen(function* () {
      const { chosen, client, main0, main1, own } = yield* history;

      const merged = yield* client.commit("merge main", bothMoved, [
        own,
        main1,
      ]);

      expect(yield* chosen({ base: main0, head: merged, landed: main1 })).toBe(
        main1
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("is the moved main once the answer is rebased onto it", () =>
    Effect.gen(function* () {
      const { chosen, client, main0, main1 } = yield* history;
      const rebased = yield* client.commit("a moves", bothMoved, [main1]);

      expect(yield* chosen({ base: main0, head: rebased, landed: main1 })).toBe(
        main1
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "is the newest landing the head contains, not main's tip, when main moved on again",
    () =>
      Effect.gen(function* () {
        const { chosen, client, main0, main1, own } = yield* history;
        const repos = yield* RepoHost;
        const main2 = yield* client.commit("b lands again", bMoved, [main1]);

        yield* repos.push(canonical, client.source, [
          { from: Option.some(main1), ref: main, to: main2 },
        ]);

        const merged = yield* client.commit("merge main", bothMoved, [
          own,
          main1,
        ]);

        expect(
          yield* chosen({ base: main0, head: merged, landed: main2 })
        ).toBe(main1);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("reads nothing while main has not moved since the claim", () =>
    Effect.gen(function* () {
      const { chosen, main0, own } = yield* history;

      expect(yield* chosen({ base: main0, head: own, landed: main0 })).toBe(
        main0
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "keeps the claim's base when main's history does not reach it, or the head shares nothing with main",
    () =>
      Effect.gen(function* () {
        const { chosen, client, main0, main1, own } = yield* history;
        const elsewhere = CommitSha.make("9".repeat(40));
        const orphan = yield* client.commit("unrelated", aMoved);

        expect(
          yield* chosen({ base: elsewhere, head: own, landed: main1 })
        ).toBe(elsewhere);
        expect(
          yield* chosen({ base: main0, head: orphan, landed: main1 })
        ).toBe(main0);
      }).pipe(Effect.provide(RepoHostMemory))
  );
});
