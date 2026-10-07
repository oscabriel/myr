/**
 * The Lander's jobs, run through the `Box` port: each runs `script.ts`'s
 * git steps in the container and reads what git printed. A step that
 * reaches a remote gets that remote's token as an `http.extraHeader`
 * through `GIT_CONFIG_*` env, never in its URL or on its command line. A
 * step that fails blocks the job with `VerifierBlocked`, which carries no
 * text (principle 3): git's stderr goes beside it, as a log annotation,
 * trimmed and with every token taken out.
 */
import { Brand } from "@repo/brand";
import { notesRef } from "@repo/git/notes";
import { authorLine, committerLine, parseTrailers } from "@repo/git/trailers";
import type { GitIdentity } from "@repo/git/trailers";
import { Rebuild } from "@repo/project/lander/wire";
import type {
  BundleWire,
  ComposeWire,
  Landed,
  LandWire,
  MergeWire,
} from "@repo/project/lander/wire";
import { Verdict } from "@repo/protocol/domain/answer";
import { CommitSha, LandedSha, TreeSha } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import {
  Array,
  Clock,
  Context,
  Effect,
  Option,
  Redacted,
  Schema,
} from "effect";

import { Box } from "../box.ts";
import type { Executed } from "../box.ts";
import {
  bundle,
  bundledAs,
  bundleEntries,
  catBlob,
  checkoutIndex,
  commitTree,
  composeCopy,
  configEntry,
  fetchCommit,
  fetchFork,
  fetchMain,
  fetchRef,
  filesUnder,
  folders,
  firstParents,
  hashObject,
  initCopy,
  isScript,
  landScript,
  listFiles,
  lsRemote,
  lsTree,
  mainCopy,
  mainRef,
  mergeRef,
  mergeScript,
  mergeTree,
  notesCopy,
  objectType,
  pushRef,
  readChanges,
  readEntries,
  readFile,
  readFiles,
  readLog,
  readMerge,
  readPush,
  readRemoteRef,
  readTree,
  removeFolder,
  resolution,
  revParse,
  symlink,
  updateIndex,
  writeTree,
} from "./script.ts";
import type { GitStep, RemoteName, Signature } from "./script.ts";

/** Where the Lander's container keeps things, and finds its tools. */
export interface LanderLayout {
  /** The folder its repos and scratch files live in. */
  readonly work: string;
  /**
   * The image's copy of the sdk, which a config folder's imports of the sdk
   * resolve to: its entry module, the packages its own imports resolve in
   * (`effect` among them), and a file naming its version.
   */
  readonly sdk: {
    readonly entry: string;
    readonly modules: string;
    readonly version: string;
  };
  /** Where commands are looked up. */
  readonly path: string;
}

/** The land image's layout (`images/land.Dockerfile`); tests point it at a temp folder. */
export const Layout = Context.Reference<LanderLayout>("sandbox/lander/Layout", {
  defaultValue: () => ({
    path: "/usr/local/bin:/usr/bin:/bin",
    sdk: {
      entry: "/opt/sdk/node_modules/@repo/sdk/src/index.ts",
      modules: "/opt/sdk/node_modules",
      version: "/opt/sdk/version",
    },
    work: "/workspace",
  }),
});

/** The tokens a job carries, by the remote each opens. */
type Tokens = Partial<Record<RemoteName, Redacted.Redacted>>;

// The modes git stores a file's bytes under, plain or executable: a file a
// composed file may replace, and a file a bundle may read.
const FILE_MODES = new Set(["100644", "100755"]);

// How much of git's stderr a log keeps: its end, where git says what broke.
const STDERR_KEPT = 2000;

// A step that reaches a remote may take a while; a local one should not.
const REMOTE_MS = 120_000;

const LOCAL_MS = 30_000;

/** `text` with every token taken out, and only its end kept. */
const scrubbed = (text: string, tokens: Tokens) => {
  let kept = text;

  for (const token of Object.values(tokens)) {
    const secret = Redacted.value(token);

    if (secret !== "") {
      kept = kept.replaceAll(secret, "[token]");
    }
  }

  return kept.trim().slice(-STDERR_KEPT);
};

/** git's subcommand in a step, for logs: the first argument after its options. */
const subcommandOf = (step: GitStep) =>
  step.argv.find(
    (argument, index) =>
      index > 0 && !argument.startsWith("-") && step.argv[index - 1] !== "-c"
  ) ?? "git";

/**
 * The job is blocked at `step` (a git subcommand, or the Box operation); what
 * went wrong goes to the log, token-free, never into the refusal.
 */
const blockedBy = (step: string, why: string, tokens: Tokens) =>
  Effect.logWarning("a Lander step failed").pipe(
    Effect.annotateLogs({ step, why: scrubbed(why, tokens) }),
    Effect.andThen(Effect.fail(new VerifierBlocked({})))
  );

/** Everything a command printed, for a log: its exit, then stdout and stderr. */
const printed = (ran: Executed) =>
  `exit ${ran.exitCode}: ${ran.stdout}\n${ran.stderr}`;

/** git's env for every step: no config but the step's own, no prompt, English. */
const baseEnv = (layout: LanderLayout) => ({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: layout.work,
  LC_ALL: "C",
  PATH: layout.path,
});

/** The header that carries a remote's token, as git reads config from env. */
const header = (token: Redacted.Redacted) => ({
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${Redacted.value(token)}`,
});

/** How one job runs its steps, and how it says one blocked it. */
interface Steps {
  /**
   * Runs a step in the work folder, with the token of the remote it reaches.
   * A step expected to succeed that does not blocks the job; the others hand
   * back what git printed for the caller to read.
   */
  readonly run: (step: GitStep) => Effect.Effect<Executed, VerifierBlocked>;
  /** Blocks the job at `step`, logging `why` with the job's tokens taken out. */
  readonly blocked: (
    step: GitStep,
    why: string
  ) => Effect.Effect<never, VerifierBlocked>;
}

/** The steps of one job, which carries `tokens`. */
const runner = (tokens: Tokens) => {
  const blocked = (step: GitStep, why: string) =>
    blockedBy(subcommandOf(step), why, tokens);

  return Effect.gen(function* () {
    const box = yield* Box;
    const layout = yield* Layout;

    const run = (step: GitStep): Effect.Effect<Executed, VerifierBlocked> =>
      Effect.gen(function* () {
        const token =
          step.remote === undefined ? undefined : tokens[step.remote];

        if (step.remote !== undefined && token === undefined) {
          return yield* blocked(
            step,
            `the job carries no token for ${step.remote}`
          );
        }

        const env =
          token === undefined
            ? { ...baseEnv(layout), ...step.env }
            : { ...baseEnv(layout), ...step.env, ...header(token) };

        const ran = yield* box
          .exec(step.argv, {
            cwd: layout.work,
            env,
            timeoutMs: step.remote === undefined ? LOCAL_MS : REMOTE_MS,
          })
          .pipe(
            Effect.catchTag("BoxFailed", ({ reason }) => blocked(step, reason))
          );

        const expected =
          step.expect === "ok"
            ? ran.exitCode === 0
            : step.expect !== "merge" || ran.exitCode <= 1;

        return expected ? ran : yield* blocked(step, printed(ran));
      });

    return { blocked, run } satisfies Steps;
  });
};

/** Clock time, in the whole seconds a git signature holds. */
const seconds = Effect.map(Clock.currentTimeMillis, (millis) =>
  Math.floor(millis / 1000)
);

const signed = (who: GitIdentity, at: number): Signature => ({ ...who, at });

/** A scratch file the job writes, in the work folder. */
const scratch = (name: string) =>
  Effect.map(Layout, ({ work }) => `${work}/scratch/${name}`);

/**
 * The Lander's copy of the job's repo, and the scratch folders its files go
 * in, made if they are missing.
 */
const prepared = (job: Job) =>
  Effect.gen(function* () {
    const { work } = yield* Layout;

    yield* job.run(folders([`${work}/scratch/compose`]));
    yield* job.run(initCopy(job.repo));
  });

/** `text` written to `file` in the container; a file it would not take blocks the job. */
const writtenAt = (file: string, text: string) =>
  Box.use((box) => box.writeFile(file, new TextEncoder().encode(text))).pipe(
    Effect.catchTag("BoxFailed", ({ reason }) =>
      blockedBy("writeFile", reason, {})
    )
  );

/** Writes `text` to a scratch file for git to read: a message, a note. */
const written = (name: string, text: string) =>
  Effect.gen(function* () {
    const file = yield* scratch(name);

    yield* writtenAt(file, text);

    return file;
  });

/** What one job runs its steps with: its canonical repo, that repo's URL, and its steps. */
interface Job extends Steps {
  readonly repo: RepoName;
  readonly url: string;
}

/** `rev` in the Lander's copy, if it names something there. */
const resolved = ({ repo, run }: Job, rev: string) =>
  Effect.map(run(revParse(repo, rev)), ({ exitCode, stdout }) =>
    exitCode === 0 ? Option.some(stdout.trim()) : Option.none()
  );

/** `rev`'s id in the Lander's copy, which a step before made sure is there. */
const idOf = (job: Job, rev: string) =>
  resolved(job, rev).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          job.blocked(revParse(job.repo, rev), `the copy has no ${rev}`),
        onSome: Effect.succeed,
      })
    )
  );

/** A commit of `tree` on `parents`, written to the copy: its id. */
const committed = (
  job: Job,
  commit: {
    readonly tree: string;
    readonly parents: readonly string[];
    readonly message: string;
    readonly author: GitIdentity;
    readonly at: number;
  }
) =>
  Effect.gen(function* () {
    const messageFile = yield* written("message", commit.message);

    const ran = yield* job.run(
      commitTree(job.repo, {
        author: signed(commit.author, commit.at),
        committer: signed(committerLine, commit.at),
        messageFile,
        parents: commit.parents,
        tree: commit.tree,
      })
    );

    return CommitSha.make(ran.stdout.trim());
  });

/**
 * The merged tree as a commit on `main` and the head, pushed to the fork's
 * `mergeRef(tree)`, where a Checker's fetch of the fork's refs finds it
 * (W3 304 #1). It is dated at the epoch, so merging the same sides again
 * makes the same commit, and pushing it again changes nothing.
 */
const keptForChecks = (
  job: Job,
  sides: {
    readonly head: CommitSha;
    readonly main: LandedSha;
    readonly tree: TreeSha;
  }
) =>
  Effect.gen(function* () {
    yield* prepared(job);

    const commit = yield* committed(job, {
      at: 0,
      author: committerLine,
      message: `Merge ${sides.head} onto ${sides.main}, for its checks\n`,
      parents: [sides.main, sides.head],
      tree: sides.tree,
    });

    const ref = mergeRef(sides.tree);

    const push = pushRef(job.repo, job.url, {
      ref,
      remote: "fork",
      to: commit,
    });

    const ran = yield* job.run(push);

    return readPush(ran, ref) === "moved"
      ? commit
      : yield* job.blocked(push, printed(ran));
  });

/**
 * The answer's head merged onto canonical `main` with its base as the merge
 * base: the merged tree and the answer's changes, or `StaleBase` with the
 * paths that conflict. Nothing is pushed.
 */
export const merge = (wire: typeof MergeWire.Type) =>
  Effect.gen(function* () {
    const { job } = wire;

    const steps = yield* runner({
      fork: wire.fork.token,
      main: wire.main.token,
    });

    const { run } = steps;

    const script = mergeScript(job, {
      fork: wire.fork.url,
      main: wire.main.url,
    });

    yield* Effect.forEach(script.fetch, run, { discard: true });

    const merged = readMerge((yield* run(script.merge)).stdout);

    if (merged.conflicts.length > 0) {
      return yield* new StaleBase({
        base: job.base,
        conflicts: merged.conflicts,
        main: job.main,
      });
    }

    const changes = readChanges((yield* run(script.changes)).stdout);

    yield* keptForChecks(
      { ...steps, repo: job.repo, url: wire.fork.url },
      {
        head: job.head,
        main: job.main,
        tree: merged.tree,
      }
    );

    return { changes, tree: merged.tree };
  });

/** A path's folders and file name; one that cannot name a file is a defect upstream. */
const placed = ({ path }: { readonly path: string }) =>
  path.split("/").every((segment) => !["", ".", "..", ".git"].includes(segment))
    ? Effect.void
    : Effect.die(`${path} cannot name a file in a repo`);

/**
 * `main` with `files` added, written to the copy: the new root. A file
 * keeps the mode of the file it replaces; a path where a folder, a symlink
 * or a submodule stands blocks the job.
 */
const composed = (
  job: Job,
  main: string,
  files: readonly { readonly path: string; readonly content: string }[]
) =>
  Effect.gen(function* () {
    yield* Effect.forEach(files, placed, { discard: true });

    const blobs = yield* Effect.forEach(files, ({ content }, index) =>
      Effect.flatMap(written(`compose/${index}`, content), (file) =>
        Effect.map(job.run(hashObject(job.repo, file)), ({ stdout }) =>
          stdout.trim()
        )
      )
    );

    const paths = files.map(({ path }) => path);

    const existing = readEntries(
      (yield* job.run(lsTree(job.repo, main, paths))).stdout
    );

    const modes = paths.map((path) => existing.get(path)?.mode ?? "100644");

    if (!modes.every((mode) => FILE_MODES.has(mode))) {
      return yield* job.blocked(
        lsTree(job.repo, main, paths),
        "a composed file's path is a folder, a symlink or a submodule on main"
      );
    }

    const index = yield* scratch("compose.index");

    yield* job.run(readTree(job.repo, index, main));
    yield* job.run(
      updateIndex(
        job.repo,
        index,
        paths.map((path, at) => ({
          blob: blobs[at] ?? "",
          mode: modes[at] ?? "100644",
          path,
        }))
      )
    );

    return TreeSha.make(
      (yield* job.run(writeTree(job.repo, index))).stdout.trim()
    );
  });

/** The tree a land rebuilds, written to the copy where it is new. */
const rebuilt = (
  job: Job,
  wire: typeof LandWire.Type
): Effect.Effect<TreeSha, StaleBase | VerifierBlocked, Box> =>
  Rebuild.match<Effect.Effect<TreeSha, StaleBase | VerifierBlocked, Box>>(
    wire.job.rebuild,
    {
      Compose: ({ files }) => composed(job, wire.job.main, files),
      Existing: ({ commit }) =>
        Effect.map(idOf(job, `${commit}^{tree}`), (tree) => TreeSha.make(tree)),
      Merge: ({ base, fork, head }) =>
        Effect.gen(function* () {
          if (wire.fork === undefined) {
            return yield* job.blocked(
              mergeTree(job.repo, { base, head, main: wire.job.main }),
              "a merge rebuild needs the fork's remote"
            );
          }

          yield* job.run(fetchFork(job.repo, fork, wire.fork.url));

          const merged = readMerge(
            (yield* job.run(
              mergeTree(job.repo, { base, head, main: wire.job.main })
            )).stdout
          );

          return merged.conflicts.length > 0
            ? yield* new StaleBase({
                base,
                conflicts: merged.conflicts,
                main: wire.job.main,
              })
            : merged.tree;
        }),
    }
  );

/** The mirror of canonical `main` (ADR 0005, spec D22). */
const landedRef = `${Brand.refsPrefix}landed`;

/** Where the copy keeps canonical's notes ref. */
const notesCopyOf = notesRef.replace("refs/notes/", `${notesCopy}/`);

const encodeNote = Schema.encodeEffect(Schema.fromJsonString(Verdict));

/** Whether the notes commit `notes` (in the copy) holds a note on `landing`. */
const holdsNote = (job: Job, notes: string, landing: CommitSha) =>
  Effect.map(
    job.run(objectType(job.repo, `${notes}:${landing}`)),
    ({ exitCode }) => exitCode === 0
  );

/**
 * The verdict written as the landing's note, unless it is there already:
 * the content `@repo/git/notes`' `noteCommit` writes (one JSON blob named by
 * the landing, fanout-free, the platform's commit on the earlier notes),
 * pushed alone. It gives the notes commit that holds the note.
 */
const note = (job: Job, landing: CommitSha, verdict: Verdict, at: number) =>
  Effect.gen(function* () {
    const parent = yield* resolved(job, notesCopyOf);

    if (
      Option.isSome(parent) &&
      (yield* holdsNote(job, parent.value, landing))
    ) {
      return parent.value;
    }

    const json = yield* Effect.orDie(encodeNote(verdict));
    const file = yield* written("note", `${json}\n`);
    const blob = (yield* job.run(hashObject(job.repo, file))).stdout.trim();
    const index = yield* scratch("notes.index");

    yield* job.run(
      readTree(
        job.repo,
        index,
        Option.getOrUndefined(Option.map(parent, (sha) => `${sha}^{tree}`))
      )
    );
    yield* job.run(
      updateIndex(job.repo, index, [{ blob, mode: "100644", path: landing }])
    );

    const tree = (yield* job.run(writeTree(job.repo, index))).stdout.trim();

    const commit = yield* committed(job, {
      at,
      author: committerLine,
      message: `Verdict on ${landing}\n`,
      parents: Option.toArray(parent),
      tree,
    });

    const step = pushRef(job.repo, job.url, { ref: notesRef, to: commit });
    const ran = yield* job.run(step);

    return readPush(ran, notesRef) === "moved"
      ? commit
      : yield* job.blocked(step, printed(ran));
  });

/** A piece of bookkeeping a landing may leave pending. */
type Bookkeeping = (typeof Landed.Type)["pending"][number];

/** One piece of bookkeeping: `None` once written, its name when it was not. */
const attempt = <A, E, R>(item: Bookkeeping, write: Effect.Effect<A, E, R>) =>
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
 * What follows a landing on `main`, each in its own push (S1 #6): the
 * mirror ref, while the landing is still main's tip (a later landing's own
 * mirror supersedes it), then the verdict note. Neither fails the landing;
 * what was not written comes back pending, and landing the same job again
 * writes it.
 */
const settle = (
  job: Job,
  wire: typeof LandWire.Type,
  landing: CommitSha,
  tip: string
) =>
  Effect.gen(function* () {
    const at = yield* seconds;
    const script = landScript(wire.job, job.url, landing, landedRef);

    const mirrored = yield* attempt(
      "mirror",
      tip === landing
        ? Effect.flatMap(job.run(script.mirror), (ran) =>
            readPush(ran, landedRef) === "moved"
              ? Effect.void
              : job.blocked(script.mirror, printed(ran))
          )
        : Effect.void
    );

    const noted = yield* Option.match(wire.job.verdict, {
      onNone: () => Effect.succeedNone,
      onSome: (verdict) => attempt("notes", note(job, landing, verdict, at)),
    });

    return {
      pending: [...Option.toArray(mirrored), ...Option.toArray(noted)],
      sha: LandedSha.make(landing),
    };
  });

// How far back from main's tip a second land looks for the first one's commit.
const LOOKBACK = 16;

const requestIdOf = (text: string) =>
  parseTrailers(text).find(({ key }) => key.toLowerCase() === "request-id")
    ?.value;

/** The base a stale land names: the answer's own, or the main it was built on. */
const baseOf = (wire: typeof LandWire.Type) =>
  Rebuild.match(wire.job.rebuild, {
    Compose: () => wire.job.main,
    Existing: () => wire.job.main,
    Merge: ({ base }) => base,
  });

/**
 * A land that found `main` at `tip`, not where the job left it: an earlier
 * land of the same request (a child of the job's `main` carrying its
 * `Request-Id`, within 16 first parents of the tip) gets its missing
 * bookkeeping written; anything else is `StaleBase`.
 */
const moved = (job: Job, wire: typeof LandWire.Type, tip: string) =>
  Effect.gen(function* () {
    const history = readLog(
      (yield* job.run(firstParents(job.repo, tip, LOOKBACK))).stdout
    );

    const mine = Array.takeWhile(
      history,
      ({ sha }) => sha !== wire.job.main
    ).find(
      ({ message, parents }) =>
        parents[0] === wire.job.main &&
        requestIdOf(message) === wire.job.requestId
    );

    if (mine !== undefined) {
      return yield* settle(job, wire, mine.sha, tip);
    }

    return yield* new StaleBase({
      base: baseOf(wire),
      conflicts: [],
      main: CommitSha.make(tip),
    });
  });

/**
 * One commit on canonical `main` whose parent is the job's `main` and whose
 * tree is the job's `tree`, rebuilt here; the answerer its author and the
 * platform its committer. It is pushed without force, so a `main` that
 * moved refuses it; then the mirror ref and the verdict note, each alone.
 */
export const land = (wire: typeof LandWire.Type) =>
  Effect.gen(function* () {
    const { job: landing } = wire;

    if (requestIdOf(landing.message) !== landing.requestId) {
      return yield* Effect.die(
        `a landing's message must carry Request-Id: ${landing.requestId}`
      );
    }

    const job: Job = {
      ...(yield* runner(
        wire.fork === undefined
          ? { main: wire.main.token }
          : { fork: wire.fork.token, main: wire.main.token }
      )),
      repo: landing.repo,
      url: wire.main.url,
    };

    yield* prepared(job);
    yield* job.run(fetchMain(job.repo, job.url, { notes: true }));

    const tip = yield* idOf(job, mainCopy);

    if (tip !== landing.main) {
      return yield* moved(job, wire, tip);
    }

    const tree = yield* rebuilt(job, wire);

    if (tree !== landing.tree) {
      return yield* Effect.logWarning(
        "a land rebuilt another tree than it was asked to land"
      ).pipe(
        Effect.annotateLogs({ asked: landing.tree, rebuilt: tree }),
        Effect.andThen(Effect.fail(new VerifierBlocked({})))
      );
    }

    const commit = yield* committed(job, {
      at: yield* seconds,
      author: authorLine(landing.author),
      message: landing.message,
      parents: [landing.main],
      tree,
    });

    const script = landScript(landing, job.url, commit, landedRef);
    const ran = yield* job.run(script.main);
    const pushed = readPush(ran, mainRef);

    if (pushed === "moved") {
      return yield* settle(job, wire, commit, commit);
    }

    if (pushed === "busy") {
      return yield* new RepoBusy({});
    }

    if (pushed === "stale") {
      yield* job.run(fetchMain(job.repo, job.url, { notes: true }));

      return yield* moved(job, wire, yield* idOf(job, mainCopy));
    }

    return yield* job.blocked(script.main, printed(ran));
  });

// What a composed commit says: the platform made it, for a check, off main.
const COMPOSE_MESSAGE = "Compose files onto main for a check\n";

/**
 * `main` with a decider's files added, committed by the platform on `main`
 * and pushed to `${Brand.refsPrefix}compose/<tree>`, where a Checker fetches
 * it by id. `main` never moves. Composed before onto the same `main`, it is
 * the commit already there.
 */
export const compose = (wire: typeof ComposeWire.Type) =>
  Effect.gen(function* () {
    const job: Job = {
      ...(yield* runner({ main: wire.main.token })),
      repo: wire.job.repo,
      url: wire.main.url,
    };

    yield* prepared(job);
    yield* job.run(fetchMain(job.repo, job.url));

    const tree = yield* composed(job, wire.job.main, wire.job.files);
    const ref = `${Brand.refsPrefix}compose/${tree}`;

    const existing = readRemoteRef(
      (yield* job.run(lsRemote(job.repo, job.url, ref))).stdout
    );

    if (existing !== undefined) {
      yield* job.run(fetchRef(job.repo, job.url, ref, composeCopy));

      const [before] = readLog(
        (yield* job.run(firstParents(job.repo, existing, 1))).stdout
      );

      const kept = yield* idOf(job, `${existing}^{tree}`);

      if (kept === tree && before?.parents[0] === wire.job.main) {
        return { commit: existing, tree };
      }
    }

    const commit = yield* committed(job, {
      at: yield* seconds,
      author: committerLine,
      message: COMPOSE_MESSAGE,
      parents: [wire.job.main],
      tree,
    });

    const step = pushRef(
      job.repo,
      job.url,
      existing === undefined
        ? { ref, to: commit }
        : { lease: existing, ref, to: commit }
    );

    const ran = yield* job.run(step);

    if (readPush(ran, ref) !== "moved") {
      return yield* job.blocked(step, printed(ran));
    }

    return { commit, tree };
  });

/** Whether `rev` names a commit in the Lander's copy. */
const hasCommit = (job: Job, rev: string) =>
  Effect.map(
    job.run(objectType(job.repo, `${rev}^{commit}`)),
    ({ exitCode }) => exitCode === 0
  );

/** `commit` in the Lander's copy, fetched by its id if fetching main did not bring it. */
const present = (job: Job, commit: string) =>
  Effect.gen(function* () {
    if (!(yield* hasCommit(job, commit))) {
      yield* job.run(fetchCommit(job.repo, job.url, commit));
    }

    return (yield* hasCommit(job, commit))
      ? commit
      : yield* job.blocked(
          objectType(job.repo, commit),
          `canonical has no commit ${commit}`
        );
  });

/**
 * The entries of a config folder bundled by bun in the work folder: the
 * folder's files checked out from the copy (no repo config, no hooks; files
 * only, never a symlink), the sdk's two names pointed at the image's copy
 * and its packages beside it, then bun's output read back, each entry at its
 * own path and each shared chunk at the path bun gave it.
 */
const built = (
  job: Job,
  files: readonly {
    readonly path: string;
    readonly mode: string;
    readonly sha: string;
  }[],
  entries: Array.NonEmptyReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const { sdk, work } = yield* Layout;
    const root = `${work}/bundle`;
    const out = `${work}/bundle-out`;
    const index = yield* scratch("bundle.index");

    yield* job.run(removeFolder(root));
    yield* job.run(removeFolder(out));
    yield* job.run(folders([root]));
    yield* job.run(readTree(job.repo, index));
    yield* job.run(
      updateIndex(
        job.repo,
        index,
        files.map(({ mode, path, sha }) => ({ blob: sha, mode, path }))
      )
    );
    yield* job.run(checkoutIndex(job.repo, index, root));

    const tsconfig = `${root}/tsconfig.json`;

    yield* writtenAt(tsconfig, resolution(sdk.entry));
    yield* job.run(symlink(sdk.modules, `${root}/node_modules`));
    yield* job.run(bundle({ entries, out, root, tsconfig }));

    const outputs = readFiles((yield* job.run(listFiles(out))).stdout);
    const owners = new Map(entries.map((entry) => [bundledAs(entry), entry]));

    if (!entries.every((entry) => outputs.includes(bundledAs(entry)))) {
      return yield* job.blocked(
        listFiles(out),
        "bun wrote no bundle for an entry"
      );
    }

    return yield* Effect.forEach(outputs, (output) =>
      Effect.map(
        job.run(readFile(`${out}/${output}`)),
        ({ stdout }) => [owners.get(output) ?? output, stdout] as const
      )
    );
  });

/**
 * The config folder at `at`, for the rules evaluator: its project module and
 * ask files each bundled by bun into plain ES modules with the sdk and
 * `effect` inlined (shared code in chunks beside them), its other files
 * (`policy.json`, the vouch file) as committed, and the version of the sdk
 * the image carries. A folder that is missing gives no modules: the project
 * runs on the defaults. Nothing in the folder runs here.
 */
export const bundleRules = (wire: typeof BundleWire.Type) =>
  Effect.gen(function* () {
    const { sdk } = yield* Layout;

    const job: Job = {
      ...(yield* runner({ main: wire.main.token })),
      repo: wire.job.repo,
      url: wire.main.url,
    };

    yield* prepared(job);
    yield* job.run(fetchMain(job.repo, job.url));
    yield* present(job, wire.job.at);

    const listed = readEntries(
      (yield* job.run(filesUnder(job.repo, wire.job.at, Brand.configDir)))
        .stdout
    );

    const files = [...listed].flatMap(([path, { mode, sha }]) =>
      FILE_MODES.has(mode) ? [{ mode, path, sha }] : []
    );

    const sdkVersion = (yield* job.run(readFile(sdk.version))).stdout.trim();

    if (sdkVersion === "") {
      return yield* job.blocked(readFile(sdk.version), "no sdk version");
    }

    const data = yield* Effect.forEach(
      files.filter(({ path }) => !isScript(path)),
      ({ path, sha }) =>
        Effect.map(
          job.run(catBlob(job.repo, sha)),
          ({ stdout }) => [path, stdout] as const
        )
    );

    const entries = bundleEntries(files.map(({ path }) => path));

    const code = Array.isReadonlyArrayNonEmpty(entries)
      ? yield* built(job, files, entries)
      : [];

    return {
      entry: configEntry,
      modules: Object.fromEntries([...data, ...code]),
      sdkVersion,
    };
  });
