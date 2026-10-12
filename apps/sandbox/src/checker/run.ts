// A sealed suite is written only after the snapshot and with egress off. From
// its first write on, nothing a command prints leaves the Checker, the public
// lanes' output included (a `bun test` with no path finds the sealed files).
import { CheckAt, evidenceFrom } from "@repo/checks/check-runner";
import type {
  CheckRun,
  EnvPlaceholder,
  HeldBackCheck,
  HeldBackPart,
  LaneEvidence,
  LaneOutput,
} from "@repo/checks/check-runner";
import type { CheckWire } from "@repo/checks/check-runner/wire";
import { classifyRun } from "@repo/checks/classify";
import type { RunExit } from "@repo/checks/classify";
import { areaBits } from "@repo/checks/held-back-filter";
import type { HeldBackExit } from "@repo/checks/held-back-filter";
import { Phase, phasePlan } from "@repo/checks/phases";
import type { PlannedLane } from "@repo/checks/phases";
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { RunBlock } from "@repo/protocol/domain/run";
import { keyOf, RepoName } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Duration, Effect, Option, Ref } from "effect";

import { Box } from "../box.ts";
import type { ExecOptions, Executed } from "../box.ts";
import { envPlanOf } from "./env.ts";
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

export const REPO = "/workspace/repo";

/** Every HTTPS request leaves through an intercept, so TLS clients trust its CA alone. */
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

/** The project's own bins first, as `npm run` puts them. */
const PATH = [
  `${REPO}/node_modules/.bin`,
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
].join(":");

/** Fixed, so two runs of one tree see the same env. */
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

/** Placeholders, never values; no item's key displaces the Checker's own env. */
const commandEnv = (placeholders: readonly EnvPlaceholder[]) => ({
  ...Object.fromEntries(
    placeholders.map(({ key, placeholder }) => [key, placeholder])
  ),
  ...ENV,
});

const GIT_ENV = {
  ...ENV,
  GIT_AUTHOR_DATE: "2026-10-06T12:00:00Z",
  GIT_AUTHOR_EMAIL: "checker@example.com",
  GIT_AUTHOR_NAME: "Checker",
  GIT_COMMITTER_DATE: "2026-10-06T12:00:00Z",
  GIT_COMMITTER_EMAIL: "checker@example.com",
  GIT_COMMITTER_NAME: "Checker",
};

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

const ROOM_LIMIT = Duration.minutes(1);

const SETUP_LIMIT = Duration.minutes(15);

const LANE_LIMIT = Duration.minutes(10);

const timedOut: RunExit = { code: -1, stderr: "", stdout: "", timedOut: true };

const HOSTS_IN_OUTPUT = [
  /\bhttps?:\/\/(?<host>[a-z0-9.-]+)/giu,
  /\bgetaddrinfo \w+ (?<host>[a-z0-9.-]+)/giu,
  /\bresolve host:? (?<host>[a-z0-9.-]+)/giu,
];

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

interface LaneRan {
  readonly result: LaneResult;
  readonly evidence: Option.Option<LaneEvidence>;
  readonly output: Option.Option<LaneOutput>;
}

type Kept = Ref.Ref<readonly PhaseLog[]>;

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

type Recorder = (text: string) => Effect.Effect<void>;

const keeping =
  (kept: Kept, log: Omit<PhaseLog, "text">): Recorder =>
  (text) =>
    keep(kept, { ...log, text });

const dropping: Recorder = () => Effect.void;

/** None when it ran out of time. */
const exec = (
  record: Recorder,
  argv: readonly [string, ...string[]],
  options: ExecOptions,
  limit: Duration.Duration
) =>
  Effect.flatMap(Box, (box) =>
    box.exec(argv, { ...options, timeoutMs: Duration.toMillis(limit) })
  ).pipe(
    Effect.timeoutOption(limit),
    Effect.tap((done) =>
      record(
        Option.match(done, {
          onNone: () => `$ ${argv.join(" ")}\ntimed out\n`,
          onSome: ({ stderr, stdout }) =>
            `$ ${argv.join(" ")}\n${stdout}${stderr}`,
        })
      )
    )
  );

const git = (kept: Kept, ...args: readonly string[]) =>
  exec(
    keeping(kept, { name: "clone", phase: "clone" }),
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

/** `clean` keeps ignored files, which setup installed. */
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

interface Job {
  readonly wire: CheckWire;
  readonly kept: Kept;
  readonly env: Readonly<Record<string, string>>;
  readonly url: string;
  readonly restored: Ref.Ref<boolean>;
  readonly sealed: Ref.Ref<boolean>;
  readonly exits: Ref.Ref<readonly HeldBackExit[]>;
}

/** A snapshot is its project's own: two projects with one lockfile never share one. */
const snapshotKeyOf = ({ wire }: Job, key: string) =>
  `${wire.job.project}:${key}`;

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
      keeping(job.kept, { name: "setup", phase: "setup" }),
      ["sh", "-c", command],
      { cwd: REPO, env: job.env },
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

/** Only the project's own commits save one: an answer's tree may change what setup does. */
const snapshot = (job: Job, key: string) =>
  Effect.gen(function* () {
    const snapshots = yield* Snapshots;
    const { at, project, repo } = job.wire.job;

    if (yield* Ref.get(job.restored)) {
      return;
    }

    // A project's canonical repo carries the project's name.
    if (!CheckAt.guards.Commit(at) || repo !== RepoName.make(keyOf(project))) {
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

/** A lane beside the sealed files keeps no output or failure signature: it may quote them. */
const runLane = (job: Job, { command, lane }: PlannedLane) =>
  Effect.gen(function* () {
    const own = job.wire.job.lanes.find((each) => each.lane === lane);
    const beside = yield* Ref.get(job.sealed);

    const limit =
      own?.timeoutMs === undefined
        ? LANE_LIMIT
        : Duration.millis(own.timeoutMs);

    const printed = (exit: RunExit): Option.Option<LaneOutput> =>
      !beside &&
      own?.output === "stdout" &&
      exit.timedOut !== true &&
      exit.code !== -1
        ? Option.some({ lane, stdout: exit.stdout })
        : Option.none();

    return yield* exec(
      beside ? dropping : keeping(job.kept, { name: lane, phase: "lane" }),
      ["sh", "-c", command],
      { cwd: REPO, env: job.env },
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
              : Option.some(beside ? { lane } : evidenceFrom(lane, exit)),
          output: printed(exit),
          result: {
            command,
            durationMs: Math.round(Duration.toMillis(elapsed)),
            lane,
            result,
          },
        };
      })
    );
  });

const inTree = (path: string) =>
  !path.startsWith("/") &&
  path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

/** Arguments: folders, shallowest first, then `--`, then files; all absolute, so none reads as `--`. */
const ROOM = [
  'while [ "$1" != -- ]; do',
  '  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -d "$1" ]; }; then',
  '    rm -f -- "$1" || exit 1',
  "  fi",
  '  [ -d "$1" ] || mkdir -- "$1" || exit 1',
  "  shift",
  "done",
  "shift",
  'rm -rf -- "$@"',
].join("\n");

const foldersAbove = (root: string, path: string) => {
  const folders = path.split("/").slice(0, -1);

  return folders.map(
    (_, depth) => `${root}/${folders.slice(0, depth + 1).join("/")}`
  );
};

/** A failed write would tell the answer, for free, that a sealed path is there. */
export const roomFor = (
  root: string,
  paths: readonly string[]
): readonly [string, ...string[]] => [
  "sh",
  "-c",
  ROOM,
  "room",
  ...new Set(paths.flatMap((path) => foldersAbove(root, path))),
  "--",
  ...paths.map((path) => `${root}/${path}`),
];

/** The sealed files are not all in the work tree: nothing logged says which. */
const unwritten = () =>
  blocked("the sealed files were not written", { phase: "WriteHeldBack" });

/** No reason the container gave is logged, since it may name a sealed path. */
const writeHeldBack = (job: Job, { files }: HeldBackPart) =>
  Effect.gen(function* () {
    if (!files.every(({ path }) => inTree(path))) {
      return yield* blocked("a sealed file's path leaves the checked tree", {
        phase: "WriteHeldBack",
      });
    }

    const box = yield* Box;

    yield* Ref.set(job.sealed, true);

    const made = yield* exec(
      dropping,
      roomFor(
        REPO,
        files.map(({ path }) => path)
      ),
      { cwd: REPO, env: ENV },
      ROOM_LIMIT
    ).pipe(Effect.catchTag("BoxFailed", unwritten));

    if (Option.isNone(made) || made.value.exitCode !== 0) {
      return yield* unwritten();
    }

    return yield* Effect.forEach(
      files,
      ({ content, path }) =>
        box
          .writeFile(`${REPO}/${path}`, content)
          .pipe(Effect.catchTag("BoxFailed", unwritten)),
      { discard: true }
    );
  });

/** A timeout reads as a plain failure: anything else is one more bit about the suite. */
const runSealed = (job: Job, { area, command }: HeldBackCheck) =>
  exec(
    dropping,
    ["sh", "-c", command],
    { cwd: REPO, env: job.env },
    LANE_LIMIT
  ).pipe(
    Effect.map(
      Option.match({
        onNone: (): HeldBackExit => ({ area, code: -1, timedOut: true }),
        onSome: ({ exitCode }): HeldBackExit => ({
          area,
          code: exitCode,
          timedOut: false,
        }),
      })
    ),
    Effect.catchTag("BoxFailed", () =>
      Effect.succeed<HeldBackExit>({ area, code: -1, timedOut: false })
    )
  );

const openEnvRoute = (wire: CheckWire) =>
  Effect.gen(function* () {
    const network = yield* Network;
    const { route, skipped } = envPlanOf(wire.job);

    yield* Effect.forEach(
      skipped,
      ({ host, reason }) =>
        Effect.logWarning("a proxy host is not intercepted").pipe(
          Effect.annotateLogs({ host, phase: "EgressOff", reason })
        ),
      { discard: true }
    );

    if (Option.isSome(route)) {
      yield* network.routeEnv(route.value);
    }
  });

const phases = (wire: CheckWire, run: RunBlock, kept: Kept) =>
  Effect.gen(function* () {
    const network = yield* Network;
    const { clone } = wire;

    const heldBack = Option.fromNullishOr(wire.job.heldBack);

    const job: Job = {
      env: commandEnv(wire.job.placeholders),
      exits: yield* Ref.make<readonly HeldBackExit[]>([]),
      kept,
      restored: yield* Ref.make(false),
      sealed: yield* Ref.make(false),
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
      heldBack: Option.map(heldBack, ({ areas }) => ({ areas })),
      lanes: wire.job.lanes.map(({ command, lane }) => ({ command, lane })),
      lockfileHash,
      placeholders: wire.job.placeholders.map(({ key }) => key),
      run,
    });

    const key = plan.find(Phase.$is("Snapshot"))?.key ?? lockfileHash;

    const ran = yield* Effect.forEach(plan, (phase) =>
      Effect.logInfo("checker phase").pipe(
        Effect.annotateLogs({ phase: phase._tag }),
        Effect.andThen(
          Phase.$match(phase, {
            // Off for every host but the env gateway's, which open here.
            EgressOff: () =>
              Effect.as(
                Effect.andThen(network.allow([]), openEnvRoute(wire)),
                []
              ),
            Report: () => Effect.succeed([]),
            Run: ({ lanes }) =>
              Effect.tap(
                Effect.forEach(lanes, (lane) => runLane(job, lane)),
                () =>
                  Option.match(heldBack, {
                    onNone: () => Effect.void,
                    onSome: ({ runs }) =>
                      Effect.flatMap(
                        Effect.forEach(runs, (each) => runSealed(job, each)),
                        (exits) => Ref.set(job.exits, exits)
                      ),
                  })
              ),
            Setup: ({ command, egress }) =>
              Effect.as(setup(job, command, egress, key), []),
            Snapshot: (saved) => Effect.as(snapshot(job, saved.key), []),
            WriteHeldBack: () =>
              Option.match(heldBack, {
                onNone: () => Effect.succeed([]),
                onSome: (part) => Effect.as(writeHeldBack(job, part), []),
              }),
          })
        )
      )
    );

    const exits = yield* Ref.get(job.exits);

    return {
      heldBack: Option.match(heldBack, {
        onNone: () => [],
        onSome: ({ areas, suite }) => areaBits({ areas, exits, suite }),
      }),
      ran: ran.flat(),
    };
  });

export const check = (
  wire: CheckWire
): Effect.Effect<
  CheckRun,
  VerifierBlocked,
  Box | CheckLogs | Network | Snapshots
> =>
  Effect.gen(function* () {
    const box = yield* Box;
    const logs = yield* CheckLogs;
    const kept = yield* Ref.make<readonly PhaseLog[]>([]);

    const [elapsed, { heldBack, ran }] = yield* Effect.timed(
      phases(wire, wire.job.run, kept)
    ).pipe(
      Effect.onExit(() => Effect.flatMap(Ref.get(kept), logs.report)),
      Effect.ensuring(box.destroy())
    );

    const outputs = ran.flatMap(({ output }) => Option.toArray(output));

    const done = {
      durationMs: Math.round(Duration.toMillis(elapsed)),
      evidence: ran.flatMap(({ evidence }) => Option.toArray(evidence)),
      heldBack,
      lanes: ran.map(({ result }) => result),
    };

    return outputs.length === 0 ? done : { ...done, outputs };
  });
