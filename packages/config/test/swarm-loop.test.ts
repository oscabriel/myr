/**
 * The swarm's verdict loop (issue 711): each contributor's harness started
 * headless on the brief, and every refusal their answer meets sent back into
 * the same session, at most three times. The loop reads outcomes only from
 * the contributor's `<cli> status --json`; a harness's output gives it the
 * session id, that the session settled, and the tokens it used.
 *
 * The harness output under `fixtures/swarm/harness-output/<harness>/` is
 * what each installed harness printed for one headless start and one resume
 * on 2026-10-08, its local paths replaced and the user's own setup (tool,
 * MCP, plugin and skill lists, pi's system prompt) left out.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import {
  ChecksFailed,
  ClaimLapsed,
  OutOfScope,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Ref,
  Schema,
  Sink,
  Stream,
} from "effect";
import type { Array } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";

import {
  drivers,
  HarnessEvent,
} from "../../../scripts/lib/swarm/harnesses/index.ts";
import type { HarnessDriver } from "../../../scripts/lib/swarm/harnesses/index.ts";
import { runAgent, startCommand } from "../../../scripts/lib/swarm/loop.ts";
import type { Assignment } from "../../../scripts/lib/swarm/plan.ts";
import type { Harness } from "../../../scripts/lib/swarm/results.ts";
import { roster } from "../../../scripts/lib/swarm/roster.ts";
import type { AgentWorkspace } from "../../../scripts/lib/swarm/workspace.ts";
import { Brand } from "../../brand/src/index.ts";
import { repoRoot } from "./root.ts";

/** The env names the CLI reads, spelled from the brand. */
const SLUG = Brand.slug.toUpperCase();

const token = "wren-token-0123456789abcdef0123456789abcdef";

const platformUrl = "https://platform-dev-oscabriel.example.workers.dev";

const ask = AskId.make("drop-legacy-fetch-burrow-auth");

/** A harness's recorded output: `start`, `resume`, or OpenCode's `refused-model`. */
const recorded = (
  harness: Harness,
  run: "start" | "resume" | "refused-model"
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const text = yield* fs.readFileString(
      path.join(
        "test",
        "fixtures",
        "swarm",
        "harness-output",
        harness,
        `${run}.jsonl`
      )
    );

    return text.split("\n").filter((line) => line !== "");
  }).pipe(Effect.provide(NodeServices.layer));

/** Everything one recorded run's lines say, in order. */
const heard = (driver: HarnessDriver, lines: readonly string[]) =>
  lines.flatMap(driver.parse);

const sessionsIn = (events: readonly HarnessEvent[]) =>
  events.flatMap((event) =>
    HarnessEvent.$is("SessionStarted")(event) ? [event.id] : []
  );

// The commits of four answers, and the landing of the last.
const heads = ["1", "2", "3", "4"].map((digit) =>
  CommitSha.make(digit.repeat(40))
);

const landing = LandedSha.make(CommitSha.make("a".repeat(40)));

/** One answer to the ask, `n` seconds after noon, with its outcome. */
const answer = (n: number, outcome: Outcome): AnswerView => ({
  ask,
  at: DateTime.makeUnsafe(`2026-10-08T12:00:0${n}.000Z`),
  head: heads[n] ?? CommitSha.make("f".repeat(40)),
  outcome,
  requestId: RequestId.make(`push-${heads[n] ?? "f".repeat(40)}-wren`),
});

const refused = (...refusals: Array.NonEmptyReadonlyArray<Refusal>) =>
  Outcome.cases.Refused.make({ refusals });

const outOfScope = new OutOfScope({
  paths: [RepoPath.make("packages/billing/src/index.ts")],
});

const staleBase = new StaleBase({
  base: CommitSha.make("b".repeat(40)),
  conflicts: [],
  main: CommitSha.make("c".repeat(40)),
});

const checksFailed = new ChecksFailed({
  lane: "test",
  logRef: "log-0001",
  next: `${Brand.cli} evidence log-0001`,
});

const wrensClaim: ClaimView = Schema.decodeSync(ClaimView)({
  ask,
  base: "9998ebe62c2f282d148b1d806372484916cc2548",
  checkCommand: `${Brand.cli} check`,
  claimant: "wren",
  fork: "burrow--drop-legacy-fetch-burrow-auth--wren",
  lapsesAt: "2026-10-09T05:00:00.000Z",
  openedAt: "2026-10-08T05:00:00.000Z",
  project: "burrow",
  remote: `${platformUrl}/burrow--drop-legacy-fetch-burrow-auth--wren.git`,
  state: "live",
  warnsAt: "2026-10-08T17:00:00.000Z",
});

const StatusJson = Schema.fromJsonString(
  Envelope(
    Schema.Struct({
      answers: Schema.Array(AnswerView),
      claims: Schema.Array(ClaimView),
      handle: Handle,
    })
  )
);

/** What `<cli> status --json` prints for wren with these answers. */
const status = (...answers: readonly AnswerView[]) =>
  Schema.encodeSync(StatusJson)({
    command: "status",
    data: { answers, claims: [wrensClaim], handle: Handle.make("wren") },
    ok: true,
    v: 1,
  });

/** One command the fake spawner was asked to run. */
interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly extendEnv: boolean | undefined;
}

/** How a scripted harness run goes: its stdout lines and exit code, or it never ends. */
type HarnessRun =
  | { readonly lines: readonly string[]; readonly code?: number }
  | { readonly stalls: readonly string[] };

const bytes = (text: string) => new TextEncoder().encode(text);

/** A process handle that prints `stdout` and ends with `exitCode`. */
const handleOf = (input: {
  readonly stdout: Stream.Stream<Uint8Array>;
  readonly exitCode: Effect.Effect<number>;
}) =>
  ChildProcessSpawner.makeHandle({
    all: input.stdout,
    exitCode: Effect.map(input.exitCode, ChildProcessSpawner.ExitCode),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: Stream.empty,
    stdin: Sink.drain,
    stdout: input.stdout,
    unref: Effect.succeed(Effect.void),
  });

/**
 * A `ChildProcessSpawner` that runs nothing. The workspace's CLI answers
 * `status` with the next of `statuses` (the last one again once they run
 * out); any other command is a harness, and plays the next of `harness`.
 */
const fakeWorld = (script: {
  readonly harness: readonly HarnessRun[];
  readonly statuses: readonly string[];
}) =>
  Effect.gen(function* () {
    const spawned = yield* Ref.make<readonly Spawned[]>([]);
    const runs = yield* Ref.make(script.harness);
    const statuses = yield* Ref.make(script.statuses);

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("the swarm pipes no commands");
        }

        yield* Ref.update(spawned, (calls) => [
          ...calls,
          {
            args: command.args,
            command: command.command,
            cwd: command.options.cwd,
            env: command.options.env ?? {},
            extendEnv: command.options.extendEnv,
          },
        ]);

        if (command.command.endsWith(`/bin/${Brand.cli}`)) {
          const [next = "", ...rest] = yield* Ref.get(statuses);

          if (rest.length > 0) {
            yield* Ref.set(statuses, rest);
          }

          return handleOf({
            exitCode: Effect.succeed(0),
            stdout: Stream.make(bytes(`${next}\n`)),
          });
        }

        const [next, ...rest] = yield* Ref.get(runs);

        yield* Ref.set(runs, rest);

        if (next === undefined) {
          return yield* Effect.die(
            `no harness run scripted for ${command.command}`
          );
        }

        return "stalls" in next
          ? handleOf({
              exitCode: Effect.never,
              stdout: Stream.make(bytes(`${next.stalls.join("\n")}\n`)).pipe(
                Stream.concat(Stream.never)
              ),
            })
          : handleOf({
              exitCode: Effect.succeed(next.code ?? 0),
              stdout: Stream.make(bytes(`${next.lines.join("\n")}\n`)),
            });
      })
    );

    return {
      harnessRuns: Effect.map(Ref.get(spawned), (calls) =>
        calls.filter(({ command }) => !command.endsWith(`/bin/${Brand.cli}`))
      ),
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      spawned: Ref.get(spawned),
    };
  });

/**
 * A file system in memory: directories always exist, and a write (or an
 * append, with flag `a`) lands in `files`. The loop's writes are then as
 * synchronous as the fake processes, so the TestClock moves deterministically.
 */
const memoryFs = (files: Map<string, string>) =>
  FileSystem.makeNoop({
    makeDirectory: () => Effect.void,
    writeFileString: (path, data, options) =>
      Effect.sync(() => {
        files.set(
          path,
          options?.flag === "a" ? `${files.get(path) ?? ""}${data}` : data
        );
      }),
  });

/** wren's workspace for run `r1`. */
const dir = "/work/.swarm/r1/wren";

const wrensWorkspace: AgentWorkspace = {
  clone: `${dir}/clone`,
  dir,
  env: {
    GIT_TERMINAL_PROMPT: "0",
    PATH: `${dir}/bin:/usr/bin`,
    [`${SLUG}_TOKEN`]: token,
    [`${SLUG}_URL`]: platformUrl,
    XDG_CONFIG_HOME: `${dir}/config`,
  },
  redacted: [`${SLUG}_TOKEN`],
};

/** The swarm's own env: the user's HOME, and secrets no harness may see. */
const swarmEnv = ConfigProvider.fromEnv({
  env: {
    CLAUDECODE: "1",
    CLOUDFLARE_API_TOKEN: "cf-secret",
    HOME: "/home/user",
    SESSION_TOKENS: JSON.stringify({ [token]: "wren" }),
  },
});

const [wren, tamsin, ivo] = roster;

/**
 * `runAgent` for `contributor` on burrow's auth child, over a fake world and
 * a file system in memory. It runs forked, so `clock` can move the TestClock
 * while it runs.
 */
const agentRun = (input: {
  readonly harness: readonly HarnessRun[];
  readonly statuses: readonly string[];
  readonly contributor?: Assignment["contributor"];
  readonly timeoutMs?: number;
  readonly clock?: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const world = yield* fakeWorld(input);
    const files = new Map<string, string>();
    const said: string[] = [];

    const captured: Console.Console = {
      ...console,
      error: (...args: readonly unknown[]) => {
        said.push(args.map(String).join(" "));
      },
      log: (...args: readonly unknown[]) => {
        said.push(args.map(String).join(" "));
      },
    };

    const fiber = yield* runAgent({
      assignment: {
        ask,
        contributor: input.contributor ?? wren,
        territory: "@burrow/auth",
      },
      brief: "Answer the ask.",
      maxContinuations: 3,
      timeoutMs: input.timeoutMs ?? 1_200_000,
      workspace: wrensWorkspace,
    }).pipe(
      Effect.provide(world.layer),
      Effect.provideService(FileSystem.FileSystem, memoryFs(files)),
      Effect.provideService(Console.Console, captured),
      Effect.provideService(ConfigProvider.ConfigProvider, swarmEnv),
      Effect.forkChild
    );

    yield* input.clock ?? Effect.void;

    const result = yield* Fiber.join(fiber);

    return {
      files,
      harnessRuns: yield* world.harnessRuns,
      result,
      said,
      spawned: yield* world.spawned,
    };
  });

/** The prompt a harness run carried: its last argument. */
const promptOf = (run: Spawned | undefined) => run?.args.at(-1) ?? "";

describe("the verdict loop", () => {
  it.effect(
    "resumes the same session on OutOfScope, then on StaleBase, and stops when the answer lands",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const resume = yield* recorded("claude-code", "resume");
        const [session] = sessionsIn(heard(drivers["claude-code"], start));

        const first = answer(1, refused(outOfScope));
        const second = answer(2, refused(staleBase));
        const third = answer(3, Outcome.cases.Landed.make({ sha: landing }));

        const { harnessRuns, result } = yield* agentRun({
          harness: [{ lines: start }, { lines: resume }, { lines: resume }],
          statuses: [
            status(first),
            status(first, second),
            status(first, second, third),
          ],
        });

        expect(result).toStrictEqual({
          adapter: false,
          ask,
          attempts: 3,
          durationMs: 0,
          handle: "wren",
          harness: "claude-code",
          landed: landing,
          model: "claude-opus-5-5",
          outcome: "landed",
          refusals: { OutOfScope: 1, StaleBase: 1 },
        });

        const [, afterOutOfScope, afterStaleBase] = harnessRuns;

        expect(
          [afterOutOfScope, afterStaleBase].map(
            (run) => run?.args.slice(-3, -1) ?? []
          )
        ).toStrictEqual([
          ["--resume", session],
          ["--resume", session],
        ]);
        expect(promptOf(afterOutOfScope)).toContain(
          [...explain([outOfScope]), "", `Next: ${outOfScope.next}`].join("\n")
        );
        expect(promptOf(afterStaleBase)).toContain(`Next: ${staleBase.next}`);
      })
  );

  it.effect(
    "gives up as refused after three continuations when a fourth refusal comes back",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const resume = yield* recorded("claude-code", "resume");

        const answers = [1, 2, 3, 4].map((n) =>
          answer(n, refused(checksFailed))
        );

        const { harnessRuns, result } = yield* agentRun({
          harness: [
            { lines: start },
            { lines: resume },
            { lines: resume },
            { lines: resume },
            { lines: resume },
          ],
          statuses: answers.map((_, n) => status(...answers.slice(0, n + 1))),
        });

        expect([
          result.outcome,
          result.attempts,
          result.refusals,
        ]).toStrictEqual(["refused", 4, { ChecksFailed: 4 }]);
        expect(harnessRuns).toHaveLength(4);
      })
  );

  it.effect("stops at once on a refusal that ends the claim", () =>
    Effect.gen(function* () {
      const start = yield* recorded("claude-code", "start");

      const { harnessRuns, result } = yield* agentRun({
        harness: [{ lines: start }],
        statuses: [status(answer(1, refused(ClaimLapsed.of(ask))))],
      });

      expect([result.outcome, result.attempts, result.refusals]).toStrictEqual([
        "refused",
        1,
        { ClaimLapsed: 1 },
      ]);
      expect(harnessRuns).toHaveLength(1);
    })
  );

  it.effect(
    "records a run that never settles as timedOut when its timeout passes on the clock",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");

        const { result } = yield* agentRun({
          clock: TestClock.adjust("10 minutes"),
          harness: [{ stalls: start.slice(0, 3) }],
          statuses: [status()],
          timeoutMs: 600_000,
        });

        expect([
          result.outcome,
          result.attempts,
          result.durationMs,
        ]).toStrictEqual(["timedOut", 1, 600_000]);
      })
  );

  it.effect(
    "asks status again every five seconds while the answer is being checked",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const checking = Outcome.cases.Checking.make({ stage: "checks" });

        const { result, spawned } = yield* agentRun({
          clock: Effect.gen(function* () {
            yield* TestClock.adjust("5 seconds");
            yield* TestClock.adjust("5 seconds");
          }),
          harness: [{ lines: start }],
          statuses: [
            status(answer(1, checking)),
            status(answer(1, checking)),
            status(answer(1, Outcome.cases.Landed.make({ sha: landing }))),
          ],
        });

        expect([result.outcome, result.attempts, result.landed]).toStrictEqual([
          "landed",
          1,
          landing,
        ]);
        expect(
          spawned.filter(({ command }) => command.endsWith(`/bin/${Brand.cli}`))
        ).toHaveLength(3);
      })
  );

  it.effect(
    "records an answer waiting on a decision or a finish as waiting, without a continuation",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");

        const waits = [
          Outcome.cases.AwaitingDecision.make({
            decision: DecisionId.make("dec-000001"),
          }),
          Outcome.cases.AwaitingFinish.make({}),
        ];

        const results = yield* Effect.forEach(waits, (waiting) =>
          agentRun({
            harness: [{ lines: start }],
            statuses: [status(answer(1, waiting))],
          })
        );

        expect(
          results.map(({ harnessRuns, result }) => [
            result.outcome,
            result.attempts,
            harnessRuns.length,
          ])
        ).toStrictEqual([
          ["waiting", 1, 1],
          ["waiting", 1, 1],
        ]);
      })
  );

  it.effect(
    "nudges once, naming the claim's remote, when no answer was pushed, then records noAnswer",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const resume = yield* recorded("claude-code", "resume");

        const { harnessRuns, result } = yield* agentRun({
          harness: [{ lines: start }, { lines: resume }, { lines: resume }],
          statuses: [status()],
        });

        expect([result.outcome, result.attempts]).toStrictEqual([
          "noAnswer",
          2,
        ]);
        expect(promptOf(harnessRuns[1])).toContain(wrensClaim.remote);
      })
  );

  it.effect(
    "takes an old answer status still shows after a continuation as no new answer, and nudges with the head it last saw",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const resume = yield* recorded("claude-code", "resume");
        const first = answer(1, refused(checksFailed));

        const { harnessRuns, result } = yield* agentRun({
          harness: [{ lines: start }, { lines: resume }, { lines: resume }],
          statuses: [status(first)],
        });

        expect([
          result.outcome,
          result.attempts,
          result.refusals,
        ]).toStrictEqual(["refused", 3, { ChecksFailed: 1 }]);

        // An answer did arrive: the nudge must not say none ever did.
        const nudge = promptOf(harnessRuns[2]);

        expect(nudge).toContain(`since ${first.head.slice(0, 7)}`);
        expect(nudge).not.toContain("yet");
      })
  );

  it.effect(
    "sends a refusal on the platform's side back as a wait, not as something to fix",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");
        const resume = yield* recorded("claude-code", "resume");
        const blocked = answer(1, refused(new VerifierBlocked({})));
        const landed = answer(2, Outcome.cases.Landed.make({ sha: landing }));

        const { harnessRuns, result } = yield* agentRun({
          harness: [{ lines: start }, { lines: resume }],
          statuses: [status(blocked), status(blocked, landed)],
        });

        expect([
          result.outcome,
          result.attempts,
          result.refusals,
        ]).toStrictEqual(["landed", 2, { VerifierBlocked: 1 }]);

        const prompt = promptOf(harnessRuns[1]);

        expect(prompt).toContain("not a fault in your change");
        expect(prompt).toContain("git commit --allow-empty");
        expect(prompt).not.toContain("Fix what the refusal names");
      })
  );

  it.effect(
    "counts the refusals of every answer one session pushed, not only its last",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");

        // The brief tells the agent to read status and push again, so one
        // session can push several answers before it settles.
        const { harnessRuns, result } = yield* agentRun({
          harness: [{ lines: start }],
          statuses: [
            status(
              answer(1, refused(outOfScope)),
              answer(2, refused(staleBase)),
              answer(3, Outcome.cases.Landed.make({ sha: landing }))
            ),
          ],
        });

        expect([
          result.outcome,
          result.attempts,
          result.refusals,
        ]).toStrictEqual(["landed", 1, { OutOfScope: 1, StaleBase: 1 }]);
        expect(harnessRuns).toHaveLength(1);
      })
  );

  it.effect(
    "asks status again when a read fails, rather than ending the run",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");

        const { result, spawned } = yield* agentRun({
          clock: TestClock.adjust("5 seconds"),
          harness: [{ lines: start }],
          statuses: [
            "error: fetch failed",
            status(answer(1, Outcome.cases.Landed.make({ sha: landing }))),
          ],
        });

        expect([result.outcome, result.attempts]).toStrictEqual(["landed", 1]);
        expect(
          spawned.filter(({ command }) => command.endsWith(`/bin/${Brand.cli}`))
        ).toHaveLength(2);
      })
  );

  it.effect(
    "records a pi run whose provider failed as failed, though pi exits 0",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("pi", "start");

        const finalResponse = start.findLastIndex((line) =>
          line.startsWith('{"type":"message_end","message":{"role":"assistant"')
        );

        // pi's last response as JSON mode prints it when the provider fails.
        const failing = start.map((line, index) =>
          index === finalResponse
            ? line.replace(
                '"stopReason":"stop"',
                '"stopReason":"error","errorMessage":"429 Too Many Requests"'
              )
            : line
        );

        const { harnessRuns, result, said } = yield* agentRun({
          contributor: roster[3],
          harness: [{ code: 0, lines: failing }, { lines: [] }],
          statuses: [status()],
        });

        expect(failing[finalResponse]).toContain('"stopReason":"error"');
        expect([
          result.outcome,
          result.attempts,
          harnessRuns.length,
        ]).toStrictEqual(["failed", 1, 1]);
        expect(said).toContainEqual(
          expect.stringContaining(
            "marisol: pi failed: error: 429 Too Many Requests"
          )
        );
      })
  );

  it.effect(
    "records a harness that exits before it starts a session as failed",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* agentRun({
          harness: [{ code: 1, lines: [] }],
          statuses: [status()],
        });

        expect([result.outcome, result.attempts]).toStrictEqual(["failed", 0]);
        expect(spawned).toHaveLength(1);
      })
  );

  it.effect(
    "records a harness whose provider refused the model as failed, without a nudge, saying why",
    () =>
      Effect.gen(function* () {
        const refusedModel = yield* recorded("opencode", "refused-model");

        const { harnessRuns, result, said } = yield* agentRun({
          contributor: tamsin,
          harness: [{ code: 1, lines: refusedModel }, { lines: [] }],
          statuses: [status()],
        });

        expect([
          result.outcome,
          result.attempts,
          harnessRuns.length,
        ]).toStrictEqual(["failed", 1, 1]);
        expect(said).toContainEqual(
          expect.stringContaining(
            "tamsin: opencode failed: provider.invalid-request: The 'gpt-6.1-sol' model is not supported"
          )
        );
      })
  );

  it.effect(
    "runs the harness in the clone with the workspace's env and only the user's HOME from the swarm's, and keeps each attempt's output, the token blanked",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("claude-code", "start");

        // A tool's output that printed the token, before the run's result.
        const leaky = [
          ...start.slice(0, -1),
          `{"type":"note","text":"${token}"}`,
          ...start.slice(-1),
        ];

        const { files, harnessRuns } = yield* agentRun({
          harness: [{ lines: leaky }],
          statuses: [
            status(answer(1, Outcome.cases.Landed.make({ sha: landing }))),
          ],
        });

        const [run] = harnessRuns;

        expect([run?.cwd, run?.extendEnv, run?.env]).toStrictEqual([
          wrensWorkspace.clone,
          false,
          { ...wrensWorkspace.env, HOME: "/home/user" },
        ]);
        expect(files.get(`${dir}/attempt-1.jsonl`)).toBe(
          `${[...start.slice(0, -1), '{"type":"note","text":"<redacted>"}', ...start.slice(-1)].join("\n")}\n`
        );
      })
  );

  it.effect(
    "writes Amp's settings into the workspace before Amp starts, and starts it there",
    () =>
      Effect.gen(function* () {
        const start = yield* recorded("amp", "start");

        const { files, harnessRuns } = yield* agentRun({
          contributor: ivo,
          harness: [{ lines: start }],
          statuses: [
            status(answer(1, Outcome.cases.Landed.make({ sha: landing }))),
          ],
        });

        expect(harnessRuns[0]?.args).toContain(`${dir}/amp-settings.json`);
        expect(
          JSON.parse(files.get(`${dir}/amp-settings.json`) ?? "{}")
        ).toStrictEqual({ "amp.dangerouslyAllowAll": true });
      })
  );
});

/** A workspace for the golden argv: `/work/.swarm/r1/<handle>`. */
const goldenWorkspace = (handle: string): AgentWorkspace => ({
  clone: `/work/.swarm/r1/${handle}/clone`,
  dir: `/work/.swarm/r1/${handle}`,
  env: {},
  redacted: [],
});

describe("the harness drivers", () => {
  it.effect(
    "start and resume each harness with the flags its --help lists",
    () =>
      Effect.gen(function* () {
        const root = yield* repoRoot;
        const adapter = `${root}/apps/cli/src/pi.ts`;

        const argv = roster.map(
          ({ adapter: withAdapter, handle, harness, model }) => {
            const workspace = goldenWorkspace(handle);
            const driver = drivers[harness];

            return {
              resume: driver.resume({
                adapter: withAdapter,
                model,
                prompt: "Fix it.",
                session: "S-1",
                workspace,
              }),
              start: driver.start({
                adapter: withAdapter,
                brief: "Answer it.",
                model,
                sessionDir: `${workspace.dir}/sessions`,
                sessionKey: handle,
                workspace,
              }),
            };
          }
        );

        expect(argv).toStrictEqual([
          {
            resume: [
              "claude",
              "-p",
              "--output-format",
              "stream-json",
              "--verbose",
              "--permission-mode",
              "bypassPermissions",
              "--strict-mcp-config",
              "--model",
              "claude-opus-5-5",
              "--resume",
              "S-1",
              "Fix it.",
            ],
            start: [
              "claude",
              "-p",
              "--output-format",
              "stream-json",
              "--verbose",
              "--permission-mode",
              "bypassPermissions",
              "--strict-mcp-config",
              "--model",
              "claude-opus-5-5",
              "Answer it.",
            ],
          },
          {
            resume: [
              "opencode",
              "run",
              "--standalone",
              "--format",
              "json",
              "--auto",
              "-m",
              "openai/gpt-5.5",
              "-s",
              "S-1",
              "Fix it.",
            ],
            start: [
              "opencode",
              "run",
              "--standalone",
              "--format",
              "json",
              "--auto",
              "-m",
              "openai/gpt-5.5",
              "Answer it.",
            ],
          },
          {
            resume: [
              "amp",
              "threads",
              "continue",
              "S-1",
              "-x",
              "Fix it.",
              "--stream-json",
              "-m",
              "medium",
              "--settings-file",
              "/work/.swarm/r1/ivo/amp-settings.json",
              "--no-archive-after-execute",
            ],
            start: [
              "amp",
              "-x",
              "Answer it.",
              "--stream-json",
              "-m",
              "medium",
              "--settings-file",
              "/work/.swarm/r1/ivo/amp-settings.json",
              "--no-archive-after-execute",
            ],
          },
          ...[
            ["marisol", "opencode-go/kimi-k3"],
            ["dagny", "opencode-go/glm-5.3"],
          ].map(([handle = "", model = ""]) => ({
            resume: [
              "pi",
              "-p",
              "--mode",
              "json",
              "--no-mcp",
              "--session-dir",
              `/work/.swarm/r1/${handle}/sessions`,
              "--session-id",
              "S-1",
              "--model",
              model,
              "Fix it.",
            ],
            start: [
              "pi",
              "-p",
              "--mode",
              "json",
              "--no-mcp",
              "--session-dir",
              `/work/.swarm/r1/${handle}/sessions`,
              "--session-id",
              handle,
              "--model",
              model,
              "Answer it.",
            ],
          })),
          {
            resume: [
              "pi",
              "-p",
              "--mode",
              "json",
              "--no-mcp",
              "--session-dir",
              "/work/.swarm/r1/pell/sessions",
              "--session-id",
              "S-1",
              "--model",
              "opencode/gemini-3.8-flash",
              "-e",
              adapter,
              "Fix it.",
            ],
            start: [
              "pi",
              "-p",
              "--mode",
              "json",
              "--no-mcp",
              "--session-dir",
              "/work/.swarm/r1/pell/sessions",
              "--session-id",
              "pell",
              "--model",
              "opencode/gemini-3.8-flash",
              "-e",
              adapter,
              "Answer it.",
            ],
          },
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it("prints the same start command in the plan as each driver's start", () => {
    expect(
      roster.map((contributor) =>
        startCommand({
          brief: "Answer it.",
          contributor,
          dir: `/work/.swarm/r1/${contributor.handle}`,
        })
      )
    ).toStrictEqual(
      roster.map(({ adapter, handle, harness, model }) =>
        drivers[harness].start({
          adapter,
          brief: "Answer it.",
          model,
          sessionDir: `/work/.swarm/r1/${handle}/sessions`,
          sessionKey: handle,
          workspace: goldenWorkspace(handle),
        })
      )
    );
  });

  it.effect(
    "reads the session id, the settling and the tokens from each harness's recorded output, the same session on resume",
    () =>
      Effect.gen(function* () {
        const harnesses = ["claude-code", "opencode", "amp", "pi"] as const;

        const read = yield* Effect.forEach(harnesses, (harness) =>
          Effect.gen(function* () {
            const driver = drivers[harness];
            const start = heard(driver, yield* recorded(harness, "start"));
            const resume = heard(driver, yield* recorded(harness, "resume"));

            const settled = start.filter(HarnessEvent.$is("Settled"));

            return {
              harness,
              resumedSame:
                new Set([...sessionsIn(start), ...sessionsIn(resume)]).size ===
                1,
              sessions: sessionsIn(start).length > 0,
              settled: settled.length,
              tokens: start.some(
                (event) =>
                  HarnessEvent.$is("Usage")(event) &&
                  event.input > 0 &&
                  event.output > 0
              ),
            };
          })
        );

        expect(
          heard(drivers.opencode, yield* recorded("opencode", "refused-model"))
            .filter(HarnessEvent.$is("Failed"))
            .map(({ reason }) => reason)
        ).toStrictEqual([
          "provider.invalid-request: The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
        ]);
        expect(read).toStrictEqual([
          {
            harness: "claude-code",
            resumedSame: true,
            sessions: true,
            settled: 1,
            tokens: true,
          },
          // OpenCode prints no event when its run ends: the process exiting settles it.
          {
            harness: "opencode",
            resumedSame: true,
            sessions: true,
            settled: 0,
            tokens: true,
          },
          {
            harness: "amp",
            resumedSame: true,
            sessions: true,
            settled: 1,
            tokens: true,
          },
          {
            harness: "pi",
            resumedSame: true,
            sessions: true,
            settled: 1,
            tokens: true,
          },
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
