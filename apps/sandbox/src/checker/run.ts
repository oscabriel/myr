/**
 * One check job, phase by phase, in one container that holds no credential
 * (spec §4.3; OSR §5.3):
 *
 * 1. clone: the job's tree, through the clone route, whose gateway adds the
 *    read token outside the container;
 * 2. the plan from `@repo/checks/phases`, keyed by the lockfiles just cloned:
 *    setup (or a snapshot of an earlier one) with egress to the registries
 *    and the run block's `setupEgress` only, the snapshot, egress off, the
 *    held-back slot (W6), the lanes, the report.
 *
 * The container is destroyed however the job ends, and its logs are handed
 * to `CheckLogs` before that; the result carries none. A job the Checker
 * cannot run to the end (no run block, a clone or a setup that fails, a
 * sealed suite before W6) is `VerifierBlocked`: the gate's trouble, never the
 * answer's. A lane that fails or runs out of time is that lane's result.
 */
import { CheckAt, evidenceFrom } from "@repo/checks/check-runner";
import type { CheckRun, LaneEvidence } from "@repo/checks/check-runner";
import { classifyRun } from "@repo/checks/classify";
import type { RunExit } from "@repo/checks/classify";
import { Phase, phasePlan } from "@repo/checks/phases";
import type { PlannedLane } from "@repo/checks/phases";
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { RunBlock } from "@repo/protocol/domain/run";
import { RepoName } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Duration, Effect, Option, Ref } from "effect";

import { Box } from "../box.ts";
import type { ExecOptions, Executed } from "../box.ts";
import { CheckLogs } from "./logs.ts";
import type { PhaseLog } from "./logs.ts";
import {
  allows,
  CLONE_HOST,
  cloneUrlOf,
  Network,
  REGISTRIES,
} from "./network.ts";
import { Snapshots } from "./snapshots.ts";
import type { CheckerWire } from "./wire.ts";

/** Where the job's tree is checked out, and every command runs. */
export const REPO = "/workspace/repo";

/**
 * The CA the container's outbound intercepts present: every HTTPS request
 * leaves through one, so every TLS client trusts this CA alone.
 */
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

const TRUST = {
  CARGO_HTTP_CAINFO: CA,
  CURL_CA_BUNDLE: CA,
  GIT_SSL_CAINFO: CA,
  NODE_EXTRA_CA_CERTS: CA,
  PIP_CERT: CA,
  REQUESTS_CA_BUNDLE: CA,
  SSL_CERT_FILE: CA,
};

/**
 * The project's own bins first, as `npm run` puts them (ASSUMPTION from W2
 * 205 #8), then the image's.
 */
const PATH = [
  `${REPO}/node_modules/.bin`,
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
].join(":");

/**
 * The whole environment every command sees: fixed, so two runs of one tree
 * see the same one, and holding nothing secret.
 */
const ENV = {
  ...TRUST,
  CI: "1",
  // corepack fetches pnpm or Yarn during setup without asking first.
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  FORCE_COLOR: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/root",
  LC_ALL: "C",
  NO_COLOR: "1",
  PATH,
};

/** The identity of the commit a checked tree is checked out as. */
const GIT_ENV = {
  ...ENV,
  GIT_AUTHOR_DATE: "2026-10-06T12:00:00Z",
  GIT_AUTHOR_EMAIL: "checker@example.com",
  GIT_AUTHOR_NAME: "Checker",
  GIT_COMMITTER_DATE: "2026-10-06T12:00:00Z",
  GIT_COMMITTER_EMAIL: "checker@example.com",
  GIT_COMMITTER_NAME: "Checker",
};

/** The files whose contents decide what setup installs. */
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "requirements.txt",
];

const CLONE_LIMIT = Duration.minutes(5);

const SETUP_LIMIT = Duration.minutes(15);

/** A lane with no time limit of its own gets ten minutes, as `/local` gives. */
const LANE_LIMIT = Duration.minutes(10);

const timedOut: RunExit = { code: -1, stderr: "", stdout: "", timedOut: true };

/** Hosts a failed setup's output names: in URLs and in resolver errors. */
const HOSTS_IN_OUTPUT = [
  /\bhttps?:\/\/(?<host>[a-z0-9.-]+)/giu,
  /\bgetaddrinfo \w+ (?<host>[a-z0-9.-]+)/giu,
  /\bresolve host:? (?<host>[a-z0-9.-]+)/giu,
];

/** The hosts `text` names that `allowed` does not let out. */
const refusedIn = (text: string, allowed: readonly string[]) => [
  ...new Set(
    HOSTS_IN_OUTPUT.flatMap((pattern) =>
      [...text.matchAll(pattern)].flatMap(
        ({ groups }) => groups?.host?.toLowerCase() ?? []
      )
    ).filter((host) => !allows(allowed, host))
  ),
];

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256 = (text: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    hex
  );

export const blocked = (
  reason: string,
  annotations: Record<string, string> = {}
): Effect.Effect<never, VerifierBlocked> =>
  Effect.logWarning(`check blocked: ${reason}`).pipe(
    Effect.annotateLogs(annotations),
    Effect.andThen(Effect.fail(new VerifierBlocked({})))
  );

/** A lane's run, as the lane's result and what it leaves for comparison. */
interface LaneRan {
  readonly result: LaneResult;
  readonly evidence: Option.Option<LaneEvidence>;
}

/** Every phase's log so far, handed to `CheckLogs` when the check ends. */
type Kept = Ref.Ref<readonly PhaseLog[]>;

/** Adds `log`'s text to the log of its phase and name, starting it if new. */
const keep = (kept: Kept, log: PhaseLog) =>
  Ref.update(kept, (logs) =>
    logs.some(({ name, phase }) => phase === log.phase && name === log.name)
      ? logs.map((each) =>
          each.phase === log.phase && each.name === log.name
            ? { ...each, text: `${each.text}${log.text}` }
            : each
        )
      : [...logs, log]
  );

/**
 * One command, to its end or `limit` (none when it ran out of time), its
 * output kept in its phase's log. At the limit the Checker stops waiting for
 * it; the process itself ends only when the container is destroyed (the
 * `Box` adapter aborts an `exec` that is still starting, not one already
 * running: W3 315 Comments, for 399).
 */
const exec = (
  kept: Kept,
  log: Omit<PhaseLog, "text">,
  argv: readonly [string, ...string[]],
  options: ExecOptions,
  limit: Duration.Duration
) =>
  Effect.flatMap(Box, (box) =>
    box.exec(argv, { ...options, timeoutMs: Duration.toMillis(limit) })
  ).pipe(
    Effect.timeoutOption(limit),
    Effect.tap((done) =>
      keep(kept, {
        ...log,
        text: Option.match(done, {
          onNone: () => `$ ${argv.join(" ")}\ntimed out\n`,
          onSome: ({ stderr, stdout }) =>
            `$ ${argv.join(" ")}\n${stdout}${stderr}`,
        }),
      })
    )
  );

/** One git command of the checkout, which must succeed: its output. */
const git = (kept: Kept, ...args: readonly string[]) =>
  exec(
    kept,
    { name: "clone", phase: "clone" },
    ["git", ...args],
    { cwd: "/", env: GIT_ENV },
    CLONE_LIMIT
  ).pipe(
    Effect.catchTag("BoxFailed", ({ reason }) =>
      blocked("the checkout's container failed", { phase: "clone", reason })
    ),
    Effect.flatMap(
      Option.match({
        onNone: () => blocked("the checkout timed out", { phase: "clone" }),
        onSome: (done: Executed) =>
          done.exitCode === 0
            ? Effect.succeed(done.stdout)
            : blocked("a checkout command failed", {
                command:
                  args.find((arg) => !arg.startsWith("-") && arg !== REPO) ??
                  "git",
                exitCode: String(done.exitCode),
                phase: "clone",
              }),
      })
    )
  );

/**
 * The job's tree as the work tree's HEAD, fetched from `url` (the clone
 * host, which holds no token) into an empty repo or the one a snapshot
 * brought back. `clean` keeps what setup installed (ignored files) and drops
 * anything else the tree does not hold.
 */
const checkout = (kept: Kept, url: string, at: CheckAt) =>
  Effect.gen(function* () {
    const fetch = (refspec: string) =>
      git(
        kept,
        "-C",
        REPO,
        "fetch",
        "-q",
        "--depth=1",
        "--no-tags",
        url,
        refspec
      );

    yield* git(kept, "init", "-q", REPO);

    const head = yield* CheckAt.match(at, {
      Commit: ({ commit }) => Effect.as(fetch(commit), "FETCH_HEAD"),
      // A tree has no ref of its own: it is fetched with every ref's tip,
      // then committed locally so the work tree has a HEAD.
      Tree: ({ tree }) =>
        Effect.andThen(fetch("+refs/*:refs/checked/*"), () =>
          Effect.map(
            git(kept, "-C", REPO, "commit-tree", tree, "-m", "Checked tree"),
            (commit) => commit.trim()
          )
        ),
    });

    yield* git(kept, "-C", REPO, "checkout", "-q", "--force", "--detach", head);
    yield* git(kept, "-C", REPO, "clean", "-q", "-ffd");
  });

/** What the phases share for one job. */
interface Job {
  readonly wire: CheckerWire;
  readonly kept: Kept;
  /** The URL the container clones from: the clone host, no token. */
  readonly url: string;
  /** Whether setup was skipped for a snapshot of an earlier one. */
  readonly restored: Ref.Ref<boolean>;
}

/** A snapshot is its project's own: two projects with one lockfile never share one. */
const snapshotKeyOf = ({ wire }: Job, key: string) =>
  `${wire.job.project}:${key}`;

/**
 * Setup, or the snapshot of an earlier one: with a snapshot under `key`, the
 * container restarts from it and the job's tree is checked out again;
 * without one, `command` runs with egress to the registries and `egress`
 * only. A setup that fails is `VerifierBlocked`, and a host it was refused is
 * named in setup's log and in the log line.
 */
const setup = (
  job: Job,
  command: string,
  egress: readonly string[],
  key: string
) =>
  Effect.gen(function* () {
    const network = yield* Network;
    const snapshots = yield* Snapshots;

    const hit = yield* snapshots
      .restore(snapshotKeyOf(job, key))
      .pipe(
        Effect.catchTag("BoxFailed", ({ reason }) =>
          blocked("the snapshot did not restore", { phase: "setup", reason })
        )
      );

    if (hit) {
      yield* Ref.set(job.restored, true);

      return yield* checkout(job.kept, job.url, job.wire.job.at);
    }

    const allowed = [...new Set([...REGISTRIES, ...egress])];

    yield* network.allow(allowed);

    const done = yield* exec(
      job.kept,
      { name: "setup", phase: "setup" },
      ["sh", "-c", command],
      { cwd: REPO, env: ENV },
      SETUP_LIMIT
    ).pipe(
      Effect.catchTag("BoxFailed", ({ reason }) =>
        blocked("setup's container failed", { phase: "setup", reason })
      )
    );

    if (Option.isNone(done)) {
      return yield* blocked("setup timed out", { phase: "setup" });
    }

    if (done.value.exitCode === 0) {
      return yield* Effect.void;
    }

    const refused = refusedIn(
      `${done.value.stdout}\n${done.value.stderr}`,
      allowed
    );

    if (refused.length > 0) {
      yield* keep(job.kept, {
        name: "setup",
        phase: "setup",
        text: `refused: ${refused.join(", ")} (not on setup's allow-list)\n`,
      });
    }

    return yield* blocked("setup failed", {
      blockedHosts: refused.join(" "),
      exitCode: String(done.value.exitCode),
      phase: "setup",
    });
  });

/**
 * Keeps what setup installed for the next check of this project and
 * lockfile. Only a check of a commit in the project's own repo keeps one
 * (main, or main with a decider's ask files): an answer's tree may change
 * what setup does, so a check of one only ever restores. A snapshot that
 * fails to save leaves this check as it was.
 */
const snapshot = (job: Job, key: string) =>
  Effect.gen(function* () {
    const snapshots = yield* Snapshots;
    const { at, project, repo } = job.wire.job;

    if (yield* Ref.get(job.restored)) {
      return;
    }

    // A project's canonical repo carries the project's name (spec §4.5).
    if (!CheckAt.guards.Commit(at) || repo !== RepoName.make(project)) {
      yield* Effect.logInfo("an answer's setup is not kept").pipe(
        Effect.annotateLogs({ phase: "snapshot" })
      );

      return;
    }

    yield* snapshots
      .save(snapshotKeyOf(job, key))
      .pipe(
        Effect.catchTag("BoxFailed", ({ reason }) =>
          Effect.logWarning("the setup snapshot was not saved").pipe(
            Effect.annotateLogs({ phase: "snapshot", reason })
          )
        )
      );
  });

/**
 * One lane, to its end or its time limit, as its result: how it ended,
 * classified (`checks.classifyRun`), never an error. A lane that runs out of
 * time, or that the container would not run, never ran to an end.
 */
const runLane = (job: Job, { command, lane }: PlannedLane) => {
  const own = job.wire.job.lanes.find((each) => each.lane === lane)?.timeoutMs;
  const limit = own === undefined ? LANE_LIMIT : Duration.millis(own);

  return exec(
    job.kept,
    { name: lane, phase: "lane" },
    ["sh", "-c", command],
    { cwd: REPO, env: ENV },
    limit
  ).pipe(
    Effect.map(
      Option.match({
        onNone: () => timedOut,
        onSome: ({ exitCode, stderr, stdout }): RunExit => ({
          code: exitCode,
          stderr,
          stdout,
        }),
      })
    ),
    Effect.catchTag("BoxFailed", ({ reason }) =>
      Effect.succeed<RunExit>({ code: -1, stderr: reason, stdout: "" })
    ),
    Effect.timed,
    Effect.map(([elapsed, exit]): LaneRan => {
      const result = classifyRun(lane, exit);

      return {
        evidence:
          result === "passed"
            ? Option.none()
            : Option.some(evidenceFrom(lane, exit)),
        result: {
          command,
          durationMs: Math.round(Duration.toMillis(elapsed)),
          lane,
          result,
        },
      };
    })
  );
};

/** The phases, from the clone to the last lane, with the logs kept as they go. */
const phases = (wire: CheckerWire, run: RunBlock, kept: Kept) =>
  Effect.gen(function* () {
    const network = yield* Network;
    const { clone } = wire;

    const job: Job = {
      kept,
      restored: yield* Ref.make(false),
      url: cloneUrlOf(clone.url),
      wire,
    };

    yield* network.routeClone({
      host: CLONE_HOST,
      remote: clone.url,
      token: clone.token,
    });
    yield* checkout(kept, job.url, wire.job.at);

    const lockfileHash = yield* Effect.flatMap(
      git(kept, "-C", REPO, "ls-tree", "HEAD", "--", ...LOCKFILES),
      sha256
    );

    const plan = phasePlan({
      heldBack: Option.map(
        Option.fromNullishOr(wire.job.heldBack),
        ({ areas }) => ({
          areas,
        })
      ),
      lanes: wire.job.lanes.map(({ command, lane }) => ({ command, lane })),
      lockfileHash,
      placeholders: wire.job.placeholders,
      run,
    });

    // Setup looks its snapshot up under the key the plan's `Snapshot` keeps
    // it under.
    const key = plan.find(Phase.$is("Snapshot"))?.key ?? lockfileHash;

    const ran = yield* Effect.forEach(plan, (phase) =>
      Effect.logInfo("checker phase").pipe(
        Effect.annotateLogs({ phase: phase._tag }),
        Effect.andThen(
          Phase.$match(phase, {
            EgressOff: () => Effect.as(network.allow([]), []),
            Report: () => Effect.succeed([]),
            Run: ({ lanes }) =>
              Effect.forEach(lanes, (lane) => runLane(job, lane)),
            Setup: ({ command, egress }) =>
              Effect.as(setup(job, command, egress, key), []),
            Snapshot: (saved) => Effect.as(snapshot(job, saved.key), []),
            // Sealed suites arrive in W6 (605), which writes them here, after
            // the snapshot and with egress off. Until then a job with one is
            // refused rather than checked without it.
            WriteHeldBack: () =>
              blocked("sealed suites are not built yet", {
                phase: "WriteHeldBack",
              }),
          })
        )
      )
    );

    return ran.flat();
  });

/**
 * One check job in one container: the phases, then the logs handed to
 * `CheckLogs` and the container destroyed, however the phases ended. The
 * result carries each lane's result and evidence, never a log.
 */
export const check = (
  wire: CheckerWire
): Effect.Effect<
  CheckRun,
  VerifierBlocked,
  Box | CheckLogs | Network | Snapshots
> =>
  Effect.gen(function* () {
    const box = yield* Box;
    const logs = yield* CheckLogs;
    const kept = yield* Ref.make<readonly PhaseLog[]>([]);

    const { run } = wire.job;

    const [elapsed, ran] = yield* Effect.timed(
      run === undefined
        ? blocked("the job carries no run block", { phase: "plan" })
        : phases(wire, run, kept)
    ).pipe(
      Effect.onExit(() => Effect.flatMap(Ref.get(kept), logs.report)),
      Effect.ensuring(box.destroy())
    );

    return {
      durationMs: Math.round(Duration.toMillis(elapsed)),
      evidence: ran.flatMap(({ evidence }) => Option.toArray(evidence)),
      heldBack: [],
      lanes: ran.map(({ result }) => result),
    };
  });
