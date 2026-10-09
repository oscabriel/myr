/**
 * Why each line of a file is there, read from the canonical repo over the
 * memory repo host with a fixed project record: an adoption, a commit that
 * leaves the file alone, then two landings that each add a line to
 * `src/format.ts`. Each line points at the commit that brought it, every
 * such commit comes back as a reader sees it, the landings among them come
 * from the record, and the whole view is kept by `(at, path)`.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
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
import { UnknownPath } from "@repo/protocol/refusal";
import { DateTime, Effect, Exit, Layer, Option, Ref } from "effect";

import { whyOf } from "../src/code.ts";
import type { CodeProject } from "../src/code.ts";
import { CodeCacheLive } from "../src/code/cache.ts";
import { whyView } from "../src/code/why.ts";
import {
  Content,
  growingHistory,
  longHistory,
  png,
  overlappingTrees,
  writer,
} from "./code-fixtures.ts";

const project = ProjectName.make("datekit");

const repo = RepoName.make(project);

const format = RepoPath.make("src/format.ts");

const main = Option.none();

const text = (value: string) => Content.Text({ text: value });

const landingOf = (
  sha: CommitSha,
  ask: Option.Option<string>,
  parent: Option.Option<CommitSha>
): LandingView => ({
  assisted: [],
  author: Handle.make("bob"),
  credits: [],
  landedAt: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
  project,
  sha: LandedSha.make(sha),
  ...Option.match(ask, {
    onNone: () => ({}),
    onSome: (id) => ({ ask: AskId.make(id) }),
  }),
  ...Option.match(parent, {
    onNone: () => ({}),
    onSome: (at) => ({ parent: LandedSha.make(at) }),
  }),
});

/**
 * datekit: the adoption brings `src/format.ts` (two lines) and a binary
 * logo; a commit then changes only the README; `format-iso` inserts a line
 * between the two; `format-week` appends one.
 */
const history = Effect.gen(function* () {
  const git = yield* writer;

  const adopted = yield* git.commit(
    "Adopt datekit",
    [
      ["README.md", text("# datekit\n")],
      ["logo.png", Content.Bytes({ bytes: png })],
      ["src/format.ts", text("export const a = 1;\nexport const b = 2;\n")],
    ],
    [],
    1
  );

  const readme = yield* git.commit(
    "Tidy the readme",
    [
      ["README.md", text("# datekit, tidied\n")],
      ["logo.png", Content.Bytes({ bytes: png })],
      ["src/format.ts", text("export const a = 1;\nexport const b = 2;\n")],
    ],
    [adopted],
    2
  );

  const iso = yield* git.commit(
    "Land format-iso",
    [
      ["README.md", text("# datekit, tidied\n")],
      ["logo.png", Content.Bytes({ bytes: png })],
      [
        "src/format.ts",
        text(
          "export const a = 1;\nexport const iso = 3;\nexport const b = 2;\n"
        ),
      ],
    ],
    [readme],
    3
  );

  const week = yield* git.commit(
    "Land format-week",
    [
      ["README.md", text("# datekit, tidied\n")],
      ["logo.png", Content.Bytes({ bytes: png })],
      [
        "src/format.ts",
        text(
          "export const a = 1;\nexport const iso = 3;\nexport const b = 2;\nexport const week = 4;\n"
        ),
      ],
    ],
    [iso],
    4
  );

  yield* git.push(repo, [["refs/heads/main", week]]);

  const landings = [
    landingOf(adopted, Option.none(), Option.none()),
    landingOf(iso, Option.some("format-iso"), Option.some(readme)),
    landingOf(week, Option.some("format-week"), Option.some(iso)),
  ];

  const asked = yield* Ref.make<readonly (readonly CommitSha[])[]>([]);

  const code: CodeProject = {
    forks: Effect.succeed([]),
    head: Effect.succeedSome(LandedSha.make(week)),
    landings: (shas) =>
      Ref.update(asked, (all) => [...all, shas]).pipe(
        Effect.as(
          shas.flatMap((sha) =>
            landings.filter((landing) => landing.sha === sha)
          )
        )
      ),
    project,
    repo,
  };

  return { adopted, asked, code, iso, landings, readme, week };
});

/** The memory store, with each blob `readBlob` is asked for counted in `reads`. */
const countedBy = (reads: Ref.Ref<readonly string[]>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        readBlob: (name, blob) =>
          Ref.update(reads, (all) => [...all, blob]).pipe(
            Effect.andThen(host.readBlob(name, blob))
          ),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

describe("why each line is there", () => {
  it.effect(
    "points each landing's lines at its landing, and the adopted lines at the adoption",
    () =>
      Effect.gen(function* () {
        const { adopted, code, iso, week } = yield* history;
        const view = yield* whyOf(code, main, format);

        expect([view.at, view.path, view.stoppedAt]).toStrictEqual([
          week,
          format,
          undefined,
        ]);
        expect(view.ranges).toStrictEqual([
          { end: 1, sha: adopted, start: 1 },
          { end: 2, sha: iso, start: 2 },
          { end: 3, sha: adopted, start: 3 },
          { end: 4, sha: week, start: 4 },
        ]);
        expect(
          view.commits.map(({ landing, sha, subject }) => [
            sha,
            subject,
            landing,
          ])
        ).toStrictEqual([
          [week, "Land format-week", undefined],
          [iso, "Land format-iso", undefined],
          [adopted, "Adopt datekit", undefined],
        ]);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "returns the landings among those commits, with their asks, from one batch of the record",
    () =>
      Effect.gen(function* () {
        const { adopted, asked, code, iso, landings, week } = yield* history;
        const view = yield* whyOf(code, main, format);

        expect(view.landings.map(({ ask, sha }) => [sha, ask])).toStrictEqual([
          [week, "format-week"],
          [iso, "format-iso"],
          [adopted, undefined],
        ]);
        expect(view.landings).toStrictEqual(landings.toReversed());
        expect(yield* Ref.get(asked)).toHaveLength(1);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "stops at the cap, giving the lines it did not reach to the commit it stopped at",
    () =>
      Effect.gen(function* () {
        const { code, week } = yield* history;
        const view = yield* whyView(code, main, format, 1);

        expect(view.stoppedAt).toBe(week);
        expect(view.ranges).toStrictEqual([{ end: 4, sha: week, start: 1 }]);
        expect(view.commits.map(({ sha }) => sha)).toStrictEqual([week]);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "reads no blob the second time: the view is kept by (at, path)",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly string[]>([]);

        yield* Effect.gen(function* () {
          const { code, iso } = yield* history;
          const first = yield* whyOf(code, Option.some(iso), format);
          const counted = (yield* Ref.get(reads)).length;

          expect(counted).toBe(2);

          const again = yield* whyOf(code, Option.some(iso), format);

          expect(again).toStrictEqual(first);
          expect(yield* Ref.get(reads)).toHaveLength(counted);
        }).pipe(
          Effect.provide(Layer.merge(countedBy(reads), CodeCacheLive(100)))
        );
      })
  );

  it.live(
    "reads the file's blob in each commit several at a time, not one after another",
    () =>
      Effect.gen(function* () {
        const reading = yield* Ref.make(false);
        const peak = yield* Ref.make(0);

        yield* Effect.gen(function* () {
          const { code, shas } = yield* longHistory(64);

          yield* Ref.set(reading, true);

          // `once.txt` never changes, so the walk reads its blob in all 64
          // commits.
          const { ranges } = yield* whyView(
            code,
            main,
            RepoPath.make("once.txt")
          );

          expect(ranges).toStrictEqual([{ end: 1, sha: shas[0], start: 1 }]);
        }).pipe(Effect.provide(overlappingTrees(reading, peak)));

        expect(yield* Ref.get(peak)).toBeGreaterThanOrEqual(8);
        expect(yield* Ref.get(peak)).toBeLessThanOrEqual(16);
      }),
    { timeout: 30_000 }
  );

  it.live(
    "reads the file's older versions several at a time, not one after another",
    () =>
      Effect.gen(function* () {
        const reading = yield* Ref.make(false);
        const peak = yield* Ref.make(0);

        yield* Effect.gen(function* () {
          const { code, shas } = yield* growingHistory(40);

          yield* Ref.set(reading, true);

          // Each of the 40 lines came with a commit of its own, so the
          // blame reads every older version of `grow.txt`.
          const { ranges } = yield* whyView(
            code,
            main,
            RepoPath.make("grow.txt")
          );

          expect(ranges).toStrictEqual(
            shas.map((sha, at) => ({ end: at + 1, sha, start: at + 1 }))
          );
        }).pipe(Effect.provide(overlappingTrees(reading, peak, "blob")));

        expect(yield* Ref.get(peak)).toBeGreaterThanOrEqual(8);
        expect(yield* Ref.get(peak)).toBeLessThanOrEqual(16);
      }),
    { timeout: 30_000 }
  );

  it.effect("answers no ranges for a binary file, at its commit", () =>
    Effect.gen(function* () {
      const { code, week } = yield* history;

      expect(yield* whyOf(code, main, RepoPath.make("logo.png"))).toStrictEqual(
        {
          at: week,
          commits: [],
          landings: [],
          path: RepoPath.make("logo.png"),
          ranges: [],
        }
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("is UnknownPath for a missing path or a folder", () =>
    Effect.gen(function* () {
      const { code, week } = yield* history;

      for (const missing of ["nope.ts", "src"]) {
        const path = RepoPath.make(missing);

        expect(yield* Effect.exit(whyOf(code, main, path))).toStrictEqual(
          Exit.fail(new UnknownPath({ commit: week, path }))
        );
      }
    }).pipe(Effect.provide(RepoHostMemory))
  );
});
