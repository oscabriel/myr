/**
 * The verdict loop: one contributor's harness, started headless on the brief
 * in their workspace, and every refusal their answer meets sent back into
 * the same session, at most `maxContinuations` times.
 *
 * Each attempt runs the harness until its session settles (or the process
 * ends), its output kept in `<run>/<handle>/attempt-<n>.jsonl` with the
 * token blanked. Then `<cli> status` says where the answer stands
 * (`outcome.ts`), never the harness's output:
 *
 * - `Landed`: the contributor is done;
 * - `AwaitingFinish`, `AwaitingDecision`, `WaitingOnParent`: waiting on a
 *   person or another ask, recorded as `waiting` (the swarm decides nothing);
 * - `Refused`: the refusals, rendered by protocol's `explain`, go back into
 *   the same session with the first one's `next`, unless one of them ends
 *   the claim (`endsClaim`) or the continuations ran out;
 * - no new answer: one nudge to push, then `noAnswer` (or `refused`, when an
 *   earlier answer was refused and nothing new came).
 *
 * The run's timeout bounds everything: a harness that never settles, or an
 * answer checked past it, ends the run as `timedOut`, and the harness's
 * process group is killed.
 */
import { Brand } from "@repo/brand";
import type { AnswerView } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array,
  Clock,
  Config,
  Console,
  Data,
  Duration,
  Effect,
  FileSystem,
  Fiber,
  Option,
  Ref,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { drivers, HarnessEvent, sessionDirOf } from "./harnesses/index.ts";
import type { HarnessDriver } from "./harnesses/index.ts";
import { awaitSettledOutcome } from "./outcome.ts";
import type { AskStatus } from "./outcome.ts";
import { endsClaim } from "./plan.ts";
import type { Assignment } from "./plan.ts";
import type { AgentOutcome, AgentRun } from "./results.ts";
import type { Contributor } from "./roster.ts";
import { scrubbed, SwarmFailed } from "./workspace.ts";
import type { AgentWorkspace } from "./workspace.ts";

/** One contributor's run: their harness on the brief, then the verdict loop. */
export type RunAgent = (input: {
  readonly assignment: Assignment;
  readonly workspace: AgentWorkspace;
  readonly brief: string;
  readonly maxContinuations: 3;
  readonly timeoutMs: number;
  /**
   * The ask's project, so `status` reads only it. Without one, `status`
   * lists every project's claims and answers and the ask is found by name.
   */
  readonly project?: ProjectName;
}) => Effect.Effect<
  AgentRun,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
>;

/**
 * The argv that starts `contributor`'s harness headless on `brief`, in their
 * workspace `dir`: the plan prints it, and `runAgent` runs the same one.
 */
export const startCommand = (input: {
  readonly contributor: Contributor;
  readonly brief: string;
  readonly dir: string;
}): readonly string[] => {
  const { adapter, handle, harness, model } = input.contributor;

  return drivers[harness].start({
    adapter,
    brief: input.brief,
    model,
    sessionDir: sessionDirOf(input.dir),
    sessionKey: handle,
    workspace: {
      clone: `${input.dir}/clone`,
      dir: input.dir,
      env: {},
      redacted: [],
    },
  });
};

/**
 * What a harness keeps of the swarm's own env: where the user's harness
 * sign-ins and caches live, the terminal and locale, and the network's
 * proxy and certificates. Nothing secret: the run's `SESSION_TOKENS`, cloud
 * tokens and any parent harness's session never reach a contributor's
 * harness, whose only credential is the person's token in the workspace's
 * env (PI §7: a harness runs with the user's OS permissions).
 */
const KEPT_FROM_SWARM = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** The env a contributor's harness runs in: `KEPT_FROM_SWARM`, then the workspace's. */
const harnessEnv = (workspace: AgentWorkspace) =>
  Effect.gen(function* () {
    const kept = yield* Effect.forEach(KEPT_FROM_SWARM, (name) =>
      Config.option(Config.String(name)).pipe(
        Effect.map(Option.map((value) => [name, value] as const)),
        Effect.orElseSucceed(() => Option.none())
      )
    );

    return {
      ...Object.fromEntries(Array.getSomes(kept)),
      ...workspace.env,
    };
  });

/** What one attempt's output said, and how its process ended. */
interface Heard {
  readonly session: Option.Option<string>;
  readonly settled: boolean;
  readonly stopReason: Option.Option<string>;
  /** Why the run failed on the harness's side, unless a response came after. */
  readonly failure: Option.Option<string>;
  readonly input: number;
  readonly output: number;
}

const nothingHeard: Heard = {
  failure: Option.none(),
  input: 0,
  output: 0,
  session: Option.none(),
  settled: false,
  stopReason: Option.none(),
};

const hear = (heard: Heard, event: HarnessEvent): Heard =>
  HarnessEvent.$match(event, {
    Failed: ({ reason }) => ({ ...heard, failure: Option.some(reason) }),
    SessionStarted: ({ id }) => ({ ...heard, session: Option.some(id) }),
    Settled: ({ stopReason }) => ({
      ...heard,
      settled: true,
      stopReason: Option.orElse(stopReason, () => heard.stopReason),
    }),
    Usage: ({ input, output, stopReason }) => ({
      ...heard,
      failure: Option.none(),
      input: heard.input + input,
      output: heard.output + output,
      stopReason: Option.orElse(stopReason, () => heard.stopReason),
    }),
  });

/** How long a settled harness gets to exit on its own before it is killed. */
const EXIT_GRACE = Duration.seconds(10);

/** How long a killed harness gets before `SIGKILL`. */
const KILL_GRACE = Duration.seconds(5);

/** The last characters of a harness's stderr kept, to say why it failed. */
const STDERR_TAIL = 2000;

/**
 * One harness process: `argv` in the clone with `env`. Every stdout line
 * goes to `file`, scrubbed of the token, and is read for events until the
 * session settles or the output ends. A settled harness gets `EXIT_GRACE`
 * to exit; then it is killed with its process group.
 */
const attempt = (input: {
  readonly argv: readonly string[];
  readonly driver: HarnessDriver;
  readonly env: Readonly<Record<string, string>>;
  readonly file: string;
  readonly workspace: AgentWorkspace;
  /** Runs when the output first names the session: the attempt counts from then. */
  readonly onSession: Effect.Effect<void>;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const [command = "", ...args] = input.argv;
      const scrub = (text: string) => scrubbed(text, input.workspace);

      yield* fs.writeFileString(input.file, "");

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd: input.workspace.clone,
          env: { ...input.env },
          extendEnv: false,
          forceKillAfter: KILL_GRACE,
          stdin: "ignore",
        })
      );

      const stderr = yield* child.stderr.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (tail, text) => `${tail}${text}`.slice(-STDERR_TAIL)
        ),
        Effect.forkScoped
      );

      const heard = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.tap((line) =>
          fs.writeFileString(input.file, `${scrub(line)}\n`, { flag: "a" })
        ),
        Stream.flatMap((line) => Stream.fromIterable(input.driver.parse(line))),
        Stream.tap((event) =>
          HarnessEvent.$is("SessionStarted")(event)
            ? input.onSession
            : Effect.void
        ),
        Stream.takeUntil(HarnessEvent.$is("Settled")),
        Stream.runFold(() => nothingHeard, hear)
      );

      const code = yield* child.exitCode.pipe(
        Effect.timeoutOption(EXIT_GRACE),
        Effect.map(Option.map(Number))
      );

      // A harness still running after its grace keeps its stderr open:
      // its tail is then not waited for.
      const tail = yield* Fiber.join(stderr).pipe(
        Effect.timeoutOption(Duration.seconds(1)),
        Effect.map(Option.getOrElse(() => ""))
      );

      return { code, heard, stderr: scrub(tail).trim() };
    })
  ).pipe(
    Effect.mapError(
      ({ message }) =>
        new SwarmFailed({
          reason: `${input.argv[0] ?? "the harness"} didn't run: ${message}`,
        })
    )
  );

/** What the loop does once an attempt's answer is known. */
export type Next = Data.TaggedEnum<{
  /** Resume the session with this prompt. */
  Resume: { readonly prompt: string; readonly nudge: boolean };
  /** The run ends with this outcome. */
  Done: {
    readonly outcome: AgentOutcome;
    readonly landed: Option.Option<string>;
  };
}>;

export const Next = Data.taggedEnum<Next>();

/** Where the loop stands between attempts. */
export interface Progress {
  readonly attempts: number;
  readonly continuations: number;
  readonly nudged: boolean;
  /** The requests of answers already acted on: status shows them until a new one comes. */
  readonly judged: readonly string[];
  readonly refusals: Readonly<Record<string, number>>;
  readonly landed: Option.Option<string>;
}

const started: Progress = {
  attempts: 0,
  continuations: 0,
  judged: [],
  landed: Option.none(),
  nudged: false,
  refusals: {},
};

/** What the loop does next, and where it then stands. */
export interface Step {
  readonly next: Next;
  readonly progress: Progress;
}

/** `prior` with each refusal's tag counted once more. */
const tally = (
  prior: Readonly<Record<string, number>>,
  refusals: readonly Refusal[]
) => {
  const counts = new Map(Object.entries(prior));

  for (const { _tag } of refusals) {
    counts.set(_tag, (counts.get(_tag) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
};

const short = (sha: string) => sha.slice(0, 7);

/** The prompt that resumes a session after its answer was refused. */
export const refusalPrompt = (input: {
  readonly answer: Pick<AnswerView, "ask" | "head">;
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
  readonly project: string;
}) =>
  [
    `Your answer to ${input.answer.ask} at ${short(input.answer.head)} was refused:`,
    "",
    ...explain(input.refusals),
    "",
    `Next: ${Array.headNonEmpty(input.refusals).next}`,
    "",
    `Fix what the refusal names, commit, and push again; then run \`${Brand.cli} status --project ${input.project}\` for the new verdict.`,
  ].join("\n");

/** The prompt that resumes a session that pushed no answer. */
export const nudgePrompt = (input: {
  readonly ask: string;
  readonly remote: string;
  readonly project: string;
}) =>
  [
    `No answer of yours to ${input.ask} has reached the platform yet.`,
    `Commit your change and push it to ${input.remote} with \`git push\`. If git printed refusals in its \`remote:\` lines, fix what they name first, then push again.`,
    `Then run \`${Brand.cli} status --project ${input.project}\` for the verdict.`,
  ].join("\n");

/**
 * What to do with what status says after an attempt: pure, over the
 * loop's progress. An answer status showed before (its request already
 * judged) is no new answer.
 */
export const afterSettle = (input: {
  readonly status: AskStatus;
  readonly progress: Progress;
  readonly maxContinuations: number;
  readonly ask: string;
  /** The ask's project, when the run was told it; else the claim's. */
  readonly project: Option.Option<string>;
  /**
   * Why the attempt's harness failed (a provider error, a nonzero exit), if
   * it did: with no new answer, a nudge cannot help, so the run failed.
   */
  readonly broke: Option.Option<string>;
}): Step => {
  const { maxContinuations, progress } = input;

  const project = Option.getOrElse(
    Option.orElse(input.project, () =>
      Option.map(input.status.claim, (claim) => claim.project)
    ),
    () => "<project>"
  );

  const canContinue = progress.continuations < maxContinuations;

  const fresh = Option.filter(
    input.status.answer,
    ({ requestId }) => !progress.judged.includes(requestId)
  );

  const done = (outcome: AgentOutcome, at: Progress = progress) => ({
    next: Next.Done({ landed: at.landed, outcome }),
    progress: at,
  });

  if (Option.isNone(fresh)) {
    if (Option.isSome(input.broke)) {
      return done("failed");
    }

    if (!progress.nudged && canContinue) {
      return {
        next: Next.Resume({
          nudge: true,
          prompt: nudgePrompt({
            ask: input.ask,
            project,
            remote: Option.match(input.status.claim, {
              onNone: () => "origin",
              onSome: ({ remote }) => remote,
            }),
          }),
        }),
        progress: {
          ...progress,
          continuations: progress.continuations + 1,
          nudged: true,
        },
      };
    }

    return done(progress.judged.length === 0 ? "noAnswer" : "refused");
  }

  const answer = fresh.value;

  const judged = {
    ...progress,
    judged: [...progress.judged, answer.requestId],
  };

  return Outcome.match(answer.outcome, {
    AwaitingDecision: () => done("waiting", judged),
    AwaitingFinish: () => done("waiting", judged),
    // `awaitSettledOutcome` reads past every `Checking` until the run's
    // timeout ends it, so an answer still checking here ran out of time.
    Checking: () => done("timedOut", judged),
    Landed: ({ sha }) =>
      done("landed", { ...judged, landed: Option.some(sha) }),
    Refused: ({ refusals }) => {
      const counted = {
        ...judged,
        refusals: tally(progress.refusals, refusals),
      };

      if (refusals.some(({ _tag }) => endsClaim.has(_tag)) || !canContinue) {
        return done("refused", counted);
      }

      return {
        next: Next.Resume({
          nudge: false,
          prompt: refusalPrompt({ answer, project, refusals }),
        }),
        progress: { ...counted, continuations: progress.continuations + 1 },
      };
    },
    WaitingOnParent: () => done("waiting", judged),
  });
};

/** The tags of the refusals status shows for the ask's latest answer. */
const tagsOf = ({ answer }: AskStatus) =>
  Option.match(answer, {
    onNone: () => "",
    onSome: ({ outcome }) =>
      Outcome.guards.Refused(outcome)
        ? outcome.refusals.map(({ _tag }) => _tag).join(", ")
        : "",
  });

/** A count of tokens, in thousands when large. */
const tokens = (count: number) =>
  count >= 10_000 ? `${Math.round(count / 1000)}k` : `${count}`;

export const runAgent: RunAgent = (input) =>
  Effect.gen(function* () {
    const { assignment, workspace } = input;
    const { adapter, handle, harness, model } = assignment.contributor;
    const driver = drivers[harness];
    const project = Option.fromUndefinedOr(input.project);
    const begun = yield* Clock.currentTimeMillis;
    const progress = yield* Ref.make(started);

    const say = (line: string) =>
      Console.error(scrubbed(`${handle}: ${line}`, workspace));

    /**
     * One harness session (the start, or a continuation with `argv`), then
     * what status says; it calls itself for each continuation, until
     * `afterSettle` says the run is done.
     */
    const pass = (
      argv: readonly string[],
      env: Readonly<Record<string, string>>
    ): Effect.Effect<
      AgentOutcome,
      SwarmFailed,
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        const attempts = (yield* Ref.get(progress)).attempts + 1;

        const ran = yield* attempt({
          argv,
          driver,
          env,
          file: `${workspace.dir}/attempt-${attempts}.jsonl`,
          onSession: Ref.update(progress, (now) => ({
            ...now,
            attempts: Math.max(now.attempts, attempts),
          })),
          workspace,
        });

        const { session } = ran.heard;

        const ended = Option.match(ran.code, {
          onNone: () => "still running",
          onSome: (code) => `exit ${code}`,
        });

        if (Option.isNone(session)) {
          return yield* new SwarmFailed({
            reason: `${harness} ended (${ended}) before it started a session${ran.stderr === "" ? "" : `: ${ran.stderr}`}`,
          });
        }

        yield* say(
          `attempt ${attempts} ${ran.heard.settled ? "settled" : "ended"} (${Option.getOrElse(ran.heard.stopReason, () => ended)}), ${tokens(ran.heard.input)} tokens in, ${tokens(ran.heard.output)} out`
        );

        const status = yield* awaitSettledOutcome({
          ask: assignment.ask,
          project,
          workspace,
        });

        const broke = Option.orElse(ran.heard.failure, () =>
          Option.filter(ran.code, (code) => code !== 0).pipe(
            Option.map((code) =>
              ran.stderr === "" ? `exit ${code}` : `exit ${code}: ${ran.stderr}`
            )
          )
        );

        const step = afterSettle({
          ask: assignment.ask,
          broke,
          maxContinuations: input.maxContinuations,
          progress: yield* Ref.get(progress),
          project,
          status,
        });

        yield* Ref.set(progress, step.progress);

        if (Next.$is("Done")(step.next)) {
          if (step.next.outcome === "failed") {
            yield* say(
              `${harness} failed: ${Option.getOrElse(broke, () => "no reason given")}`
            );
          }

          return step.next.outcome;
        }

        yield* say(
          `${step.next.nudge ? "no new answer, so a nudge" : `refused ${tagsOf(status)}, so the refusal`} goes back into the session (continuation ${step.progress.continuations} of ${input.maxContinuations})`
        );

        return yield* pass(
          driver.resume({
            adapter,
            model,
            prompt: step.next.prompt,
            session: session.value,
            workspace,
          }),
          env
        );
      });

    const loop = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      yield* Effect.forEach(
        driver.files(workspace),
        ({ content, path }) => fs.writeFileString(path, content),
        { discard: true }
      ).pipe(
        Effect.mapError(
          ({ message }) =>
            new SwarmFailed({
              reason: `${harness}'s settings: ${message}`,
            })
        )
      );

      return yield* pass(
        driver.start({
          adapter,
          brief: input.brief,
          model,
          sessionDir: sessionDirOf(workspace.dir),
          sessionKey: handle,
          workspace,
        }),
        yield* harnessEnv(workspace)
      );
    });

    const outcome = yield* loop.pipe(
      Effect.timeoutOption(Duration.millis(input.timeoutMs)),
      Effect.map(Option.getOrElse((): AgentOutcome => "timedOut")),
      Effect.catchTag(
        "SwarmFailed",
        ({ reason }): Effect.Effect<AgentOutcome> =>
          Effect.as(say(reason), "failed")
      )
    );

    const finished = yield* Clock.currentTimeMillis;
    const at = yield* Ref.get(progress);

    yield* say(`${outcome} after ${at.attempts} attempts`);

    return {
      adapter,
      ask: assignment.ask,
      attempts: at.attempts,
      durationMs: finished - begun,
      handle,
      harness,
      model,
      outcome,
      refusals: at.refusals,
      ...Option.match(at.landed, {
        onNone: () => ({}),
        onSome: (landed) => ({ landed }),
      }),
    };
  });
