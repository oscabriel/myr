/**
 * The gate's facts for a push the CLI has not made yet: what `git push` of
 * HEAD would hand the gateway. The change list and the lines it adds come
 * from `@repo/git`'s `treeDiff` and `addedLines` over the working repo,
 * opened through `RepoHost` `/local` as the platform opens a fork, so the
 * local answer matches the gateway's by construction: no diff of its own.
 *
 * Nothing here writes to the working repo, its config or its refs: git runs
 * with optional locks off, and `/local` reads the repo's objects through a
 * link in a temp folder (or a temp bare copy, when the objects live in
 * another repo's store, which isomorphic-git cannot follow).
 */
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import type { PushFacts, PushTarget } from "@repo/gate/facts";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { CommitSha, RepoName, TreeSha } from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { NotARepo } from "../repo-context.ts";

/** A revision the repo does not have: a branch, tag or commit by that name. */
export class UnknownRevision extends Schema.TaggedError<UnknownRevision>()(
  "UnknownRevision",
  { revision: Schema.String, root: Schema.String }
) {
  override get message() {
    return `${this.root} has no commit ${this.revision}`;
  }
}

/** How a git command ended: its exit code and its output. */
export interface GitRan {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

// Reads only: git takes no optional lock (a read that would refresh the
// index leaves it as it is), and never asks for a password.
const readOnly = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

/** Runs git in `cwd` to its end; a failing git is a result, not an error. */
export const runGit = (
  cwd: string,
  args: readonly string[]
): Effect.Effect<GitRan, NotARepo, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd,
          env: readOnly,
          extendEnv: true,
          stdin: "ignore",
        })
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode: Number(exitCode), stderr, stdout };
    })
  ).pipe(Effect.catchTag("PlatformError", () => new NotARepo({ cwd })));

/** The commit `revision` names in the repo at `root`. */
export const commitOf = (root: string, revision: string) =>
  Effect.gen(function* () {
    const ran = yield* runGit(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);

    const sha = ran.stdout.trim();

    return ran.exitCode === 0 && Schema.is(CommitSha)(sha)
      ? sha
      : yield* new UnknownRevision({ revision, root });
  });

/** The commit `git diff <base>...<head>` starts from: their merge base. */
const mergeBase = (root: string, base: string, head: CommitSha) =>
  Effect.gen(function* () {
    const from = yield* commitOf(root, base);
    const ran = yield* runGit(root, ["merge-base", from, head]);
    const sha = ran.stdout.trim();

    return ran.exitCode === 0 && Schema.is(CommitSha)(sha)
      ? sha
      : yield* new UnknownRevision({ revision: `${base}...${head}`, root });
  });

/** A host that reaches nothing over the network: `/local` here reads disk only. */
const noNetwork = Layer.succeed(Fetch)({
  fetch: (request) =>
    Effect.fail(
      new FetchFailed({
        reason: "the local check makes no requests",
        url: request.url,
      })
    ),
});

/** The name `/local` knows the working repo by: `<temp>/<name>.git`. */
const WORKING = RepoName.make("working");

/** The name it knows a temp bare copy by. */
const COPY = RepoName.make("copy");

/** `RepoHost` `/local` over the repos in `folder`. */
const hostOver = (folder: string) =>
  RepoHostLocal.layer({ remoteBase: `file://${folder}`, root: folder }).pipe(
    Layer.provide(noNetwork)
  );

/** Whether `/local` can read every commit in `shas` from repo `name`. */
const readsAll = (name: RepoName, shas: readonly CommitSha[]) =>
  Effect.forEach(shas, (sha) =>
    RepoHost.use((host) => host.readCommit(name, sha))
  ).pipe(
    Effect.map((commits) => commits.every(Option.isSome)),
    Effect.catchTag("RepoNotFound", () => Effect.succeed(false))
  );

/** A repo `/local` can read: the host's layer, and the repo's name there. */
export interface Opened {
  readonly host: Layer.Layer<RepoHost>;
  readonly name: RepoName;
  /** How it was opened: a link to the repo's own store, or a temp bare copy. */
  readonly how: "link" | "copy";
}

/**
 * The working repo at `root`, opened through `RepoHost` `/local` for as long
 * as the scope lasts, holding `shas`. `/local` keeps each repo at
 * `<folder>/<name>.git`, so a temp folder gets a link of that name to the
 * repo's git store (its common dir, which a linked worktree shares). A
 * store that keeps its objects in another (`objects/info/alternates`, as a
 * `git clone --shared` does) is one isomorphic-git cannot read; then the
 * commits are fetched into a temp bare repo, which reads the working repo
 * and writes only the copy.
 */
export const openWorking = (
  root: string,
  shas: readonly CommitSha[]
): Effect.Effect<
  Opened,
  NotARepo,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const failed = () => new NotARepo({ cwd: root });

    const common = yield* runGit(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);

    if (common.exitCode !== 0) {
      return yield* failed();
    }

    const store = common.stdout.trim();

    const folder = yield* fs
      .makeTempDirectoryScoped({ prefix: "check-repo-" })
      .pipe(Effect.mapError(failed));

    const host = hostOver(folder);

    const borrows = yield* fs
      .exists(path.join(store, "objects", "info", "alternates"))
      .pipe(Effect.mapError(failed));

    if (!borrows) {
      yield* fs
        .symlink(store, path.join(folder, `${WORKING}.git`))
        .pipe(Effect.mapError(failed));

      if (yield* readsAll(WORKING, shas).pipe(Effect.provide(host))) {
        return { host, how: "link", name: WORKING } satisfies Opened;
      }
    }

    const copy = path.join(folder, `${COPY}.git`);
    const made = yield* runGit(folder, ["init", "--quiet", "--bare", copy]);

    const fetched = yield* runGit(copy, [
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      root,
      ...shas.map((sha, index) => `${sha}:refs/heads/at-${index}`),
    ]);

    if (made.exitCode !== 0 || fetched.exitCode !== 0) {
      return yield* failed();
    }

    return { host, how: "copy", name: COPY } satisfies Opened;
  });

/** What `localFacts` is told: the repo, the push, and what the project knows of it. */
export interface LocalFactsInput {
  /** The working repo's top folder. */
  readonly root: string;
  /** Where the answer starts: its diff runs from the merge base of `base` and `head`. */
  readonly base: string;
  /** The answer's commit, as git names it: `HEAD` for a local check. */
  readonly head: string;
  /** The policy at the landed SHA (`localPolicy`); `policy.at` is the landed SHA. */
  readonly policy: Policy;
  readonly ask: Option.Option<Ask>;
  readonly claim: Option.Option<ClaimView>;
  readonly pusher: Principal;
  /** Where the push would go: the claim's fork. */
  readonly target: PushTarget;
  /** How many live claims the pusher holds, for `CapReached`. */
  readonly claimsHeld: number;
}

/** The text of a blob, if the change has one on that side. */
const blobText = (name: RepoName, blob: string | undefined) =>
  blob === undefined
    ? Effect.succeedNone
    : RepoHost.use((host) => host.readBlob(name, ObjectId.make(blob))).pipe(
        Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes)))
      );

const ScriptsOf = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optionalKey(Schema.Json) })
);

const decodeScripts = Schema.decodeUnknownOption(ScriptsOf);

/** A manifest's `scripts` as JSON text, or `""` with no manifest or no JSON. */
const scriptsIn = (manifest: Option.Option<string>) =>
  Option.getOrElse(
    Option.map(Option.flatMap(manifest, decodeScripts), ({ scripts }) =>
      JSON.stringify(scripts ?? null)
    ),
    () => ""
  );

/**
 * Whether the root manifest's `scripts` differ across the change, compared
 * as the gateway's facts compare them (`@repo/project`'s `pushFacts`): the
 * gate's `package.json#/scripts` pointer reads this one bit.
 */
const scriptsChanged = (name: RepoName, changes: readonly Change[]) =>
  Option.match(
    Option.fromUndefinedOr(changes.find(({ path }) => path === "package.json")),
    {
      onNone: () => Effect.succeed(false),
      onSome: (change) =>
        Effect.map(
          Effect.all([
            blobText(name, change.before),
            blobText(name, change.after),
          ]),
          ([before, after]) => scriptsIn(before) !== scriptsIn(after)
        ),
    }
  );

/** A commit's root tree, through the port. */
const treeOf = (name: RepoName, sha: CommitSha) =>
  RepoHost.use((host) => host.readCommit(name, sha)).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.map(({ tree }) => TreeSha.make(tree)),
    Effect.orDie
  );

/**
 * The gate's facts for pushing `head` to `target`: the change list and the
 * lines it adds from the merge base of `base` and `head` (`git diff
 * base...head`), whether the root scripts moved, and what the caller knows
 * of the ask, the claim and the pusher. The ref is the fork's `main`, as a
 * claimant pushes it; no layer paths or ratchet counts yet, as on the
 * gateway.
 */
export const localFacts = (
  input: LocalFactsInput
): Effect.Effect<
  PushFacts,
  NotARepo | RepoNotFound | UnknownRevision,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const head = yield* commitOf(input.root, input.head);
      const base = yield* mergeBase(input.root, input.base, head);
      const opened = yield* openWorking(input.root, [base, head]);

      return yield* Effect.gen(function* () {
        const changes = yield* treeDiff(
          opened.name,
          yield* treeOf(opened.name, base),
          yield* treeOf(opened.name, head)
        );

        return {
          addedLines: yield* addedLines(opened.name, changes),
          ask: input.ask,
          base,
          changes,
          claim: input.claim,
          claimsHeld: input.claimsHeld,
          head,
          landed: input.policy.at,
          layerPaths: new Set(),
          opensAsk: false,
          policy: input.policy,
          pusher: input.pusher,
          ratchetCounts: new Map(),
          ref: RefNameText.make("refs/heads/main"),
          scriptsChanged: yield* scriptsChanged(opened.name, changes),
          target: input.target,
        } satisfies PushFacts;
      }).pipe(Effect.provide(opened.host));
    })
  );
