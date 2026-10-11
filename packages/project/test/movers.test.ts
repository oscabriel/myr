/**
 * Who moved the paths a merge conflicts in, over the memory repo host: for
 * each path, the newest commit on main since the answer's base that changed
 * it, named by its landing in the project's record. A change at or before
 * the base is never named, nor a commit the record holds no landing for,
 * and a repo the walk cannot read names nobody.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import type { LandingView } from "@repo/protocol/domain/landing";
import {
  AskId,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { DateTime, Effect, Ref } from "effect";

import { movedBy } from "../src/answer-runs/movers.ts";
import { Content, writer } from "./code-fixtures.ts";
import type { Tree } from "./code-fixtures.ts";

const project = ProjectName.make("oscabriel/movekit");

const repo = RepoName.make(project);

const pathOf = (name: string) => RepoPath.make(`src/${name}.ts`);

const [a, b, c, d, e] = [
  pathOf("a"),
  pathOf("b"),
  pathOf("c"),
  pathOf("d"),
  pathOf("e"),
] as const;

const alice = Handle.make("alice");

const dora = Handle.make("dora");

/** A version of each of the five files, in order. */
type Versions = readonly [number, number, number, number, number];

/** The five files, each holding the version `versions` gives it. */
const files = (versions: Versions): Tree =>
  [a, b, c, d, e].map((path, at) => [
    path,
    Content.Text({ text: `export const v = ${versions[at] ?? 0};\n` }),
  ]);

const landingOf = (
  sha: CommitSha,
  author: Handle,
  ask: Partial<Pick<LandingView, "ask" | "opened">>
): LandingView => ({
  ...ask,
  assisted: [],
  author,
  credits: [],
  landedAt: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
  project,
  sha: LandedSha.make(sha),
});

/**
 * Main's history: `c` changes at the base itself; since then a landing
 * that answered an ask changes `a` twice, a decider's own landing `d`, an
 * opening `e`, and a commit the record holds no landing for changes `b`.
 */
const history = Effect.gen(function* () {
  const { commit, push } = yield* writer;

  // Each commit on the one before, `at` seconds after the first.
  const on = (
    parent: CommitSha,
    message: string,
    versions: Versions,
    at: number
  ) => commit(message, files(versions), [parent], at);

  const root = yield* commit("Start", files([0, 0, 0, 0, 0]), [], 0);
  const base = yield* on(root, "Change c", [0, 0, 1, 0, 0], 1);
  const fixA = yield* on(base, "Fix a", [1, 0, 1, 0, 0], 2);
  const own = yield* on(fixA, "Change d", [1, 0, 1, 1, 0], 3);
  const stray = yield* on(own, "Change b", [1, 1, 1, 1, 0], 4);
  const opening = yield* on(stray, "Open add-e", [1, 1, 1, 1, 1], 5);
  const fixAgain = yield* on(opening, "Fix a again", [2, 1, 1, 1, 1], 6);

  yield* push(repo, [["refs/heads/main", fixAgain]]);

  const record = [
    landingOf(fixA, alice, { ask: AskId.make("fix-a") }),
    landingOf(own, dora, {}),
    landingOf(opening, dora, { opened: AskId.make("add-e") }),
    landingOf(fixAgain, alice, { ask: AskId.make("fix-a-again") }),
  ];

  return { base, fixAgain, opening, own, record };
});

describe(movedBy, () => {
  it.effect(
    "names the newest landing since the base that changed each path, and no one else",
    () =>
      Effect.gen(function* () {
        const { base, fixAgain, opening, own, record } = yield* history;
        const asked = yield* Ref.make<readonly CommitSha[]>([]);

        const moved = yield* movedBy(
          {
            base,
            conflicts: [a, b, c, d, e],
            main: LandedSha.make(fixAgain),
            repo,
          },
          (shas) =>
            Effect.as(
              Ref.update(asked, (all) => [...all, ...shas]),
              record.filter(({ sha }) => shas.includes(sha))
            )
        );

        expect(moved).toStrictEqual([
          {
            ask: AskId.make("fix-a-again"),
            author: alice,
            landing: LandedSha.make(fixAgain),
            path: a,
          },
          { author: dora, landing: LandedSha.make(own), path: d },
          {
            ask: AskId.make("add-e"),
            author: dora,
            landing: LandedSha.make(opening),
            path: e,
          },
        ]);
        // The base changed c, so nothing at or before it is asked about.
        expect(yield* Ref.get(asked)).not.toContain(base);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("names nobody when the repo cannot be read", () =>
    Effect.gen(function* () {
      const { base, fixAgain, record } = yield* history;

      const moved = yield* movedBy(
        {
          base,
          conflicts: [a],
          main: LandedSha.make(fixAgain),
          repo: RepoName.make("no-such-repo"),
        },
        () => Effect.succeed(record)
      );

      expect(moved).toStrictEqual([]);
    }).pipe(Effect.provide(RepoHostMemory))
  );
});
