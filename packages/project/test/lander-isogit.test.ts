import { describe, expect, it } from "@effect/vitest";
import {
  BranchName,
  HostBusy,
  ObjectId,
  RefName,
  RepoHost,
  RepoName,
  Revision,
} from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { notesRef } from "@repo/git/notes";
import {
  authorLine,
  committerLine,
  formatLanding,
  parseTrailers,
} from "@repo/git/trailers";
import { Verdict } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CheckVersion,
  CommitSha,
  Handle,
  LandedSha,
  PatchId,
  ProjectName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { hashBlob, readCommit, writeCommit } from "isomorphic-git";

import { composeRef, Lander, landedRef, Rebuild } from "../src/lander.ts";
import type { LandJob } from "../src/lander.ts";
import { LanderIsogit } from "../src/lander/isogit.ts";

const demo = RepoName.make("demo");

const fork = RepoName.make("demo--fix-parser--alice");

const mainRef = RefName.make("refs/heads/main");

const alice = Handle.make("alice");

const bob = Handle.make("bob");

const requestId = RequestId.make("request-fix-parser-1");

// When the landing in the first land test is made, by the TestClock.
const landingTime = "2026-10-07T12:30:00Z";

/** The Lander over a fresh memory store, with the store itself for the test to read. */
const world = Layer.provideMerge(LanderIsogit, RepoHostMemory);

/** The refs whose pushes the store refuses as busy; the test sets them as it goes. */
class BusyRefs extends Context.Service<
  BusyRefs,
  Ref.Ref<ReadonlySet<RefName>>
>()("test/BusyRefs") {}

/** From now on, the store refuses every push of one of `refs` as busy. */
const busy = (...refs: readonly RefName[]) =>
  BusyRefs.use((busyRefs) => Ref.set(busyRefs, new Set(refs)));

/**
 * The Lander over a fresh memory store that refuses as busy any push of a
 * ref in `BusyRefs` (none at first), with the store for the test to read.
 */
const busyWorld = Layer.provideMerge(
  LanderIsogit,
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const busyRefs = yield* BusyRefs;

      return RepoHost.of({
        ...host,
        push: (name, source, updates) =>
          Effect.gen(function* () {
            const refused = yield* Ref.get(busyRefs);

            if (updates.some(({ ref }) => refused.has(ref))) {
              return yield* new HostBusy({ name });
            }

            return yield* host.push(name, source, updates);
          }),
      });
    })
  ).pipe(
    Layer.provide(RepoHostMemory),
    Layer.provideMerge(
      Layer.effect(BusyRefs, Ref.make<ReadonlySet<RefName>>(new Set()))
    )
  )
);

/** git's id for a blob holding `text`. */
const blobOf = (text: string) =>
  Effect.promise(() => hashBlob({ object: text })).pipe(
    Effect.map(({ oid }) => BlobSha.make(oid))
  );

/**
 * Canonical `demo` with `files` on main, and alice's claim fork of it. The
 * test builds commits in its own client and pushes them with plain
 * compare-and-swaps, as git would.
 */
const project = (files: Files) =>
  Effect.gen(function* () {
    const repos = yield* RepoHost;
    const client = yield* gitClient(memoryFs());
    const base = yield* client.commit("Start", files);

    yield* repos.create(demo);
    yield* repos.push(demo, client.source, [
      { from: Option.none(), ref: mainRef, to: base },
    ]);
    yield* repos.fork(demo, fork);

    /** A commit of `files` on `parent`, pushed to `repo`'s main. */
    const advance = (
      repo: RepoName,
      parent: CommitSha,
      message: string,
      next: Files
    ) =>
      Effect.gen(function* () {
        const sha = yield* client.commit(message, next, [parent]);

        yield* repos.push(repo, client.source, [
          { from: Option.some(parent), ref: mainRef, to: sha },
        ]);

        return sha;
      });

    /** The tree git makes of `next`, built in the client and never pushed. */
    const treeOf = (next: Files) =>
      Effect.gen(function* () {
        const sha = yield* client.commit("Expected", next);

        const { commit } = yield* Effect.promise(() =>
          readCommit({ ...client.source, oid: sha })
        );

        return TreeSha.make(commit.tree);
      });

    /**
     * The id git gives a platform commit of `tree` on `parent` by `author`,
     * made at `iso`: written in the client and never pushed.
     */
    const platformCommitOf = (input: {
      readonly tree: TreeSha;
      readonly parent: CommitSha;
      readonly author: Handle;
      readonly message: string;
      readonly iso: string;
    }) =>
      Effect.gen(function* () {
        const timestamp = Math.floor(
          DateTime.toEpochMillis(at(input.iso)) / 1000
        );

        const oid = yield* Effect.promise(() =>
          writeCommit({
            ...client.source,
            commit: {
              author: {
                ...authorLine(input.author),
                timestamp,
                timezoneOffset: 0,
              },
              committer: { ...committerLine, timestamp, timezoneOffset: 0 },
              message: input.message,
              parent: [input.parent],
              tree: input.tree,
            },
          })
        );

        return CommitSha.make(oid);
      });

    return { advance, base, platformCommitOf, treeOf };
  });

/** The tip of `main`, as the platform last landed it. */
const landed = (sha: CommitSha) => LandedSha.make(sha);

const checkedAt = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const verdictOn = (head: CommitSha, base: CommitSha, tree: TreeSha) =>
  Verdict.make({
    ask: AskId.make("fix-parser"),
    at: checkedAt,
    base,
    checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
    head,
    heldBack: [],
    lanes: [],
    outcome: Outcome.cases.Checking.make({ stage: "checks" }),
    patchId: PatchId.make("2".repeat(64)),
    project: ProjectName.make("alice/demo"),
    stage: "checks",
    tree,
    verifier: "platform",
  });

const message = formatLanding({
  assisted: [],
  credits: [
    { handle: bob, role: "Asked-by" },
    { handle: alice, role: "Signed-off-by" },
  ],
  requestId,
  subject: "Fix the parser",
});

/** The note on `target` in `repo`'s notes, as plain git finds it. */
const noteOn = (repo: RepoName, target: CommitSha) =>
  Effect.gen(function* () {
    const repos = yield* RepoHost;
    const tip = (yield* repos.refs(repo)).get(notesRef);

    if (tip === undefined) {
      return Option.none();
    }

    const commit = Option.getOrThrow(yield* repos.readCommit(repo, tip));
    const entries = Option.getOrThrow(yield* repos.readTree(repo, commit.tree));
    const entry = entries.find(({ name }) => name === target);

    if (entry === undefined) {
      return Option.none();
    }

    const bytes = yield* repos.readBlob(repo, ObjectId.make(entry.sha));

    return Option.map(bytes, (note) => new TextDecoder().decode(note));
  });

const decodeNote = Schema.decodeEffect(Schema.fromJsonString(Verdict));

const start: Files = [
  ["src/a.ts", "a1\n"],
  ["src/b.ts", "b1\n"],
];

/**
 * main changed `src/b.ts` since the fork; alice's head changed `src/a.ts`
 * and added `docs/guide.md`.
 */
const diverged = Effect.gen(function* () {
  const { advance, base, platformCommitOf, treeOf } = yield* project(start);

  const main = yield* advance(demo, base, "Touch b", [
    ["src/a.ts", "a1\n"],
    ["src/b.ts", "b2\n"],
  ]);

  const head = yield* advance(fork, base, "Fix a", [
    ["docs/guide.md", "read me\n"],
    ["src/a.ts", "a2\n"],
    ["src/b.ts", "b1\n"],
  ]);

  return {
    advance,
    base,
    head,
    main: landed(main),
    platformCommitOf,
    treeOf,
  };
});

/** A land of alice's merged answer onto `main`. */
const landOf = (input: {
  readonly main: LandedSha;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly tree: TreeSha;
}): LandJob => ({
  author: alice,
  main: input.main,
  message,
  rebuild: Rebuild.Merge({ base: input.base, fork, head: input.head }),
  repo: demo,
  requestId,
  tree: input.tree,
  verdict: Option.some(verdictOn(input.head, input.base, input.tree)),
});

describe("the isomorphic-git Lander", () => {
  describe("merge", () => {
    it.effect(
      "merges a head that changed one file onto a main that changed another, with the answer's own changes",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const { base, head, main, treeOf } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          expect(merged).toStrictEqual({
            changes: [
              {
                after: yield* blobOf("read me\n"),
                path: RepoPath.make("docs/guide.md"),
                status: "added",
              },
              {
                after: yield* blobOf("a2\n"),
                before: yield* blobOf("a1\n"),
                path: RepoPath.make("src/a.ts"),
                status: "modified",
              },
            ],
            tree: yield* treeOf([
              ["docs/guide.md", "read me\n"],
              ["src/a.ts", "a2\n"],
              ["src/b.ts", "b2\n"],
            ]),
          });
        }).pipe(Effect.provide(world))
    );

    it.effect("merges two changes to different lines of one file", () =>
      Effect.gen(function* () {
        const lander = yield* Lander;

        const { advance, base, treeOf } = yield* project([
          ["src/a.ts", "1\n2\n3\n4\n5\n"],
        ]);

        const main = yield* advance(demo, base, "Top", [
          ["src/a.ts", "one\n2\n3\n4\n5\n"],
        ]);

        const head = yield* advance(fork, base, "Bottom", [
          ["src/a.ts", "1\n2\n3\n4\nfive\n"],
        ]);

        const merged = yield* lander.merge({
          base,
          fork,
          head,
          main: landed(main),
          repo: demo,
        });

        expect(merged.tree).toBe(
          yield* treeOf([["src/a.ts", "one\n2\n3\n4\nfive\n"]])
        );
      }).pipe(Effect.provide(world))
    );

    it.effect(
      "refuses a head that conflicts with main as StaleBase, naming every conflicting path in order",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;

          const { advance, base } = yield* project([
            ...start,
            ["src-x.ts", "x1\n"],
          ]);

          const main = yield* advance(demo, base, "Main's a and x", [
            ["src-x.ts", "x-main\n"],
            ["src/a.ts", "a-main\n"],
            ["src/b.ts", "b1\n"],
          ]);

          const head = yield* advance(fork, base, "Alice's a and x", [
            ["src-x.ts", "x-alice\n"],
            ["src/a.ts", "a-alice\n"],
            ["src/b.ts", "b1\n"],
          ]);

          const refused = yield* lander
            .merge({ base, fork, head, main: landed(main), repo: demo })
            .pipe(Effect.flip);

          expect(refused).toStrictEqual(
            new StaleBase({
              base,
              conflicts: [RepoPath.make("src-x.ts"), RepoPath.make("src/a.ts")],
              main,
            })
          );
        }).pipe(Effect.provide(world))
    );
  });

  describe("land", () => {
    it.effect(
      "lands one platform commit on main that credits its people, then the mirror ref and the verdict note",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main, platformCommitOf } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          yield* advanceTo(landingTime);

          const job = landOf({ base, head, main, tree: merged.tree });
          const result = yield* lander.land(job);
          const refs = yield* repos.refs(demo);

          const commit = Option.getOrThrow(
            yield* repos.readCommit(demo, result.sha)
          );

          expect({
            mirror: refs.get(landedRef),
            onMain: refs.get(mainRef),
            pending: result.pending,
          }).toStrictEqual({
            mirror: result.sha,
            onMain: result.sha,
            pending: [],
          });
          expect({
            author: commit.author,
            committer: commit.committer,
            parents: commit.parents,
            trailers: parseTrailers(commit.message),
            tree: commit.tree,
          }).toStrictEqual({
            author: authorLine(alice),
            committer: committerLine,
            parents: [main],
            trailers: [
              { key: "Asked-by", value: `bob <bob@users.${Brand.domain}>` },
              {
                key: "Signed-off-by",
                value: `alice <alice@users.${Brand.domain}>`,
              },
              { key: "Request-Id", value: requestId },
            ],
            tree: merged.tree,
          });
          // The whole commit, its time from the Clock included.
          expect(result.sha).toBe(
            yield* platformCommitOf({
              author: alice,
              iso: landingTime,
              message,
              parent: main,
              tree: merged.tree,
            })
          );
          expect(landedRef).toBe(`${Brand.refsPrefix}landed`);

          const note = Option.getOrThrow(yield* noteOn(demo, result.sha));

          expect(yield* decodeNote(note)).toStrictEqual(
            Option.getOrThrow(job.verdict)
          );
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "refuses as StaleBase when main moved after the merge, and never forces main",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { advance, base, head, main } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          const other = yield* advance(demo, main, "Someone else landed", [
            ["src/a.ts", "a1\n"],
            ["src/b.ts", "b3\n"],
          ]);

          const refused = yield* lander
            .land(landOf({ base, head, main, tree: merged.tree }))
            .pipe(Effect.flip);

          expect(refused).toStrictEqual(
            new StaleBase({ base, conflicts: [], main: other })
          );
          expect((yield* repos.refs(demo)).get(mainRef)).toBe(other);
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "lands a request once: a second land with the same request id returns the first commit",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          const job = landOf({ base, head, main, tree: merged.tree });
          const first = yield* lander.land(job);
          const second = yield* lander.land(job);

          const history = yield* repos.log(
            demo,
            Revision.Branch({ name: BranchName.make("main") }),
            3
          );

          expect(second).toStrictEqual(first);
          expect(history.map(({ sha }) => sha)).toStrictEqual([
            first.sha,
            main,
            base,
          ]);
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "still lands when the mirror ref and the note cannot be written, and says they are pending",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          yield* busy(landedRef, notesRef);

          const result = yield* lander.land(
            landOf({ base, head, main, tree: merged.tree })
          );

          const refs = yield* repos.refs(demo);

          expect(result.pending).toStrictEqual(["mirror", "notes"]);
          expect(refs.get(mainRef)).toBe(result.sha);
          expect([refs.has(landedRef), refs.has(notesRef)]).toStrictEqual([
            false,
            false,
          ]);
        }).pipe(Effect.provide(busyWorld))
    );

    it.effect(
      "writes the pending mirror ref and note when the same job lands again, with no new commit",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          const job = landOf({ base, head, main, tree: merged.tree });

          yield* busy(landedRef, notesRef);

          const first = yield* lander.land(job);

          yield* busy();

          const again = yield* lander.land(job);
          const refs = yield* repos.refs(demo);

          expect({
            again,
            first: first.pending,
            mirror: refs.get(landedRef),
            onMain: refs.get(mainRef),
          }).toStrictEqual({
            again: { pending: [], sha: first.sha },
            first: ["mirror", "notes"],
            mirror: first.sha,
            onMain: first.sha,
          });

          const note = Option.getOrThrow(yield* noteOn(demo, first.sha));

          expect(yield* decodeNote(note)).toStrictEqual(
            Option.getOrThrow(job.verdict)
          );
        }).pipe(Effect.provide(busyWorld))
    );

    it.effect(
      "never moves the mirror back to an earlier landing that lands again after a later one",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;
          const forked = Option.getOrThrow(yield* repos.readCommit(demo, base));
          const revertId = RequestId.make("request-revert-1");

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          const job = landOf({ base, head, main, tree: merged.tree });

          yield* busy(landedRef);

          const first = yield* lander.land(job);

          yield* busy();

          const later = yield* lander.land({
            author: bob,
            main: first.sha,
            message: formatLanding({
              assisted: [],
              credits: [{ handle: bob, role: "Signed-off-by" }],
              requestId: revertId,
              subject: "Revert the parser fix",
            }),
            rebuild: Rebuild.Existing({ commit: base }),
            repo: demo,
            requestId: revertId,
            tree: TreeSha.make(forked.tree),
            verdict: Option.none(),
          });

          const again = yield* lander.land(job);

          expect({
            again,
            first: first.pending,
            mirror: (yield* repos.refs(demo)).get(landedRef),
          }).toStrictEqual({
            again: { pending: [], sha: first.sha },
            first: ["mirror"],
            mirror: later.sha,
          });
        }).pipe(Effect.provide(busyWorld))
    );

    it.effect(
      "refuses as RepoBusy when the store is busy with main, and leaves main where it was",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;

          const merged = yield* lander.merge({
            base,
            fork,
            head,
            main,
            repo: demo,
          });

          yield* busy(mainRef);

          const refused = yield* lander
            .land(landOf({ base, head, main, tree: merged.tree }))
            .pipe(Effect.flip);

          expect(refused).toStrictEqual(new RepoBusy({}));
          expect((yield* repos.refs(demo)).get(mainRef)).toBe(main);
        }).pipe(Effect.provide(busyWorld))
    );

    it.effect(
      "refuses a rebuild that does not give the checked tree, leaving main where it was",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, head, main } = yield* diverged;

          const refused = yield* lander
            .land(landOf({ base, head, main, tree: TreeSha.make(main) }))
            .pipe(Effect.flip);

          expect(refused).toStrictEqual(new VerifierBlocked({}));
          expect((yield* repos.refs(demo)).get(mainRef)).toBe(main);
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "lands a decider's composed files as the platform commit that opens an ask",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base } = yield* project(start);
          const main = landed(base);

          const files = [
            {
              content: "export default {}\n",
              path: RepoPath.make(`${Brand.configDir}/asks/x.ask.ts`),
            },
          ] as const;

          const composed = yield* lander.compose({ files, main, repo: demo });

          const result = yield* lander.land({
            author: bob,
            main,
            message,
            rebuild: Rebuild.Compose({ files }),
            repo: demo,
            requestId,
            tree: composed.tree,
            verdict: Option.none(),
          });

          const commit = Option.getOrThrow(
            yield* repos.readCommit(demo, result.sha)
          );

          expect(result.pending).toStrictEqual([]);
          expect({
            author: commit.author,
            parents: commit.parents,
            tree: commit.tree,
          }).toStrictEqual({
            author: authorLine(bob),
            parents: [base],
            tree: composed.tree,
          });
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "lands an existing commit's tree again on top of main, as a revert does",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, main } = yield* diverged;
          const before = Option.getOrThrow(yield* repos.readCommit(demo, base));

          const result = yield* lander.land({
            author: bob,
            main,
            message,
            rebuild: Rebuild.Existing({ commit: base }),
            repo: demo,
            requestId,
            tree: TreeSha.make(before.tree),
            verdict: Option.none(),
          });

          const commit = Option.getOrThrow(
            yield* repos.readCommit(demo, result.sha)
          );

          expect({
            onMain: (yield* repos.refs(demo)).get(mainRef),
            parents: commit.parents,
            tree: commit.tree,
          }).toStrictEqual({
            onMain: result.sha,
            parents: [main],
            tree: before.tree,
          });
        }).pipe(Effect.provide(world))
    );
  });

  describe("compose", () => {
    it.effect(
      "adds a decider's files to main's tree on a scratch ref, and leaves main alone",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const repos = yield* RepoHost;
          const { base, treeOf } = yield* project(start);
          const ask = `${Brand.configDir}/asks/x.ask.ts`;
          const check = "packages/p/test/x.test.ts";

          const composed = yield* lander.compose({
            files: [
              { content: "export default {}\n", path: RepoPath.make(ask) },
              { content: "test('x')\n", path: RepoPath.make(check) },
            ],
            main: landed(base),
            repo: demo,
          });

          const refs = yield* repos.refs(demo);

          const commit = Option.getOrThrow(
            yield* repos.readCommit(demo, composed.commit)
          );

          expect(composed.tree).toBe(
            yield* treeOf([
              ...start,
              [ask, "export default {}\n"],
              [check, "test('x')\n"],
            ])
          );
          expect({ parents: commit.parents, tree: commit.tree }).toStrictEqual({
            parents: [base],
            tree: composed.tree,
          });
          expect(composeRef(composed.tree)).toBe(
            `${Brand.refsPrefix}compose/${composed.tree}`
          );
          expect(refs.get(composeRef(composed.tree))).toBe(composed.commit);
          expect(refs.get(mainRef)).toBe(base);
        }).pipe(Effect.provide(world))
    );

    it.effect(
      "composes the same files onto the same main to the same commit",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const { base } = yield* project(start);

          const job = {
            files: [
              {
                content: "export default {}\n",
                path: RepoPath.make(`${Brand.configDir}/asks/x.ask.ts`),
              },
            ],
            main: landed(base),
            repo: demo,
          } as const;

          const first = yield* lander.compose(job);

          yield* advanceTo("2026-10-07T13:00:00Z");

          expect(yield* lander.compose(job)).toStrictEqual(first);
        }).pipe(Effect.provide(world))
    );
  });

  describe("bundleRules", () => {
    it.effect(
      "hands back every file under the config folder at a landed commit, as committed",
      () =>
        Effect.gen(function* () {
          const lander = yield* Lander;
          const entry = `${Brand.configDir}/project.ts`;
          const ask = `${Brand.configDir}/asks/x.ask.ts`;

          const { base } = yield* project([
            [ask, "export default ask\n"],
            [entry, "export default project\n"],
            ["src/a.ts", "a1\n"],
          ]);

          const bundle = yield* lander.bundleRules({
            at: landed(base),
            repo: demo,
          });

          expect({
            entry: bundle.entry,
            modules: bundle.modules,
          }).toStrictEqual({
            entry,
            modules: {
              [ask]: "export default ask\n",
              [entry]: "export default project\n",
            },
          });
        }).pipe(Effect.provide(world))
    );

    it.effect("hands back no modules when there is no config folder", () =>
      Effect.gen(function* () {
        const lander = yield* Lander;
        const { base } = yield* project(start);

        const bundle = yield* lander.bundleRules({
          at: landed(base),
          repo: demo,
        });

        expect({ entry: bundle.entry, modules: bundle.modules }).toStrictEqual({
          entry: `${Brand.configDir}/project.ts`,
          modules: {},
        });
      }).pipe(Effect.provide(world))
    );
  });
});
