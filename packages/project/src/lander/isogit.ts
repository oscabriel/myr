/**
 * The `Lander` over isomorphic-git in a Worker (spec D6): the production
 * fallback until the container Lander in `apps/sandbox` passes, and the one
 * the core-loop tests run on. It runs no project code and installs nothing.
 *
 * It is stateless. Each call reads the commits, trees and blobs it needs
 * through `RepoHost` (never `fetch`), writes the objects it makes into a
 * scratch git directory in memory, and pushes from there: canonical `main`
 * with a non-force compare-and-swap, then the mirror ref and the verdict
 * note, each in its own push, since Artifacts has no atomic multi-ref push
 * (S1 #6). A scratch directory holds only the objects the repo lacks; the
 * rest are referenced by id.
 *
 * The merge is three-way at the tree level, read through the port: it
 * descends only into folders both sides changed, and a file both sides
 * changed is merged line by line by isomorphic-git's `merge` over a scratch
 * history of that one file.
 *
 * `bundleRules` returns the config folder's sources as committed. This
 * adapter bundles no TypeScript; the container Lander bundles with Bun (W3
 * 306).
 */
import {
  BranchName,
  ObjectId,
  RefName,
  RefOutcome,
  RepoHost,
  Revision,
} from "@repo/artifacts/repo-host";
import type {
  PushSource,
  RefUpdate,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { noteCommit, notesRef } from "@repo/git/notes";
import { authorLine, committerLine, parseTrailers } from "@repo/git/trailers";
import type { GitIdentity } from "@repo/git/trailers";
import { treeDiff } from "@repo/git/tree-diff";
import type { Verdict } from "@repo/protocol/domain/answer";
import { CommitSha, LandedSha, RepoPath, TreeSha } from "@repo/protocol/ids";
import type { RepoName, RequestId } from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import type { ConfigBundle } from "@repo/rules/rules-evaluator";
import { Array, Clock, DateTime, Effect, Layer, Option, Order } from "effect";
import {
  Errors,
  init,
  merge as mergeHistories,
  readTree as readScratchTree,
  writeBlob,
  writeCommit,
  writeRef,
  writeTree,
} from "isomorphic-git";

import { composeRef, Lander, landedRef, Rebuild } from "../lander.ts";
import type {
  Bookkeeping,
  BundleJob,
  ComposedFile,
  ComposeJob,
  LandJob,
  MergeJob,
} from "../lander.ts";

const mainRef = RefName.make("refs/heads/main");

const mainBranch = BranchName.make("main");

/**
 * The SDK version a bundle reports. ASSUMPTION: the platform's own, `0.0.0`
 * until release. `@repo/project` may not import `@repo/sdk`, which states it,
 * so 299 decides where this comes from (212's Comments).
 */
const sdkVersion = "0.0.0";

// How far back from main's tip a second land looks for the first one's commit.
const LOOKBACK = 16;

// git's test for a binary file: a NUL among its first bytes.
const SNIFF = 8000;

const blocked = () => new VerifierBlocked({});

/** A store that lost a repo cannot merge or land: `VerifierBlocked`. */
const unlessLost = <A, R>(
  effect: Effect.Effect<A, RepoNotFound, R>
): Effect.Effect<A, VerifierBlocked, R> => Effect.mapError(effect, blocked);

/** An object the store should hold and does not: `VerifierBlocked` too. */
const found = <A, R>(
  read: Effect.Effect<Option.Option<A>, RepoNotFound, R>
): Effect.Effect<A, VerifierBlocked, R> =>
  read.pipe(
    unlessLost,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(blocked()),
        onSome: Effect.succeed,
      })
    )
  );

const commitIn = (repo: RepoName, sha: CommitSha) =>
  found(RepoHost.use((host) => host.readCommit(repo, sha)));

const treeIn = (repo: RepoName, tree: ObjectId) =>
  found(RepoHost.use((host) => host.readTree(repo, tree)));

const blobIn = (repo: RepoName, blob: ObjectId) =>
  found(RepoHost.use((host) => host.readBlob(repo, blob)));

const refsIn = (repo: RepoName) =>
  RepoHost.use((host) => host.refs(repo)).pipe(unlessLost);

/** One ref's compare-and-swap, alone in its push; what it came to. */
const pushOne = (repo: RepoName, source: PushSource, update: RefUpdate) =>
  RepoHost.use((host) => host.push(repo, source, [update])).pipe(
    Effect.map((outcomes) => Option.fromNullishOr(outcomes[0]))
  );

/** A push whose ref did not move, for a ref where that is not a refusal. */
const moves = (outcome: Option.Option<RefOutcome>) =>
  Option.exists(outcome, RefOutcome.$is("Updated"))
    ? Effect.void
    : Effect.fail(blocked());

/** Clock time, in the whole seconds a git signature holds. */
const seconds = Effect.map(Clock.currentTimeMillis, (millis) =>
  Math.floor(millis / 1000)
);

const git = <A>(run: () => Promise<A>) =>
  Effect.tryPromise(run).pipe(Effect.orDie);

/** A git signature at `at` seconds past the epoch, in UTC. */
const signed = (who: GitIdentity, at: number) => ({
  email: who.email,
  name: who.name,
  timestamp: at,
  timezoneOffset: 0,
});

/** A copy of an object must keep its id, or the push would name one it lacks. */
const kept = (id: ObjectId, made: ObjectId) =>
  made === id ? Effect.void : Effect.die(`copying ${id} produced ${made}`);

/**
 * A bare git directory in memory: what a call writes its new objects into
 * and pushes from. One per call; nothing outlives it.
 */
const scratch = Effect.gen(function* () {
  const source: PushSource = { fs: memoryFs(), gitdir: "/lander.git" };

  yield* git(() => init({ ...source, bare: true, defaultBranch: "main" }));

  const blob = (bytes: Uint8Array) =>
    Effect.map(
      git(() => writeBlob({ ...source, blob: bytes })),
      (oid) => ObjectId.make(oid)
    );

  const tree = (entries: readonly TreeEntry[]) =>
    Effect.map(
      git(() =>
        writeTree({
          ...source,
          tree: entries.map(({ mode, name, sha, type }) => ({
            mode,
            oid: sha,
            path: name,
            type,
          })),
        })
      ),
      (oid) => ObjectId.make(oid)
    );

  const commit = (input: {
    readonly tree: ObjectId;
    readonly parents: readonly CommitSha[];
    readonly author: GitIdentity;
    readonly message: string;
    readonly at: number;
  }) =>
    Effect.map(
      git(() =>
        writeCommit({
          ...source,
          commit: {
            author: signed(input.author, input.at),
            committer: signed(committerLine, input.at),
            message: input.message,
            parent: [...input.parents],
            tree: input.tree,
          },
        })
      ),
      (oid) => CommitSha.make(oid)
    );

  /** A commit of one file holding `bytes` (or of nothing) on `parents`. */
  const fileCommit = (
    bytes: Option.Option<Uint8Array>,
    parents: readonly CommitSha[]
  ) =>
    Effect.gen(function* () {
      const files = yield* Option.match(bytes, {
        onNone: () => Effect.succeed([]),
        onSome: (content) =>
          Effect.map(blob(content), (sha) => [
            { mode: "100644", name: "file", sha, type: "blob" } as const,
          ]),
      });

      return yield* commit({
        at: 0,
        author: committerLine,
        message: "merge\n",
        parents,
        tree: yield* tree(files),
      });
    });

  /**
   * One file's three versions merged line by line, by isomorphic-git's
   * `merge` over a history of that file alone: the merged blob, or `None`
   * when the changes conflict.
   */
  const lines = (
    base: Option.Option<Uint8Array>,
    ours: Uint8Array,
    theirs: Uint8Array
  ) =>
    Effect.gen(function* () {
      const start = yield* fileCommit(base, []);

      const tips = {
        "refs/merge/ours": yield* fileCommit(Option.some(ours), [start]),
        "refs/merge/theirs": yield* fileCommit(Option.some(theirs), [start]),
      };

      yield* Effect.forEach(Object.entries(tips), ([ref, value]) =>
        git(() => writeRef({ ...source, force: true, ref, value }))
      );

      const merged = yield* Effect.tryPromise(() =>
        mergeHistories({
          ...source,
          abortOnConflict: true,
          author: signed(committerLine, 0),
          committer: signed(committerLine, 0),
          fastForward: false,
          message: "merge",
          noUpdateBranch: true,
          ours: "refs/merge/ours",
          theirs: "refs/merge/theirs",
        })
      ).pipe(
        Effect.map(({ tree: root }) => Option.fromNullishOr(root)),
        Effect.catchIf(
          ({ cause }) =>
            cause instanceof Errors.MergeConflictError ||
            cause instanceof Errors.MergeNotSupportedError,
          () => Effect.succeedNone
        ),
        Effect.orDie
      );

      if (Option.isNone(merged)) {
        return Option.none();
      }

      const { tree: entries } = yield* git(() =>
        readScratchTree({ ...source, oid: merged.value })
      );

      return Option.map(Option.fromNullishOr(entries[0]), ({ oid }) =>
        ObjectId.make(oid)
      );
    });

  return { blob, commit, lines, source, tree };
});

type Scratch = Effect.Success<typeof scratch>;

const isBinary = (bytes: Uint8Array) => bytes.subarray(0, SNIFF).includes(0);

const sameEntry = (one: TreeEntry | undefined, other: TreeEntry | undefined) =>
  one?.sha === other?.sha && one?.mode === other?.mode;

const isFile = (entry: TreeEntry | undefined) =>
  entry?.mode === "100644" || entry?.mode === "100755";

/** The folder an entry is, if it is one. */
const folderOf = (entry: TreeEntry | undefined) =>
  entry?.type === "tree" ? Option.some(entry.sha) : Option.none();

const byName = (entries: readonly TreeEntry[]) =>
  new Map(entries.map((entry) => [entry.name, entry]));

const entriesAt = (repo: RepoName, tree: Option.Option<ObjectId>) =>
  Option.match(tree, {
    onNone: () => Effect.succeed<readonly TreeEntry[]>([]),
    onSome: (id) => treeIn(repo, id),
  });

/** Where an answer's sides are read: main from canonical, base and head from the fork. */
interface Sides {
  readonly canonical: RepoName;
  readonly fork: RepoName;
}

/** A merged folder's entries, or the paths under it that conflict. */
interface MergedTree {
  readonly entries: readonly TreeEntry[];
  readonly conflicts: readonly string[];
}

const taken = (entry: TreeEntry | undefined): MergedTree => ({
  conflicts: [],
  entries: entry === undefined ? [] : [entry],
});

const conflict = (path: string): MergedTree => ({
  conflicts: [path],
  entries: [],
});

/**
 * Makes `theirs`, an entry the merge takes from the head, pushable: every
 * object under it that differs from the base's entry at its path is copied
 * from the fork into the scratch directory. What equals the base is already
 * in canonical, since the base is a commit on canonical's history.
 */
const adopt = (
  sides: Sides,
  into: Scratch,
  theirs: TreeEntry,
  base: TreeEntry | undefined
): Effect.Effect<void, VerifierBlocked, RepoHost> => {
  if (sameEntry(theirs, base) || theirs.type === "commit") {
    return Effect.void;
  }

  if (theirs.type === "blob") {
    return blobIn(sides.fork, theirs.sha).pipe(
      Effect.flatMap(into.blob),
      Effect.flatMap((made) => kept(theirs.sha, made))
    );
  }

  return Effect.gen(function* () {
    const children = yield* treeIn(sides.fork, theirs.sha);
    const before = byName(yield* entriesAt(sides.fork, folderOf(base)));

    yield* Effect.forEach(children, (child) =>
      adopt(sides, into, child, before.get(child.name))
    );
    yield* kept(theirs.sha, yield* into.tree(children));
  });
};

/** A file's mode once both sides changed it, unless they changed it differently. */
const mergedMode = (
  base: TreeEntry | undefined,
  ours: TreeEntry,
  theirs: TreeEntry
): Option.Option<TreeEntry["mode"]> => {
  if (ours.mode === theirs.mode || base?.mode === theirs.mode) {
    return Option.some(ours.mode);
  }

  return base?.mode === ours.mode ? Option.some(theirs.mode) : Option.none();
};

/** A file both sides changed, merged; `None` when the changes conflict. */
const mergeFile = (
  sides: Sides,
  into: Scratch,
  name: string,
  {
    base,
    ours,
    theirs,
  }: Record<"ours" | "theirs", TreeEntry> & {
    readonly base: TreeEntry | undefined;
  }
): Effect.Effect<Option.Option<TreeEntry>, VerifierBlocked, RepoHost> =>
  Effect.gen(function* () {
    const mode = mergedMode(base, ours, theirs);

    if (Option.isNone(mode)) {
      return Option.none();
    }

    const file = (sha: ObjectId): TreeEntry => ({
      mode: mode.value,
      name,
      sha,
      type: "blob",
    });

    if (ours.sha === theirs.sha || base?.sha === theirs.sha) {
      return Option.some(file(ours.sha));
    }

    if (base?.sha === ours.sha) {
      yield* adopt(sides, into, theirs, base);

      return Option.some(file(theirs.sha));
    }

    // Symlinks and submodules that both sides changed are not text to merge.
    if (!(isFile(ours) && isFile(theirs))) {
      return Option.none();
    }

    const [before, mine, yours] = yield* Effect.all([
      base !== undefined && isFile(base)
        ? Effect.asSome(blobIn(sides.fork, base.sha))
        : Effect.succeedNone,
      blobIn(sides.canonical, ours.sha),
      blobIn(sides.fork, theirs.sha),
    ]);

    if ([...Option.toArray(before), mine, yours].some(isBinary)) {
      return Option.none();
    }

    return Option.map(yield* into.lines(before, mine, yours), file);
  });

/**
 * Three folders merged by name. An entry only one side changed is taken from
 * that side; a folder both changed is merged inside; a file both changed is
 * merged line by line; anything else both changed conflicts.
 */
const mergeTrees = (
  sides: Sides,
  into: Scratch,
  prefix: string,
  trees: Record<"base" | "ours" | "theirs", Option.Option<ObjectId>>
): Effect.Effect<MergedTree, VerifierBlocked, RepoHost> =>
  Effect.gen(function* () {
    const [base, ours, theirs] = yield* Effect.all([
      Effect.map(entriesAt(sides.fork, trees.base), byName),
      Effect.map(entriesAt(sides.canonical, trees.ours), byName),
      Effect.map(entriesAt(sides.fork, trees.theirs), byName),
    ]);

    const names = Array.sort(
      new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]),
      Order.String
    );

    const merged = yield* Effect.forEach(
      names,
      (name): Effect.Effect<MergedTree, VerifierBlocked, RepoHost> => {
        const b = base.get(name);
        const o = ours.get(name);
        const t = theirs.get(name);
        const path = `${prefix}${name}`;

        if (sameEntry(o, t) || sameEntry(b, t)) {
          return Effect.succeed(taken(o));
        }

        if (sameEntry(b, o)) {
          return t === undefined
            ? Effect.succeed(taken(t))
            : Effect.as(adopt(sides, into, t, b), taken(t));
        }

        if (o?.type === "tree" && t?.type === "tree") {
          return Effect.gen(function* () {
            const inner = yield* mergeTrees(sides, into, `${path}/`, {
              base: folderOf(b),
              ours: Option.some(o.sha),
              theirs: Option.some(t.sha),
            });

            // Both sides emptied it, or something in it conflicts.
            if (inner.conflicts.length > 0 || inner.entries.length === 0) {
              return { conflicts: inner.conflicts, entries: [] };
            }

            const sha = yield* into.tree(inner.entries);

            return taken({ mode: "040000", name, sha, type: "tree" });
          });
        }

        if (o?.type === "blob" && t?.type === "blob") {
          return mergeFile(sides, into, name, {
            base: b?.type === "blob" ? b : undefined,
            ours: o,
            theirs: t,
          }).pipe(
            Effect.map(
              Option.match({
                onNone: () => conflict(path),
                onSome: taken,
              })
            )
          );
        }

        return Effect.succeed(conflict(path));
      }
    );

    return {
      conflicts: merged.flatMap(({ conflicts }) => conflicts),
      entries: merged.flatMap(({ entries }) => entries),
    };
  });

/**
 * The answer's head merged onto `main`, with the base as the merge base:
 * the merged root (written into `into`) and the base's and head's roots, or
 * `StaleBase` with every path that conflicts.
 */
const mergeOnto = (into: Scratch, job: MergeJob) =>
  Effect.gen(function* () {
    const [base, ours, theirs] = yield* Effect.all([
      commitIn(job.fork, job.base),
      commitIn(job.repo, job.main),
      commitIn(job.fork, job.head),
    ]);

    const merged = yield* mergeTrees(
      { canonical: job.repo, fork: job.fork },
      into,
      "",
      {
        base: Option.some(base.tree),
        ours: Option.some(ours.tree),
        theirs: Option.some(theirs.tree),
      }
    );

    if (merged.conflicts.length > 0) {
      return yield* new StaleBase({
        base: job.base,
        conflicts: merged.conflicts.map((path) => RepoPath.make(path)),
        main: job.main,
      });
    }

    return {
      base: TreeSha.make(base.tree),
      head: TreeSha.make(theirs.tree),
      tree: TreeSha.make(yield* into.tree(merged.entries)),
    };
  });

/** A file to place, by the folders and name its path is made of. */
interface Placed {
  readonly segments: readonly string[];
  readonly content: string;
}

/** A path's folders and file name; one that cannot name a file is a defect upstream. */
const placed = ({ content, path }: ComposedFile) => {
  const segments = path.split("/");

  return segments.every((segment) => !["", ".", "..", ".git"].includes(segment))
    ? Effect.succeed<Placed>({ content, segments })
    : Effect.die(`${path} cannot name a file in a repo`);
};

/**
 * `files` written into `repo`'s folder `tree` (or a new folder), folder by
 * folder, keeping every other entry: the new folder's id. A file where a
 * folder stands, or a folder where a file stands, is a defect upstream.
 */
const placeFiles = (
  repo: RepoName,
  into: Scratch,
  prefix: string,
  tree: Option.Option<ObjectId>,
  files: readonly Placed[]
): Effect.Effect<ObjectId, VerifierBlocked, RepoHost> =>
  Effect.gen(function* () {
    const entries = byName(yield* entriesAt(repo, tree));
    const groups = Array.groupBy(files, ({ segments }) => segments[0] ?? "");

    for (const [name, group] of Object.entries(groups)) {
      const existing = entries.get(name);
      const path = `${prefix}${name}`;
      const inside = group.filter(({ segments }) => segments.length > 1);
      const content = group.findLast(({ segments }) => segments.length === 1);

      if (content === undefined) {
        if (existing !== undefined && existing.type !== "tree") {
          return yield* Effect.die(
            `${path} cannot be both a file and a folder`
          );
        }

        const sha = yield* placeFiles(
          repo,
          into,
          `${path}/`,
          folderOf(existing),
          inside.map((file) => ({ ...file, segments: file.segments.slice(1) }))
        );

        entries.set(name, { mode: "040000", name, sha, type: "tree" });
      } else {
        if (
          inside.length > 0 ||
          (existing !== undefined && !isFile(existing))
        ) {
          return yield* Effect.die(
            `${path} cannot be both a file and a folder`
          );
        }

        entries.set(name, {
          mode: existing?.mode ?? "100644",
          name,
          sha: yield* into.blob(new TextEncoder().encode(content.content)),
          type: "blob",
        });
      }
    }

    return yield* into.tree([...entries.values()]);
  });

/** `main` with `files` added, written into `into`: the new root. */
const composeOnto = (
  into: Scratch,
  repo: RepoName,
  main: CommitSha,
  files: readonly ComposedFile[]
) =>
  Effect.gen(function* () {
    const commit = yield* commitIn(repo, main);
    const paths = yield* Effect.forEach(files, placed);

    return TreeSha.make(
      yield* placeFiles(repo, into, "", Option.some(commit.tree), paths)
    );
  });

/** The tree a land rebuilds, written into `into` where it is new. */
const rebuilt = (into: Scratch, job: LandJob) =>
  Rebuild.$match(job.rebuild, {
    Compose: ({ files }) => composeOnto(into, job.repo, job.main, files),
    Existing: ({ commit }) =>
      Effect.map(commitIn(job.repo, commit), ({ tree }) => TreeSha.make(tree)),
    Merge: ({ base, fork, head }) =>
      Effect.map(
        mergeOnto(into, { base, fork, head, main: job.main, repo: job.repo }),
        ({ tree }) => tree
      ),
  });

const requestIdOf = (message: string) =>
  parseTrailers(message).find(({ key }) => key.toLowerCase() === "request-id")
    ?.value;

const carriesRequest = (message: string, requestId: RequestId) =>
  requestIdOf(message) === requestId
    ? Effect.void
    : Effect.die(`a landing's message must carry Request-Id: ${requestId}`);

/**
 * The commit an earlier land of the same request put on `main`: a child of
 * the job's `main` carrying its `Request-Id`, on main's first parents.
 */
const landedBefore = (job: LandJob) =>
  Effect.gen(function* () {
    const history = yield* RepoHost.use((host) =>
      host.log(job.repo, Revision.Branch({ name: mainBranch }), LOOKBACK)
    ).pipe(unlessLost);

    const mine = Array.takeWhile(history, ({ sha }) => sha !== job.main).find(
      ({ message, parents }) =>
        parents[0] === job.main && requestIdOf(message) === job.requestId
    );

    return Option.fromNullishOr(mine?.sha);
  });

/** The mirror ref moved to the landing, while the landing is still main's tip. */
const mirror = (repo: RepoName, landing: CommitSha) =>
  Effect.gen(function* () {
    const refs = yield* refsIn(repo);
    const current = Option.fromNullishOr(refs.get(landedRef));

    // A later landing moved main on, and its own mirror supersedes this one.
    if (refs.get(mainRef) !== landing || Option.contains(current, landing)) {
      return;
    }

    const empty = yield* scratch;

    yield* moves(
      yield* pushOne(repo, empty.source, {
        from: current,
        ref: landedRef,
        to: landing,
      })
    );
  });

/** Whether the notes at `tip` already hold a note on `target`. */
const noted = (
  repo: RepoName,
  tip: Option.Option<CommitSha>,
  target: CommitSha
) =>
  Option.match(tip, {
    onNone: () => Effect.succeed(false),
    onSome: (sha) =>
      Effect.gen(function* () {
        const commit = yield* commitIn(repo, sha);
        const entries = yield* treeIn(repo, commit.tree);

        return entries.some(({ name }) => name === target);
      }),
  });

/** The verdict written as the landing's note, unless it is there already. */
const note = (repo: RepoName, landing: CommitSha, verdict: Verdict) =>
  Effect.gen(function* () {
    const refs = yield* refsIn(repo);
    const parent = Option.fromNullishOr(refs.get(notesRef));

    if (yield* noted(repo, parent, landing)) {
      return;
    }

    const { commit, source } = yield* noteCommit({
      notesParent: parent,
      now: yield* DateTime.now,
      repo,
      target: landing,
      verdict,
    });

    yield* moves(
      yield* pushOne(repo, source, { from: parent, ref: notesRef, to: commit })
    );
  });

/** One piece of bookkeeping: `None` once written, its name when it was not. */
const attempt = <E>(
  item: Bookkeeping,
  write: Effect.Effect<void, E, RepoHost>
) =>
  write.pipe(
    Effect.as(Option.none<Bookkeeping>()),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a landing's ${item} was not written`, cause),
        Option.some(item)
      )
    )
  );

/**
 * What follows a landing on `main`, in order and each in its own push: the
 * mirror ref, then the verdict note. Neither fails the landing; what was not
 * written comes back pending, and landing the same job again writes it.
 */
const settle = (job: LandJob, landing: CommitSha) =>
  Effect.gen(function* () {
    const mirrored = yield* attempt("mirror", mirror(job.repo, landing));

    const noteWritten = yield* Option.match(job.verdict, {
      onNone: () => Effect.succeedNone,
      onSome: (verdict) => attempt("notes", note(job.repo, landing, verdict)),
    });

    return {
      pending: Array.getSomes([mirrored, noteWritten]),
      sha: LandedSha.make(landing),
    };
  });

/** The base a stale land names: the answer's own, or the main it was built on. */
const baseOf = (job: LandJob) =>
  Rebuild.$match(job.rebuild, {
    Compose: () => job.main,
    Existing: () => job.main,
    Merge: ({ base }) => base,
  });

/** A land that found `main` at `tip`: the earlier land of the same request, or stale. */
const moved = (job: LandJob, tip: Option.Option<CommitSha>) =>
  Effect.gen(function* () {
    const earlier = yield* landedBefore(job);

    if (Option.isSome(earlier)) {
      return yield* settle(job, earlier.value);
    }

    return yield* new StaleBase({
      base: baseOf(job),
      conflicts: [],
      main: Option.getOrElse(tip, () => job.main),
    });
  });

const land = (job: LandJob) =>
  Effect.gen(function* () {
    yield* carriesRequest(job.message, job.requestId);

    const tip = Option.fromNullishOr((yield* refsIn(job.repo)).get(mainRef));

    if (!Option.contains(tip, job.main)) {
      return yield* moved(job, tip);
    }

    const into = yield* scratch;
    const tree = yield* rebuilt(into, job);

    if (tree !== job.tree) {
      return yield* blocked();
    }

    const commit = yield* into.commit({
      at: yield* seconds,
      author: authorLine(job.author),
      message: job.message,
      parents: [job.main],
      tree: ObjectId.make(tree),
    });

    // Never forced: if main moved since `job.main`, this push is refused.
    const outcome = yield* pushOne(job.repo, into.source, {
      from: Option.some(job.main),
      ref: mainRef,
      to: commit,
    }).pipe(
      Effect.catchTags({
        HostBusy: () => Effect.fail(new RepoBusy({})),
        RepoNotFound: () => Effect.fail(blocked()),
      })
    );

    return Option.exists(outcome, RefOutcome.$is("Updated"))
      ? yield* settle(job, commit)
      : yield* moved(
          job,
          Option.flatMap(outcome, (stale) =>
            RefOutcome.$is("Stale")(stale) ? stale.tip : Option.none()
          )
        );
  });

const compose = (job: ComposeJob) =>
  Effect.gen(function* () {
    const into = yield* scratch;
    const tree = yield* composeOnto(into, job.repo, job.main, job.files);
    const ref = composeRef(tree);
    const existing = Option.fromNullishOr((yield* refsIn(job.repo)).get(ref));

    // Composed before onto the same main: the commit a Checker already has.
    if (Option.isSome(existing)) {
      const before = yield* commitIn(job.repo, existing.value);

      if (
        before.tree === ObjectId.make(tree) &&
        before.parents[0] === job.main
      ) {
        return { commit: existing.value, tree };
      }
    }

    const commit = yield* into.commit({
      at: yield* seconds,
      author: committerLine,
      message: "Compose files onto main for a check\n",
      parents: [job.main],
      tree: ObjectId.make(tree),
    });

    yield* pushOne(job.repo, into.source, {
      from: existing,
      ref,
      to: commit,
    }).pipe(
      Effect.catchTags({
        HostBusy: () => Effect.fail(blocked()),
        RepoNotFound: () => Effect.fail(blocked()),
      }),
      Effect.flatMap(moves)
    );

    return { commit, tree };
  });

/** Every file under the folder `tree`, by repo path, as committed. */
const filesUnder = (
  repo: RepoName,
  tree: ObjectId,
  prefix: string
): Effect.Effect<
  readonly (readonly [string, string])[],
  VerifierBlocked,
  RepoHost
> =>
  Effect.gen(function* () {
    const entries = yield* treeIn(repo, tree);

    const nested = yield* Effect.forEach(entries, (entry) => {
      const path = `${prefix}${entry.name}`;

      if (entry.type === "tree") {
        return filesUnder(repo, entry.sha, `${path}/`);
      }

      return isFile(entry)
        ? Effect.map(blobIn(repo, entry.sha), (bytes) => [
            [path, new TextDecoder().decode(bytes)] as const,
          ])
        : Effect.succeed([]);
    });

    return nested.flat();
  });

/** The config folder in the root `root`, if the commit has one. */
const configFolder = (repo: RepoName, root: ObjectId) =>
  Effect.reduce(
    Brand.configDir.split("/"),
    (): Option.Option<ObjectId> => Option.some(root),
    (folder, segment) =>
      Option.match(folder, {
        onNone: () => Effect.succeedNone,
        onSome: (id) =>
          Effect.map(treeIn(repo, id), (entries) =>
            folderOf(entries.find(({ name }) => name === segment))
          ),
      })
  );

const bundleRules = (job: BundleJob) =>
  Effect.gen(function* () {
    const commit = yield* commitIn(job.repo, job.at);
    const folder = yield* configFolder(job.repo, commit.tree);

    const files = yield* Option.match(folder, {
      onNone: () => Effect.succeed([]),
      onSome: (tree) => filesUnder(job.repo, tree, `${Brand.configDir}/`),
    });

    return {
      entry: `${Brand.configDir}/project.ts`,
      modules: Object.fromEntries(files),
      sdkVersion,
    } satisfies ConfigBundle;
  });

const merge = (job: MergeJob) =>
  Effect.gen(function* () {
    const into = yield* scratch;
    const { base, head, tree } = yield* mergeOnto(into, job);

    // What the answer changed against its own base, not what main did.
    const changes = yield* treeDiff(job.fork, base, head).pipe(unlessLost);

    return { changes, tree };
  });

/** The Lander over isomorphic-git, reading and pushing through `RepoHost`. */
export const LanderIsogit: Layer.Layer<Lander, never, RepoHost> = Layer.effect(
  Lander,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const provided = Effect.provideService(RepoHost, host);

    return Lander.of({
      bundleRules: (job) => provided(bundleRules(job)),
      compose: (job) => provided(compose(job)),
      land: (job) => provided(land(job)),
      merge: (job) => provided(merge(job)),
    });
  })
);
