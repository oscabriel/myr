// The Lander checks nothing out and runs nothing from the trees it handles.
// Nothing pushes `main` with force, a lease or `--atomic`: a landing is a
// plain push, which git refuses when `main` moved.
import { Brand } from "@repo/brand";
import type { LandJob, Merged, MergeJob } from "@repo/project/lander/wire";
import { BlobSha, CommitSha, RepoPath, TreeSha } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { Array, Order } from "effect";
import type { Types } from "effect";

import type { Executed } from "../box.ts";

export type RemoteName = "main" | "fork";

export type Expect =
  | "ok"
  /** `merge-tree`: 0 is a clean merge, 1 a merge with conflicts. */
  | "merge"
  | "push"
  /** A question: a non-zero exit means "no". */
  | "probe";

export interface GitStep {
  readonly argv: Array.NonEmptyReadonlyArray<string>;
  /** Never a token. */
  readonly env?: Readonly<Record<string, string>>;
  readonly remote?: RemoteName;
  readonly expect: Expect;
}

export const mainCopy = "refs/lander/main";

export const forkCopy = (fork: RepoName) => `refs/lander/forks/${fork}`;

export const notesCopy = "refs/lander/notes";

export const composeCopy = "refs/lander/compose";

export const mainRef = "refs/heads/main";

/** Named by the tree, so a ref an answerer rewrote cannot change what is checked. */
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

/** Never shallow: Artifacts' receive-pack does not advertise `shallow`. */
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

/** The container's file writes make no folder on their own. */
export const folders = (
  paths: Array.NonEmptyReadonlyArray<string>
): GitStep => ({ argv: ["mkdir", "-p", "--", ...paths], expect: "ok" });

export const removeFolder = (folder: string): GitStep => ({
  argv: ["rm", "-rf", "--", folder],
  expect: "ok",
});

export const initCopy = (repo: RepoName): GitStep => ({
  argv: ["git", ...safety, "init", "--quiet", "--bare", copyOf(repo)],
  expect: "ok",
});

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

export const fetchFork = (
  repo: RepoName,
  fork: RepoName,
  url: string
): GitStep => ({
  argv: git(repo, ...fetch, url, `+refs/heads/*:${forkCopy(fork)}/*`),
  expect: "ok",
  remote: "fork",
});

/** `merge-tree --write-tree` needs git 2.40 or later. */
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

export const diffTree = (
  repo: RepoName,
  from: string,
  to: string
): GitStep => ({
  argv: git(repo, "diff-tree", "-r", "-z", "--no-renames", from, to),
  expect: "ok",
});

export interface MergeScript {
  readonly fetch: readonly GitStep[];
  readonly merge: GitStep;
  /** The answer's changes against its own base, not main's. */
  readonly changes: GitStep;
}

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

/** `lease` is only ever for a compose ref, never `main`. */
export const pushRef = (
  repo: RepoName,
  url: string,
  update: {
    readonly to: string;
    readonly ref: string;
    readonly lease?: string;
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

export interface LandScript {
  readonly main: GitStep;
  readonly mirror: GitStep;
}

export const landScript = (
  job: Pick<typeof LandJob.Type, "repo">,
  url: string,
  landing: CommitSha,
  mirror: string
): LandScript => ({
  main: pushRef(job.repo, url, { ref: mainRef, to: landing }),
  mirror: pushRef(job.repo, url, { ref: mirror, to: landing }),
});

export interface Signature {
  readonly name: string;
  readonly email: string;
  /** Seconds since the epoch, in UTC. */
  readonly at: number;
}

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

export const objectType = (repo: RepoName, rev: string): GitStep => ({
  argv: git(repo, "cat-file", "-t", rev),
  expect: "probe",
});

export const revParse = (repo: RepoName, rev: string): GitStep => ({
  argv: git(repo, "rev-parse", "--verify", "--quiet", rev),
  expect: "probe",
});

/** A file's bytes stored as a blob, exactly as written: no filter, no line endings. */
export const hashObject = (repo: RepoName, file: string): GitStep => ({
  argv: git(repo, "hash-object", "-w", "--no-filters", "--", file),
  expect: "ok",
});

export const readTree = (
  repo: RepoName,
  index: string,
  tree?: string
): GitStep => ({
  argv: git(repo, "read-tree", ...(tree === undefined ? ["--empty"] : [tree])),
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

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

export const writeTree = (repo: RepoName, index: string): GitStep => ({
  argv: git(repo, "write-tree"),
  env: { GIT_INDEX_FILE: index },
  expect: "ok",
});

/** Symlinks as plain files holding their target, so nothing written points outside. */
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

export const lsTree = (
  repo: RepoName,
  tree: string,
  paths: readonly string[]
): GitStep => ({
  argv: git(repo, "ls-tree", "-z", "--full-tree", tree, "--", ...paths),
  expect: "ok",
});

export const filesUnder = (
  repo: RepoName,
  tree: string,
  folder: string
): GitStep => ({
  argv: git(repo, "ls-tree", "-r", "-z", "--full-tree", tree, "--", folder),
  expect: "ok",
});

export const catBlob = (repo: RepoName, blob: string): GitStep => ({
  argv: git(repo, "cat-file", "blob", blob),
  expect: "ok",
});

export const fetchCommit = (
  repo: RepoName,
  url: string,
  commit: string
): GitStep => ({
  argv: git(repo, ...fetch, url, commit),
  expect: "ok",
  remote: "main",
});

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

export const lsRemote = (
  repo: RepoName,
  url: string,
  ref: string
): GitStep => ({
  argv: git(repo, "ls-remote", url, ref),
  expect: "ok",
  remote: "main",
});

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

const SCRIPT = /\.[cm]?[jt]sx?$/u;

const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

export const configEntry = `${Brand.configDir}/project.ts`;

export const isScript = (path: string) => SCRIPT.test(path);

const visibilityEntry = `${Brand.configDir}/visibility.ts`;

export const bundleEntries = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      path === configEntry ||
      path === visibilityEntry ||
      (path.startsWith(`${Brand.configDir}/asks/`) && ASK_FILE.test(path))
  );

export const bundledAs = (entry: string) => entry.replace(/\.[^./]*$/u, ".js");

/** Bare imports resolve beside the sdk's copy, so `effect` is the sdk's own. */
export const resolution = (sdk: string) =>
  `${JSON.stringify(
    {
      compilerOptions: {
        paths: Object.fromEntries(
          [...Brand.sdkImports, "@repo/sdk"].map((name) => [name, [sdk]])
        ),
      },
    },
    null,
    2
  )}\n`;

export const symlink = (target: string, link: string): GitStep => ({
  argv: ["ln", "-s", "--", target, link],
  expect: "ok",
});

/** Macros are off, so no code in the folder runs while it is bundled. */
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

export const listFiles = (folder: string): GitStep => ({
  argv: ["find", folder, "-type", "f", "-printf", "%P\\0"],
  expect: "ok",
});

export const readFile = (file: string): GitStep => ({
  argv: ["cat", "--", file],
  expect: "ok",
});

const fields = (text: string) => text.split("\0").filter((part) => part !== "");

export const readMerge = (stdout: string) => {
  const [tree = "", ...conflicts] = fields(stdout);

  return {
    conflicts: Array.sort(new Set(conflicts), Order.String).map((path) =>
      RepoPath.make(path)
    ),
    tree: TreeSha.make(tree.trim()),
  };
};

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

const RAW =
  /^:\d+ \d+ (?<before>[0-9a-f]+) (?<after>[0-9a-f]+) (?<letter>[A-Z])/u;

type Changed = (typeof Merged.Type)["changes"][number];

/** A submodule's pointer counts as a file, as `@repo/git/tree-diff` reads them. */
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

export interface Logged {
  readonly sha: CommitSha;
  readonly parents: readonly CommitSha[];
  readonly message: string;
}

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

export const readEntries = (stdout: string) =>
  new Map(
    fields(stdout).map((line) => {
      const tab = line.indexOf("\t");
      const [mode = "", , sha = ""] = line.slice(0, tab).split(" ");

      return [line.slice(tab + 1), { mode, sha }] as const;
    })
  );

export const readFiles = (stdout: string) => fields(stdout);

export const readRemoteRef = (stdout: string) => {
  const [line = ""] = stdout.split("\n");
  const [sha = ""] = line.split("\t");

  return sha === "" ? undefined : CommitSha.make(sha);
};

export type Pushed =
  | "moved"
  | "stale"
  /** Artifacts was busy with another push to the repo; retryable. */
  | "busy"
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
