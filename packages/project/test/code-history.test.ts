/**
 * Code history kept by immutable ids, over the memory repo
 * host behind a wrapper that counts the trees and blobs read, the memory
 * code store, and a fresh `CodeCacheLive` for each isolate: a why and a
 * path's log computed on one isolate are read back on another without a
 * walk; one landing past a kept result costs a handful of reads and agrees
 * with the whole walk; landings are always asked fresh; a cold walk keeps
 * many reads under way and looks each commit's entry up once; a value
 * that no longer decodes is computed again and replaced.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost, RepoSession, Revision } from "@repo/artifacts/repo-host";
import type { RepoSessionApi } from "@repo/artifacts/repo-host";
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
import { DateTime, Duration, Effect, Layer, Option, Ref, Schema } from "effect";

import { CodeStore } from "../src/code-store.ts";
import { CodeStoreCounts, CodeStoreMemory } from "../src/code-store/memory.ts";
import { logOf, whyOf } from "../src/code.ts";
import type { CodeProject } from "../src/code.ts";
import { CodeCache, CodeCacheLive } from "../src/code/cache.ts";
import type { CodeReads } from "../src/code/cache.ts";
import { FILE_WALK_CAP } from "../src/code/file-walk.ts";
import { keyOf, StoredWhy, whyKept } from "../src/code/history.ts";
import { WHY_SCAN } from "../src/code/why.ts";
import { Content, writer } from "./code-fixtures.ts";
import type { Tree } from "./code-fixtures.ts";

const project = ProjectName.make("histkit");

const repo = RepoName.make(project);

const format = RepoPath.make("src/format.ts");

const text = (value: string) => Content.Text({ text: value });

/**
 * What the counting host saw: trees and blobs read, the most under way at
 * once, and each read's start (`+<id>`) and end (`-<id>`) in order.
 */
interface Seen {
  readonly trees: number;
  readonly blobs: number;
  /** Files read whole at a commit (`readFile`). */
  readonly files: number;
  readonly peak: number;
  readonly events: readonly string[];
}

const none: Seen = { blobs: 0, events: [], files: 0, peak: 0, trees: 0 };

/** How long a read of the object `id` takes, once a test sets it. */
type Delay = Option.Option<(id: string) => Duration.Duration>;

/**
 * The memory store, each tree and blob read counted in `seen` and, once
 * `delay` is set, taking as long as it says: a live store answers each
 * read in tens to hundreds of milliseconds.
 */
const counted = (seen: Ref.Ref<Seen>, delay: Ref.Ref<Delay>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const under = yield* Ref.make(0);

      const timed = <A, E>(
        kind: "blobs" | "files" | "trees",
        id: string,
        read: Effect.Effect<A, E>
      ) =>
        Effect.gen(function* () {
          const now = yield* Ref.updateAndGet(under, (count) => count + 1);

          yield* Ref.update(seen, (was) => ({
            ...was,
            events: [...was.events, `+${id}`],
            [kind]: was[kind] + 1,
            peak: Math.max(was.peak, now),
          }));

          const wait = yield* Ref.get(delay);

          if (Option.isSome(wait)) {
            yield* Effect.sleep(wait.value(id));
          }

          return yield* read;
        }).pipe(
          Effect.ensuring(
            Effect.andThen(
              Ref.update(under, (count) => count - 1),
              Ref.update(seen, (was) => ({
                ...was,
                events: [...was.events, `-${id}`],
              }))
            )
          )
        );

      return RepoHost.of({
        ...host,
        readBlob: (name, id) => timed("blobs", id, host.readBlob(name, id)),
        // A file read at a commit is noted by the commit's id.
        readFile: (name, at, path) =>
          timed(
            "files",
            Revision.$match(at, {
              Branch: ({ name: branch }) => branch,
              Commit: ({ sha }) => sha,
            }),
            host.readFile(name, at, path)
          ),
        readTree: (name, id) => timed("trees", id, host.readTree(name, id)),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

const landingOf = (sha: CommitSha, ask: string): LandingView => ({
  ask: AskId.make(ask),
  assisted: [],
  author: Handle.make("bob"),
  credits: [],
  landedAt: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
  project,
  sha: LandedSha.make(sha),
});

/** A project's record whose landings a test may add to, each batch asked for counted. */
const recordOf = (head: CommitSha) =>
  Effect.gen(function* () {
    const landed = yield* Ref.make<readonly LandingView[]>([]);
    const asked = yield* Ref.make(0);

    const code: CodeProject = {
      forks: Effect.succeed([]),
      head: Effect.succeedSome(LandedSha.make(head)),
      landings: (shas) =>
        Effect.gen(function* () {
          yield* Ref.update(asked, (count) => count + 1);

          return (yield* Ref.get(landed)).filter(({ sha }) =>
            shas.includes(sha)
          );
        }),
      project,
      repo,
    };

    return { asked, code, landed };
  });

/** histkit's tree: its README and `src/format.ts`. */
const filesOf = (formatted: string, readme: string): Tree => [
  ["README.md", text(readme)],
  ["src/format.ts", text(formatted)],
];

/**
 * histkit: `src/format.ts` grows over four commits (one leaves it alone),
 * then two children of the fourth: `grown` inserts two lines and changes
 * one, `still` changes only the README.
 */
const history = Effect.gen(function* () {
  const git = yield* writer;

  const c1 = yield* git.commit("Adopt", filesOf("a\nb\n", "# one\n"), [], 1);
  const c2 = yield* git.commit("Readme", filesOf("a\nb\n", "# two\n"), [c1], 2);

  const c3 = yield* git.commit(
    "Land iso",
    filesOf("a\niso\nb\n", "# two\n"),
    [c2],
    3
  );

  const c4 = yield* git.commit(
    "Land week",
    filesOf("a\niso\nb\nweek\n", "# two\n"),
    [c3],
    4
  );

  const grown = yield* git.commit(
    "Land more",
    filesOf("a\nx\ny\niso, changed\nb\nweek\n", "# two\n"),
    [c4],
    5
  );

  const still = yield* git.commit(
    "Readme again",
    filesOf("a\niso\nb\nweek\n", "# three\n"),
    [c4],
    6
  );

  yield* git.push(repo, [
    ["refs/heads/main", grown],
    ["refs/heads/still", still],
  ]);

  return { c1, c3, c4, grown, still };
});

/** `effect` on a fresh isolate: a code cache of its own. */
const onIsolate = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provide(effect, CodeCacheLive(100));

/** `effect` with a store of its own, empty: the whole walk, from nothing. */
const fromNothing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  onIsolate(Effect.provide(effect, CodeStoreMemory));

/** A view's ranges, the commits it names and where it stopped. */
const whyOfView = (view: {
  readonly ranges: readonly unknown[];
  readonly commits: readonly { readonly sha: CommitSha }[];
  readonly stoppedAt?: CommitSha;
}) => ({
  commits: view.commits.map(({ sha }) => sha),
  ranges: view.ranges,
  stoppedAt: view.stoppedAt,
});

/** A test body over the counting host and one store every isolate shares. */
const within = <A, E>(
  body: (counts: {
    readonly seen: Ref.Ref<Seen>;
    readonly delay: Ref.Ref<Delay>;
  }) => Effect.Effect<A, E, RepoHost | CodeStoreCounts>
) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make(none);
    const delay = yield* Ref.make<Delay>(Option.none());

    return yield* body({ delay, seen }).pipe(
      Effect.provide(Layer.merge(counted(seen, delay), CodeStoreMemory))
    );
  });

const long = { timeout: 30_000 };

describe("code history kept across isolates", () => {
  it.effect(
    "reads a why another isolate computed without a tree or a blob, asking only for its landings",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { grown } = yield* history;
          const { asked, code } = yield* recordOf(grown);
          const first = yield* onIsolate(whyOf(code, Option.none(), format));

          yield* Ref.set(seen, none);
          yield* Ref.set(asked, 0);

          const again = yield* onIsolate(whyOf(code, Option.none(), format));

          expect(again).toStrictEqual(first);
          expect(yield* Ref.get(seen)).toStrictEqual(none);
          expect(yield* Ref.get(asked)).toBe(1);
        })
      )
  );

  it.effect(
    "reads a path's log page another isolate computed without a tree or a blob",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { grown } = yield* history;
          const { code } = yield* recordOf(grown);

          const page = {
            at: Option.none(),
            from: 0,
            limit: 2,
            path: Option.some(format),
          };

          const first = yield* onIsolate(logOf(code, page));

          yield* Ref.set(seen, none);

          const again = yield* onIsolate(logOf(code, page));

          expect(again).toStrictEqual(first);
          expect(first.commits).toHaveLength(2);
          expect(yield* Ref.get(seen)).toStrictEqual(none);
        })
      )
  );
});

/** The first page of `src/format.ts`'s log from `from`. */
const formatLog = (from: CommitSha) => ({
  at: Option.some(from),
  from: 0,
  limit: 30,
  path: Option.some(format),
});

describe("code history one landing past a kept result", () => {
  it.effect(
    "reads only the two versions' blobs for a why, and agrees with the whole walk",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { c4, grown } = yield* history;
          const { code } = yield* recordOf(grown);

          yield* onIsolate(whyOf(code, Option.some(c4), format));
          yield* Ref.set(seen, none);

          const next = yield* onIsolate(
            whyOf(code, Option.some(grown), format)
          );

          const counts = yield* Ref.get(seen);
          const whole = yield* fromNothing(whyOf(code, Option.none(), format));

          expect(counts.blobs).toBeLessThanOrEqual(2);
          expect(whyOfView(next)).toStrictEqual(whyOfView(whole));
          expect(whyOfView(next).commits).toContain(grown);
        })
      )
  );

  it.effect(
    "reads no blob for a why when the landing left the file alone",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { c4, grown, still } = yield* history;
          const { code } = yield* recordOf(grown);
          const kept = yield* onIsolate(whyOf(code, Option.some(c4), format));

          yield* Ref.set(seen, none);

          const next = yield* onIsolate(
            whyOf(code, Option.some(still), format)
          );

          expect((yield* Ref.get(seen)).blobs).toBe(0);
          expect(whyOfView(next)).toStrictEqual(whyOfView(kept));
          expect(next.at).toBe(still);
        })
      )
  );

  it.effect(
    "reads only the new commits' entries for a path's log, and agrees with the whole scan",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { c4, grown } = yield* history;
          const { code } = yield* recordOf(grown);

          yield* onIsolate(logOf(code, formatLog(c4)));
          yield* Ref.set(seen, none);

          const next = yield* onIsolate(logOf(code, formatLog(grown)));
          const counts = yield* Ref.get(seen);
          const whole = yield* fromNothing(logOf(code, formatLog(grown)));

          // `src/format.ts` two folders down, in `grown` and in `c4`.
          expect(counts.trees).toBeLessThanOrEqual(4);
          expect(next).toStrictEqual(whole);
          expect(next.commits.map(({ sha }) => sha)[0]).toBe(grown);
        })
      )
  );
});

describe("landings beside kept history", () => {
  it.effect("show on the next view once the record has them", () =>
    within(() =>
      Effect.gen(function* () {
        const { c1, grown } = yield* history;
        const { code, landed } = yield* recordOf(grown);

        // One isolate, so the second view finds the first's history kept.
        const [before, after] = yield* onIsolate(
          Effect.gen(function* () {
            const first = yield* whyOf(code, Option.none(), format);

            yield* Ref.set(landed, [landingOf(c1, "adopt")]);

            return [first, yield* whyOf(code, Option.none(), format)] as const;
          })
        );

        expect(before.landings).toStrictEqual([]);
        expect(after.landings.map(({ ask, sha }) => [sha, ask])).toStrictEqual([
          [c1, "adopt"],
        ]);
      })
    )
  );
});

/**
 * `count` commits: each changes `count.txt` at the root and leaves
 * `a/b/c/d/deep.txt` alone, so the commits' root trees all differ and the
 * folders under them never do.
 */
const deepHistory = (count: number) =>
  Effect.gen(function* () {
    const git = yield* writer;
    const shas: CommitSha[] = [];

    for (let at = 1; at <= count; at += 1) {
      shas.push(
        yield* git.commit(
          `Commit ${at}`,
          [
            ["a/b/c/d/deep.txt", text("deep\n")],
            ["count.txt", text(`${at}\n`)],
          ],
          shas.slice(-1),
          at
        )
      );
    }

    const head = shas.at(-1);

    if (head === undefined) {
      return yield* Effect.die("no commits");
    }

    yield* git.push(repo, [["refs/heads/main", head]]);

    return { head, shas };
  });

describe("a cold walk", () => {
  it.live(
    "keeps at least 40 reads under way when each takes 50 ms",
    () =>
      within(({ delay, seen }) =>
        Effect.gen(function* () {
          const { head, shas } = yield* deepHistory(64);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);
          yield* Ref.set(
            delay,
            Option.some(() => Duration.millis(50))
          );

          const view = yield* whyOf(
            code,
            Option.none(),
            RepoPath.make("a/b/c/d/deep.txt")
          );

          expect(view.ranges).toStrictEqual([
            { end: 1, sha: shas[0], start: 1 },
          ]);
          expect((yield* Ref.get(seen)).peak).toBeGreaterThanOrEqual(40);
        })
      ),
    long
  );

  // Counted, not timed: a batch of 16 waits for its slowest read, so while
  // one commit's file takes a second, at most its 15 neighbours finish;
  // with no barrier, every other commit does. Wall time under a loaded
  // machine says less than this count (the walk took about a quarter of
  // the batched walk's 1,250 ms when each read took 50 ms).
  it.live(
    "goes on past a slow read: every other commit's file is read while one takes a second",
    () =>
      within(({ delay, seen }) =>
        Effect.gen(function* () {
          const { head, shas } = yield* deepHistory(64);
          const { code } = yield* recordOf(head);

          // The commit after the head: the first the pass looks up. A file
          // read is noted by its commit's id.
          const slow = shas[62] ?? "";

          yield* Ref.set(seen, none);
          yield* Ref.set(
            delay,
            Option.some((id) => Duration.millis(id === slow ? 1000 : 10))
          );

          yield* whyOf(code, Option.none(), RepoPath.make("a/b/c/d/deep.txt"));

          const { events } = yield* Ref.get(seen);

          const during = events.slice(
            events.indexOf(`+${slow}`),
            events.indexOf(`-${slow}`)
          );

          const others = new Set(shas.slice(0, 62).map((sha) => `-${sha}`));

          expect(
            during.filter((event) => others.has(event)).length
          ).toBeGreaterThanOrEqual(60);
        })
      ),
    long
  );

  it.effect(
    "reads each commit's file once in a path's log",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { head } = yield* deepHistory(200);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);

          const { commits } = yield* logOf(code, {
            at: Option.none(),
            from: 0,
            limit: 30,
            path: Option.some(RepoPath.make("count.txt")),
          });

          const { files, trees } = yield* Ref.get(seen);

          expect(commits).toHaveLength(30);
          expect({ files, trees }).toStrictEqual({ files: 200, trees: 0 });
        })
      ),
    long
  );

  it.effect(
    "looks each commit's folder up once in a folder's log",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { head } = yield* deepHistory(200);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);

          const { commits } = yield* logOf(code, {
            at: Option.none(),
            from: 0,
            limit: 30,
            path: Option.some(RepoPath.make("a/b")),
          });

          expect(commits).toHaveLength(1);
          // Each commit's root tree read once from the store, and `a`, the
          // same tree in every commit, once. The view shares a tree read
          // under way among its fibers, so this count holds the store's
          // reads, not how often the walk asked.
          expect((yield* Ref.get(seen)).trees).toBe(201);
        })
      ),
    long
  );

  it.live(
    "keeps at least 40 folder reads under way in a folder's log when each takes 50 ms",
    () =>
      within(({ delay, seen }) =>
        Effect.gen(function* () {
          const { head } = yield* deepHistory(64);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);
          yield* Ref.set(
            delay,
            Option.some(() => Duration.millis(50))
          );

          yield* logOf(code, {
            at: Option.none(),
            from: 0,
            limit: 30,
            path: Option.some(RepoPath.make("a/b")),
          });

          const { files, peak } = yield* Ref.get(seen);

          expect(files).toBe(1);
          expect(peak).toBeGreaterThanOrEqual(40);
        })
      ),
    long
  );
});

describe("a kept value that no longer decodes", () => {
  it.effect("is computed again and replaced", () =>
    within(({ seen }) =>
      Effect.gen(function* () {
        const { grown } = yield* history;
        const { code } = yield* recordOf(grown);
        const store = yield* CodeStore;

        const key = yield* keyOf(whyKept, {
          commit: grown,
          path: format,
          repo,
          scan: WHY_SCAN,
        });

        yield* store.put(key, '{"blob":"not an id"}');

        const view = yield* onIsolate(whyOf(code, Option.none(), format));
        const replaced = yield* store.get(key);

        const { blobs, files } = yield* Ref.get(seen);

        expect(blobs + files).toBeGreaterThan(0);
        expect(view.ranges.length).toBeGreaterThan(0);
        expect(
          Option.flatMap(
            replaced,
            Schema.decodeUnknownOption(Schema.fromJsonString(StoredWhy))
          ).pipe(Option.map(({ ranges }) => ranges))
        ).toStrictEqual(Option.some(view.ranges));
        expect(
          (yield* CodeStoreCounts.use(({ counts }) => counts)).puts
        ).toBeGreaterThanOrEqual(2);
      })
    )
  );
});

/**
 * The memory store, the session each commit, tree, blob and log read ran
 * in noted in `sessions`, in order.
 */
const sessioned = (
  sessions: Ref.Ref<readonly Option.Option<RepoSessionApi>[]>
) => {
  const noted = <A, E>(read: Effect.Effect<A, E>) =>
    Effect.flatMap(RepoSession, (session) =>
      Effect.andThen(
        Ref.update(sessions, (was) => [...was, session]),
        read
      )
    );

  return Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        log: (name, at, limit, offset) =>
          noted(host.log(name, at, limit, offset)),
        readBlob: (name, id) => noted(host.readBlob(name, id)),
        readCommit: (name, sha) => noted(host.readCommit(name, sha)),
        readFile: (name, at, path) => noted(host.readFile(name, at, path)),
        readTree: (name, id) => noted(host.readTree(name, id)),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));
};

/** How many sessions `sessions` names, and whether a read ran in none. */
const sessionsIn = (sessions: readonly Option.Option<RepoSessionApi>[]) => ({
  outside: sessions.some(Option.isNone),
  sessions: new Set(sessions.flatMap(Option.toArray)).size,
});

describe("one view's reads", () => {
  it.effect("of a cold why all run in one session", () =>
    Effect.gen(function* () {
      const sessions = yield* Ref.make<
        readonly Option.Option<RepoSessionApi>[]
      >([]);

      yield* Effect.gen(function* () {
        const { grown } = yield* history;
        const { code } = yield* recordOf(grown);

        yield* Ref.set(sessions, []);
        yield* onIsolate(whyOf(code, Option.none(), format));
      }).pipe(
        Effect.provide(Layer.merge(sessioned(sessions), CodeStoreMemory))
      );

      expect(sessionsIn(yield* Ref.get(sessions))).toStrictEqual({
        outside: false,
        sessions: 1,
      });
    })
  );

  it.effect("of a cold path's log page all run in one session", () =>
    Effect.gen(function* () {
      const sessions = yield* Ref.make<
        readonly Option.Option<RepoSessionApi>[]
      >([]);

      yield* Effect.gen(function* () {
        const { grown } = yield* history;
        const { code } = yield* recordOf(grown);

        yield* Ref.set(sessions, []);
        yield* onIsolate(logOf(code, formatLog(grown)));
      }).pipe(
        Effect.provide(Layer.merge(sessioned(sessions), CodeStoreMemory))
      );

      expect(sessionsIn(yield* Ref.get(sessions))).toStrictEqual({
        outside: false,
        sessions: 1,
      });
    })
  );
});

describe("kept history in the isolate's cache", () => {
  it.effect(
    "is kept with the heavy reads: a why's ranges grow with its file",
    () =>
      within(() =>
        Effect.gen(function* () {
          const { grown } = yield* history;
          const { code } = yield* recordOf(grown);

          const seen = yield* Ref.make<readonly (readonly [string, boolean])[]>(
            []
          );

          const spy: CodeReads = {
            through: (key, read, keeping = {}) =>
              Effect.andThen(
                Ref.update(seen, (was) => [
                  ...was,
                  [key, keeping.heavy === true] as const,
                ]),
                read
              ),
          };

          yield* Effect.all([
            whyOf(code, Option.none(), format),
            logOf(code, formatLog(grown)),
          ]).pipe(Effect.provideService(CodeCache, spy));

          const kept = (yield* Ref.get(seen)).filter(([key]) =>
            /\/(?:why|path-log)\/v\d+\//u.test(key)
          );

          expect(kept.length).toBeGreaterThan(0);
          expect(kept.filter(([, heavy]) => !heavy)).toStrictEqual([]);
        })
      )
  );
});

describe("a cold walk over a file", () => {
  it.effect(
    "reads the file once at each commit of a why and no folder past the head's",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { head } = yield* deepHistory(20);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);
          yield* whyOf(code, Option.none(), RepoPath.make("a/b/c/d/deep.txt"));

          const { blobs, files, trees } = yield* Ref.get(seen);

          // One read of the file per commit is one call each; the folders
          // above it took five per commit.
          expect({ blobs, files }).toStrictEqual({ blobs: 0, files: 20 });
          expect(trees).toBeLessThanOrEqual(5);
        })
      )
  );

  it.effect(
    "reads the file once at each commit of a path's log and no folder",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const { head } = yield* deepHistory(20);
          const { code } = yield* recordOf(head);

          yield* Ref.set(seen, none);

          const { commits } = yield* logOf(code, {
            at: Option.none(),
            from: 0,
            limit: 30,
            path: Option.some(RepoPath.make("a/b/c/d/deep.txt")),
          });

          const { files, trees } = yield* Ref.get(seen);

          expect(commits).toHaveLength(1);
          expect(files).toBeLessThanOrEqual(21);
          expect(trees).toBe(0);
        })
      )
  );

  it.effect(
    "looks a file past the cap up by its folders, never reading it whole at each commit",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const git = yield* writer;
          const big = "x".repeat(FILE_WALK_CAP);

          const c1 = yield* git.commit(
            "One",
            [["big.txt", text(`${big}\n`)]],
            [],
            1
          );

          const c2 = yield* git.commit(
            "Two",
            [["big.txt", text(`${big}\nmore\n`)]],
            [c1],
            2
          );

          yield* git.push(repo, [["refs/heads/main", c2]]);

          const { code } = yield* recordOf(c2);

          yield* Ref.set(seen, none);

          const view = yield* whyOf(
            code,
            Option.none(),
            RepoPath.make("big.txt")
          );

          expect(view.ranges).toStrictEqual([
            { end: 1, sha: c1, start: 1 },
            { end: 2, sha: c2, start: 2 },
          ]);
          expect((yield* Ref.get(seen)).files).toBeLessThanOrEqual(1);
        })
      )
  );
});
