/**
 * The Lander's git, as data: each step is one git command, the remote it
 * reaches (whose token `run.ts` hands git in its env, never on its command
 * line), and how its exit reads. Pure, so the script is read and tested
 * without a container; `run.ts` runs it through the `Box` port and reads
 * what git printed with the parsers below.
 *
 * Every step runs git with hooks pointed at `/dev/null`, no credential
 * helper, no redirects and no automatic maintenance, in a bare repo: the
 * Lander checks nothing out and runs nothing from the trees it handles.
 * Nothing here pushes with force, `--force-with-lease` or `--atomic` to
 * `main`: a landing is a plain push, which git refuses when
 * `main` moved, and only a compose ref, never `main`, moves by a lease. A
 * merge pushes one ref, to the answer's fork alone: the merged commit, for
 * the Checker to fetch.
 */
import { Brand } from "@repo/brand";
import type { LandJob, Merged, MergeJob } from "@repo/project/lander/wire";
import { BlobSha, CommitSha, RepoPath, TreeSha } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { Array, Order } from "effect";
import type { Types } from "effect";

import type { Executed } from "../box.ts";

/** Which of a job's remotes a step reaches. */
export type RemoteName = "main" | "fork";

/** How a step's exit reads. */
export type Expect =
  /** Exit 0, or the job is blocked. */
  | "ok"
  /** `merge-tree`: 0 is a clean merge, 1 a merge with conflicts. */
  | "merge"
  /** A push: what git printed says whether the ref moved, and why not. */
  | "push"
  /** A question: a non-zero exit means "no". */
  | "probe";

/** One command: git, or a tool beside it in the image (`mkdir`, `bun`, `cat`). */
export interface GitStep {
  readonly argv: Array.NonEmptyReadonlyArray<string>;
  /** Env git needs for this step alone: identities, an index file. Never a token. */
  readonly env?: Readonly<Record<string, string>>;
  /** The remote this step reaches; git gets its token as a header, through env. */
  readonly remote?: RemoteName;
  readonly expect: Expect;
}

/** Where canonical `main` is kept in the Lander's copy. */
export const mainCopy = "refs/lander/main";

/** Where a fork's branches are kept in the Lander's copy. */
export const forkCopy = (fork: RepoName) => `refs/lander/forks/${fork}`;

/** Where canonical's notes refs are kept in the Lander's copy. */
export const notesCopy = "refs/lander/notes";

/** Where a compose ref already on canonical is kept in the Lander's copy. */
export const composeCopy = "refs/lander/compose";

/** The canonical branch a landing moves. */
export const mainRef = "refs/heads/main";

/**
 * Where a merged commit waits, in the answer's fork, for a Checker to fetch
 * its tree: named by the tree, so a ref an answerer rewrote cannot change
 * what is checked (at worst the Checker finds no such tree).
 */
export const mergeRef = (tree: string) => `${Brand.refsPrefix}merge/${tree}`;

// Each git command: no hooks, no helper that could see a token, no redirect
// a header could follow, and nothing running in the background.
const safety = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "credential.helper=",
  "-c",
  "http.followRedirects=false",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
] as const;

/**
 * The Lander's copy of a canonical repo, relative to its work folder: one
 * bare repo per project, kept between jobs so a fetch brings only what is
 * new. It is never shallow, so a push from it sends no `shallow` lines,
 * which Artifacts' receive-pack does not advertise.
 */
export const copyOf = (repo: RepoName) => `repos/${repo}.git`;

const git = (
  repo: RepoName,
  ...args: readonly string[]
): Array.NonEmptyReadonlyArray<string> => [
  "git",
  ...safety,
  `--git-dir=${copyOf(repo)}`,
  ...args,
];

const fetch = ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head"];

/**
 * The folders a job writes in, made if they are missing: the container's
 * file writes, like the Sandbox SDK's, make no folder on their own.
 */
export const folders = (
  paths: Array.NonEmptyReadonlyArray<string>
): GitStep => ({ argv: ["mkdir", "-p", "--", ...paths], expect: "ok" });

/** A folder and everything in it gone, if it was there. */
export const removeFolder = (folder: string): GitStep => ({
  argv: ["rm", "-rf", "--", folder],
  expect: "ok",
});

/** The Lander's copy of `repo`, made if it is missing; making it again changes nothing. */
export const initCopy = (repo: RepoName): GitStep => ({
  argv: ["git", ...safety, "init", "--quiet", "--bare", copyOf(repo)],
  expect: "ok",
});

/**
 * Canonical `main` fetched into the copy, with its notes refs when a landing
 * needs them (`--prune` drops a notes ref canonical no longer has).
 */
export const fetchMain = (
  repo: RepoName,
  url: string,
  options: { readonly notes?: boolean } = {}
): GitStep => ({
  argv: git(
    repo,
    ...fetch,
    ...(options.notes === true ? ["--prune"] : []),
    url,
    `+${mainRef}:${mainCopy}`,
    ...(options.notes === true ? [`+refs/notes/*:${notesCopy}/*`] : [])
  ),
  expect: "ok",
  remote: "main",
});

/** Every branch of the answer's fork, fetched into the copy. */
export const fetchFork = (
  repo: RepoName,
  fork: RepoName,
  url: string
): GitStep => ({
  argv: git(repo, ...fetch, url, `+refs/heads/*:${forkCopy(fork)}/*`),
  expect: "ok",
  remote: "fork",
});

/**
 * The answer's head merged onto `main` with its own base as the merge base,
 * by `git merge-tree --write-tree` (git 2.40 or later): no worktree, no
 * checkout. It prints the merged tree, then each conflicting path.
 */
export const mergeTree = (
  repo: RepoName,
  sides: { readonly base: string; readonly main: string; readonly head: string }
): GitStep => ({
  argv: git(
    repo,
    "merge-tree",
    "--write-tree",
    "-z",
    "--name-only",
    "--no-messages",
    `--merge-base=${sides.base}`,
    sides.main,
    sides.head
  ),
  expect: "merge",
});

/** What changed from `from` to `to`, path by path, with blob ids. */
export const diffTree = (
  repo: RepoName,
  from: string,
  to: string
): GitStep => ({
  argv: git(repo, "diff-tree", "-r", "-z", "--no-renames", from, to),
  expect: "ok",
});

/** A merge as git runs it, in order. */
export interface MergeScript {
  /** Canonical `main` and every branch of the fork, into the Lander's copy. */
  readonly fetch: readonly GitStep[];
  readonly merge: GitStep;
  /** The answer's changes against its own base, not main's. */
  readonly changes: GitStep;
}

/** A merge's fetches and merge; it writes nothing to canonical. */
export const mergeScript = (
  job: typeof MergeJob.Type,
  remotes: { readonly main: string; readonly fork: string }
): MergeScript => ({
  changes: diffTree(job.repo, job.base, job.head),
  fetch: [
    initCopy(job.repo),
    fetchMain(job.repo, remotes.main),
    fetchFork(job.repo, job.fork, remotes.fork),
  ],
  merge: mergeTree(job.repo, job),
});

/**
 * One push of one ref, from the copy. `lease` makes it a compare-and-swap on
 * a ref that may move to a commit that does not descend from it: only ever
 * a compose ref.
 */
export const pushRef = (
  repo: RepoName,
  url: string,
  update: {
    readonly to: string;
    readonly ref: string;
    readonly lease?: string;
    /** The remote it reaches: canonical, unless it is the fork. */
    readonly remote?: RemoteName;
  }
): GitStep => ({
  argv: git(
    repo,
    "push",
    "--porcelain",
    "--no-verify",
    ...(update.lease === undefined
      ? []
      : [`--force-with-lease=${update.ref}:${update.lease}`]),
    url,
    `${update.to}:${update.ref}`
  ),
  expect: "push",
  remote: update.remote ?? "main",
});

/** The two pushes of a landing. */
export interface LandScript {
  /** The landing onto canonical `main`. */
  readonly main: GitStep;
  /** The mirror ref onto the landing, once `main` moved. */
  readonly mirror: GitStep;
}

/**
 * The two pushes of a landing, in order and each alone: `landing` onto
 * canonical `main`, a plain push that git refuses when `main` is no longer
 * the landing's parent; then, once it moved, the mirror ref (ADR 0005).
 */
export const landScript = (
  job: Pick<typeof LandJob.Type, "repo">,
  url: string,
  landing: CommitSha,
  mirror: string
): LandScript => ({
  main: pushRef(job.repo, url, { ref: mainRef, to: landing }),
  mirror: pushRef(job.repo, url, { ref: mirror, to: landing }),
});

/** One git identity at one moment, as git's env spells it. */
export interface Signature {
  readonly name: string;
  readonly email: string;
  /** Seconds since the epoch, in UTC. */
  readonly at: number;
}

/** A commit of `tree` on `parents`, with its message from a file, as its people sign it. */
export const commitTree = (
  repo: RepoName,
  commit: {
    readonly tree: string;
    readonly parents: readonly string[];
    readonly messageFile: string;
    readonly author: Signature;
    readonly committer: Signature;
  }
): GitStep => ({
  argv: git(
    repo,
    "commit-tree",
    commit.tree,
    ...commit.parents.flatMap((parent) => ["-p", parent]),
    "-F",
    commit.messageFile
  ),
  env: {
    GIT_AUTHOR_DATE: `@${commit.author.at} +0000`,
    GIT_AUTHOR_EMAIL: commit.author.email,
    GIT_AUTHOR_NAME: commit.author.name,
    GIT_COMMITTER_DATE: `@${commit.committer.at} +0000`,
    GIT_COMMITTER_EMAIL: commit.committer.email,
    GIT_COMMITTER_NAME: commit.committer.name,
  },
  expect: "ok",
});

/** Whether `rev` names an object in the copy; it prints the object's type. */
export const objectType = (repo: RepoName, rev: string): GitStep => ({
  argv: git(repo, "cat-file", "-t", rev),
  expect: "probe",
});

/** One revision's id in the copy. */
export const revParse = (repo: RepoName, rev: string): GitStep => ({
  argv: git(repo, "rev-parse", "--verify", "--quiet", rev),
  expect: "probe",
});

/** A file's bytes stored as a blob, exactly as written: no filter, no line endings. */
export const hashObject = (repo: RepoName, file: string): GitStep => ({
  argv: git(repo, "hash-object", "-w", "--no-filters", "--", file),
  expect: "ok",
});

/** An index file loaded with `tree`, or emptied when there is none. */
export const readTree = (
  repo: RepoName,
  index: string,
  tree?: string
): GitStep => ({
  argv: git(repo, "read-tree", ...(tree === undefined ? ["--empty"] : [tree])),
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

/** Blobs placed in an index file at their paths, with their modes. */
export const updateIndex = (
  repo: RepoName,
  index: string,
  entries: readonly {
    readonly mode: string;
    readonly blob: string;
    readonly path: string;
  }[]
): GitStep => ({
  argv: git(
    repo,
    "update-index",
    "--add",
    ...entries.flatMap(({ blob, mode, path }) => [
      "--cacheinfo",
      `${mode},${blob},${path}`,
    ])
  ),
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

/** The tree an index file holds, written to the copy. */
export const writeTree = (repo: RepoName, index: string): GitStep => ({
  argv: git(repo, "write-tree"),
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

/**
 * An index file's files written under `folder`, symlinks as plain files
 * holding their target, so nothing written points outside it.
 */
export const checkoutIndex = (
  repo: RepoName,
  index: string,
  folder: string
): GitStep => ({
  argv: [
    "git",
    ...safety,
    "-c",
    "core.symlinks=false",
    `--git-dir=${copyOf(repo)}`,
    `--work-tree=${folder}`,
    "checkout-index",
    "--all",
    "--force",
  ],
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

/** The modes and ids of `paths` in `tree`, those that are there. */
export const lsTree = (
  repo: RepoName,
  tree: string,
  paths: readonly string[]
): GitStep => ({
  argv: git(repo, "ls-tree", "-z", "--full-tree", tree, "--", ...paths),
  expect: "ok",
});

/** Every file under `folder` in `tree`, at any depth, with its mode and id. */
export const filesUnder = (
  repo: RepoName,
  tree: string,
  folder: string
): GitStep => ({
  argv: git(repo, "ls-tree", "-r", "-z", "--full-tree", tree, "--", folder),
  expect: "ok",
});

/** A blob's bytes, printed. */
export const catBlob = (repo: RepoName, blob: string): GitStep => ({
  argv: git(repo, "cat-file", "blob", blob),
  expect: "ok",
});

/** One commit fetched from canonical by its id, into the copy's objects. */
export const fetchCommit = (
  repo: RepoName,
  url: string,
  commit: string
): GitStep => ({
  argv: git(repo, ...fetch, url, commit),
  expect: "ok",
  remote: "main",
});

/** The commits from `tip` back along first parents, at most `count`. */
export const firstParents = (
  repo: RepoName,
  tip: string,
  count: number
): GitStep => ({
  argv: git(
    repo,
    "log",
    "--first-parent",
    `--max-count=${count}`,
    "-z",
    "--format=%H %P%n%B",
    tip
  ),
  expect: "ok",
});

/** A ref's id on a remote, if it has the ref. */
export const lsRemote = (
  repo: RepoName,
  url: string,
  ref: string
): GitStep => ({
  argv: git(repo, "ls-remote", url, ref),
  expect: "ok",
  remote: "main",
});

/** A ref fetched from canonical into `into` in the copy. */
export const fetchRef = (
  repo: RepoName,
  url: string,
  ref: string,
  into: string
): GitStep => ({
  argv: git(repo, ...fetch, url, `+${ref}:${into}`),
  expect: "ok",
  remote: "main",
});

// --------------------------------------------------------------- bundling

// A module that runs: what the rules evaluator imports, and what a bundle inlines.
const SCRIPT = /\.[cm]?[jt]sx?$/u;

// An ask file, as `@repo/rules` finds one: `<id>.ask.ts`, or its JavaScript.
const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

/**
 * The config folder's project module, which a bundle names whether or not
 * the folder has one (`ConfigBundle.entry`).
 */
export const configEntry = `${Brand.configDir}/project.ts`;

/** Whether a file in the config folder is code, which a bundle carries only inlined. */
export const isScript = (path: string) => SCRIPT.test(path);

/** The config folder's visibility module: its layers and held-back checks. */
const visibilityEntry = `${Brand.configDir}/visibility.ts`;

/**
 * The modules the rules evaluator imports, each bundled on its own: the
 * project module, the visibility module and every ask file. Other code in
 * the folder (helpers, an ask's check) is inlined where an entry imports
 * it, or left out.
 */
export const bundleEntries = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      path === configEntry ||
      path === visibilityEntry ||
      (path.startsWith(`${Brand.configDir}/asks/`) && ASK_FILE.test(path))
  );

/** Where bun writes an entry's bundle: its path, as JavaScript. */
export const bundledAs = (entry: string) => entry.replace(/\.[^./]*$/u, ".js");

/**
 * How the config folder's imports resolve: both names of the sdk (its
 * workspace name and the published `<cli package>/rules`) to the image's
 * copy. Anything else bare resolves in the packages beside that copy, so
 * `effect` is the sdk's own.
 */
export const resolution = (sdk: string) =>
  `${JSON.stringify(
    {
      compilerOptions: {
        paths: { [`${Brand.cliPackage}/rules`]: [sdk], "@repo/sdk": [sdk] },
      },
    },
    null,
    2
  )}\n`;

/** A symlink at `link` to `target`. */
export const symlink = (target: string, link: string): GitStep => ({
  argv: ["ln", "-s", "--", target, link],
  expect: "ok",
});

/**
 * The entries bundled by bun, for a browser-like runtime as ES modules:
 * code the entries share goes to chunks in the config folder, and every
 * import resolves as `tsconfig` (written by `resolution`) says. Macros are
 * off, so no code in the folder runs while it is bundled.
 */
export const bundle = (input: {
  readonly root: string;
  readonly out: string;
  readonly tsconfig: string;
  readonly entries: Array.NonEmptyReadonlyArray<string>;
}): GitStep => ({
  argv: [
    "bun",
    "build",
    "--no-macros",
    "--target=browser",
    "--format=esm",
    "--splitting",
    `--root=${input.root}`,
    `--outdir=${input.out}`,
    `--tsconfig-override=${input.tsconfig}`,
    "--entry-naming=[dir]/[name].[ext]",
    `--chunk-naming=${Brand.configDir}/chunk-[hash].[ext]`,
    ...input.entries.map((entry) => `${input.root}/${entry}`),
  ],
  expect: "ok",
});

/** Every file under `folder`, by its path from there. */
export const listFiles = (folder: string): GitStep => ({
  argv: ["find", folder, "-type", "f", "-printf", "%P\\0"],
  expect: "ok",
});

/** One file's bytes, printed. */
export const readFile = (file: string): GitStep => ({
  argv: ["cat", "--", file],
  expect: "ok",
});

// ------------------------------------------------------------------ reading

const fields = (text: string) => text.split("\0").filter((part) => part !== "");

/** What `merge-tree` printed: the merged tree, and the paths that conflict, sorted. */
export const readMerge = (stdout: string) => {
  const [tree = "", ...conflicts] = fields(stdout);

  return {
    conflicts: Array.sort(new Set(conflicts), Order.String).map((path) =>
      RepoPath.make(path)
    ),
    tree: TreeSha.make(tree.trim()),
  };
};

/** A change's status, as a merge reports it. */
type Status = (typeof Merged.Type)["changes"][number]["status"];

/** A raw diff's status letter as a change's status; a type change is a modification. */
const statusOf = (letter: string): Status | undefined => {
  switch (letter) {
    case "A": {
      return "added";
    }

    case "D": {
      return "deleted";
    }

    case "M":
    case "T": {
      return "modified";
    }

    default: {
      return undefined;
    }
  }
};

// An object id of zeros: no object, on the side of a change that has none.
const NO_OBJECT = /^0+$/u;

// A raw diff line's head: both modes, both blob ids, and the status letter.
const RAW =
  /^:\d+ \d+ (?<before>[0-9a-f]+) (?<after>[0-9a-f]+) (?<letter>[A-Z])/u;

/** One change as a merge reports it. */
type Changed = (typeof Merged.Type)["changes"][number];

/**
 * What `diff-tree -r -z --no-renames` printed, as changes in path order: a
 * file that changed type is modified, and a submodule's pointer counts as a
 * file, as `@repo/git/tree-diff` reads them.
 */
export const readChanges = (stdout: string) =>
  Array.chunksOf(fields(stdout), 2).flatMap(([meta, path = ""]) => {
    const raw = RAW.exec(meta)?.groups;
    const status = statusOf(raw?.letter ?? "");

    if (raw === undefined || status === undefined) {
      return [];
    }

    const change: Types.Mutable<Changed> = {
      path: RepoPath.make(path),
      status,
    };

    if (raw.before !== undefined && !NO_OBJECT.test(raw.before)) {
      change.before = BlobSha.make(raw.before);
    }

    if (raw.after !== undefined && !NO_OBJECT.test(raw.after)) {
      change.after = BlobSha.make(raw.after);
    }

    return [change];
  });

/** One commit as `firstParents` prints it. */
export interface Logged {
  readonly sha: CommitSha;
  readonly parents: readonly CommitSha[];
  readonly message: string;
}

/** What `firstParents` printed. */
export const readLog = (stdout: string): readonly Logged[] =>
  fields(stdout).map((record) => {
    const newline = record.indexOf("\n");
    const head = newline === -1 ? record : record.slice(0, newline);
    const [sha = "", ...parents] = head.split(" ").filter((id) => id !== "");

    return {
      message: newline === -1 ? "" : record.slice(newline + 1),
      parents: parents.map((parent) => CommitSha.make(parent)),
      sha: CommitSha.make(sha),
    };
  });

/** What `lsTree` printed: each path's mode and id. */
export const readEntries = (stdout: string) =>
  new Map(
    fields(stdout).map((line) => {
      const tab = line.indexOf("\t");
      const [mode = "", , sha = ""] = line.slice(0, tab).split(" ");

      return [line.slice(tab + 1), { mode, sha }] as const;
    })
  );

/** What `listFiles` printed: each file's path. */
export const readFiles = (stdout: string) => fields(stdout);

/** What `lsRemote` printed: the ref's id, when the remote has it. */
export const readRemoteRef = (stdout: string) => {
  const [line = ""] = stdout.split("\n");
  const [sha = ""] = line.split("\t");

  return sha === "" ? undefined : CommitSha.make(sha);
};

/** How a push came out. */
export type Pushed =
  /** The ref now points where the push said, or already did. */
  | "moved"
  /** The ref was not where the push expected: someone else moved it first. */
  | "stale"
  /** Artifacts was busy with another push to the repo; retryable. */
  | "busy"
  /** Anything else. */
  | "failed";

// git's words for a push the ref's current value refused: a client-side
// fast-forward check (`fetch first`, `non-fast-forward`, `stale info` for a
// lease), git receive-pack's compare-and-swap (`incorrect old value
// provided`, git 2.56), and Artifacts' (`stale ref`).
const STALE =
  /fetch first|non-fast-forward|stale info|incorrect old value|stale ref/u;

const BUSY = "artifacts_git_receive_pack_busy";

// A porcelain line: the flag, `from:to`, and the summary.
const PORCELAIN = /^(?<flag>.)\t(?<refs>[^\t]*)\t(?<summary>.*)$/u;

/** How the push of `ref` came out, from what git printed with `--porcelain`. */
export const readPush = (ran: Executed, ref: string): Pushed => {
  if (`${ran.stdout}\n${ran.stderr}`.includes(BUSY)) {
    return "busy";
  }

  const line = ran.stdout
    .split("\n")
    .map((text) => PORCELAIN.exec(text)?.groups)
    .find((groups) => groups?.refs?.endsWith(`:${ref}`) === true);

  if (line === undefined) {
    return "failed";
  }

  if (ran.exitCode === 0 && [" ", "*", "="].includes(line.flag ?? "")) {
    return "moved";
  }

  return line.flag === "!" && STALE.test(line.summary ?? "")
    ? "stale"
    : "failed";
};
