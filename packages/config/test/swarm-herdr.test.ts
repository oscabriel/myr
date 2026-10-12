import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";

import { LedgerFile } from "../../../infra/created.ts";
import { repoRoot } from "../../../infra/stages.ts";
import { piAdapter } from "../../../scripts/lib/swarm/harnesses/pi.ts";
import { AgentsResult, SwarmDir } from "../../../scripts/lib/swarm/results.ts";
import { roster } from "../../../scripts/lib/swarm/roster.ts";
import {
  counterLine,
  followCounter,
  lastHeld,
} from "../../../scripts/lib/swarm/views/counter.ts";
import { Turn } from "../../../scripts/lib/swarm/views/headless.ts";
import {
  herdrLayout,
  herdrPrompt,
  herdrStart,
  herdrView,
  interactiveLaunch,
} from "../../../scripts/lib/swarm/views/herdr.ts";
import type { AgentWorkspace } from "../../../scripts/lib/swarm/workspace.ts";
import { main } from "../../../scripts/swarm.ts";
import { Brand } from "../../brand/src/index.ts";

const handles = ["wren", "tamsin", "ivo", "marisol", "dagny", "pell"];

const children = ["auth", "billing", "catalog", "kit", "notify", "search"].map(
  (module) => AskId.make(`drop-legacy-fetch-burrow-${module}`)
);

const sha = (digit: number) => CommitSha.make(String(digit).repeat(40));

const stamp = (n: number) => ({
  at: DateTime.makeUnsafe(
    `2026-10-08T12:${String(10 + n).padStart(2, "0")}:00.000Z`
  ),
  seq: 100 + n,
});

const takeEvents: readonly ProjectEvent[] = [
  ...children.map((ask, at) =>
    ProjectEvent.cases.Claimed.make({
      ...stamp(at),
      ask,
      claimant: Handle.make(handles[at] ?? "wren"),
    })
  ),
  ...[...children, ...children.slice(0, 3)].map((ask, at) =>
    ProjectEvent.cases.Pushed.make({ ...stamp(6 + at), ask, head: sha(at) })
  ),
  ProjectEvent.cases.Judged.make({
    ...stamp(15),
    ask: AskId.make("drop-legacy-fetch-burrow-auth"),
    head: sha(0),
    outcome: Outcome.cases.Checking.make({ stage: "shape" }),
  }),
  ...children.slice(0, 4).map((ask, at) =>
    ProjectEvent.cases.Landed.make({
      ...stamp(16 + at),
      landing: {
        ask,
        assisted: [],
        author: Handle.make(handles[at] ?? "wren"),
        credits: [],
        landedAt: DateTime.makeUnsafe("2026-10-08T12:40:00.000Z"),
        project: ProjectName.make("oscabriel/burrow"),
        sha: LandedSha.make(sha(at + 5)),
      },
    })
  ),
  ProjectEvent.cases.Released.make({
    ...stamp(20),
    ask: AskId.make("drop-legacy-fetch-burrow-search"),
  }),
];

describe("the counter", () => {
  it.effect("reads a take's events as claims, pushes and landings", () =>
    Effect.sync(() => {
      expect(counterLine(takeEvents)).toBe("claims 6 · pushes 9 · landed 4");
      expect(counterLine([])).toBe("claims 0 · pushes 0 · landed 0");
    })
  );
});

describe("the panes", () => {
  it.effect(
    "lay six contributors out in two rows of three over a counter strip, each split keeping its share",
    () =>
      Effect.sync(() => {
        expect(herdrLayout(handles)).toStrictEqual([
          { direction: "down", from: "wren", ratio: 0.85, slot: "counter" },
          { direction: "down", from: "wren", ratio: 0.5, slot: "marisol" },
          { direction: "right", from: "wren", ratio: 0.333, slot: "tamsin" },
          { direction: "right", from: "tamsin", ratio: 0.5, slot: "ivo" },
          { direction: "right", from: "marisol", ratio: 0.333, slot: "dagny" },
          { direction: "right", from: "dagny", ratio: 0.5, slot: "pell" },
        ]);
        expect(herdrLayout(["wren"])).toStrictEqual([
          { direction: "down", from: "wren", ratio: 0.85, slot: "counter" },
        ]);
        expect(
          herdrLayout(handles.slice(0, 5)).map(({ slot }) => slot)
        ).toStrictEqual(["counter", "marisol", "tamsin", "ivo", "dagny"]);
      })
  );

  it.effect(
    "start each harness interactively with its driver's flags, less what only headless mode needs",
    () =>
      Effect.sync(() => {
        const launches = roster.map((contributor) =>
          interactiveLaunch({
            contributor,
            dir: `/work/.swarm/r1/${contributor.handle}`,
          })
        );

        expect(launches).toStrictEqual([
          {
            argv: [
              "--permission-mode",
              "bypassPermissions",
              "--strict-mcp-config",
              "--model",
              "claude-opus-5-5",
            ],
            env: {},
            kind: "claude",
          },
          {
            argv: ["--standalone", "--auto"],
            // OpenCode's interface takes no model flag: its inline config does.
            env: {
              OPENCODE_CONFIG_CONTENT: '{"model":"opencode-go/gpt-6-luna"}',
            },
            kind: "opencode",
          },
          {
            argv: [
              "-m",
              "medium",
              "--settings-file",
              "/work/.swarm/r1/ivo/amp-settings.json",
            ],
            env: {},
            kind: "amp",
          },
          {
            argv: [
              "--no-mcp",
              "--session-dir",
              "/work/.swarm/r1/marisol/sessions",
              "--session-id",
              "marisol",
              "--model",
              "opencode-go/kimi-k3",
            ],
            env: {},
            kind: "pi",
          },
          {
            argv: [
              "--no-mcp",
              "--session-dir",
              "/work/.swarm/r1/dagny/sessions",
              "--session-id",
              "dagny",
              "--model",
              "opencode-go/glm-5.3",
            ],
            env: {},
            kind: "pi",
          },
          {
            argv: [
              "--no-mcp",
              "--session-dir",
              "/work/.swarm/r1/pell/sessions",
              "--session-id",
              "pell",
              "--model",
              "opencode-go/qwen3.8-flash",
              "-e",
              piAdapter,
            ],
            env: {},
            kind: "pi",
          },
        ]);
      })
  );

  it.effect(
    "start an agent in its pane by name, and prompt it by name, waiting until it settles",
    () =>
      Effect.sync(() => {
        expect(
          herdrStart({
            argv: ["--model", "claude-opus-5-5"],
            handle: "wren",
            kind: "claude",
            pane: "w9:p1",
          })
        ).toStrictEqual([
          "agent",
          "start",
          "wren",
          "--kind",
          "claude",
          "--pane",
          "w9:p1",
          "--timeout",
          "120000",
          "--",
          "--model",
          "claude-opus-5-5",
        ]);
        expect(
          herdrPrompt({ handle: "wren", text: "Answer the ask." })
        ).toStrictEqual([
          "agent",
          "prompt",
          "wren",
          "Answer the ask.",
          "--wait",
        ]);
      })
  );
});

const SLUG = Brand.slug.toUpperCase();

const platformUrl = "https://platform-dev-oscabriel.example.workers.dev";

const tokenOf = (handle: string) =>
  `${handle}-token-0123456789abcdef0123456789ab`;

const holderOf = (env: Readonly<Record<string, string | undefined>>) =>
  handles.find((handle) => env[`${SLUG}_TOKEN`] === tokenOf(handle));

interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

interface Ending {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));

const fakeSpawner = (answer: (call: Spawned) => Effect.Effect<Ending>) =>
  Effect.gen(function* () {
    const spawned = yield* Ref.make<readonly Spawned[]>([]);

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("the swarm pipes no commands");
        }

        const call: Spawned = {
          args: command.args,
          command: command.command,
          env: command.options.env ?? {},
        };

        yield* Ref.update(spawned, (calls) => [...calls, call]);

        const { code = 0, stderr = "", stdout = "" } = yield* answer(call);

        return ChildProcessSpawner.makeHandle({
          all: bytes(stdout),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(1),
          stderr: bytes(stderr),
          stdin: Sink.drain,
          stdout: bytes(stdout),
          unref: Effect.succeed(Effect.void),
        });
      })
    );

    return {
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      spawned: Ref.get(spawned),
    };
  });

const fixture = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(
      path.join("test", "fixtures", "swarm", name)
    );
  });

const outOfScope = new OutOfScope({
  paths: [RepoPath.make("packages/billing/src/index.ts")],
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

const answerOf = (
  handle: string,
  ask: AskId,
  n: number,
  outcome: Outcome
): AnswerView => ({
  ask,
  at: DateTime.makeUnsafe(`2026-10-08T12:00:0${n}.000Z`),
  head: sha(n),
  outcome,
  requestId: RequestId.make(`push-${sha(n)}-${handle}`),
});

const landed = Outcome.cases.Landed.make({ sha: LandedSha.make(sha(9)) });

const statusOf = (handle: string, call: number) => {
  const ask = children[handles.indexOf(handle)] ?? AskId.make("unknown");

  const refused = answerOf(
    handle,
    ask,
    1,
    Outcome.cases.Refused.make({ refusals: [outOfScope] })
  );

  const answers =
    handle === "wren"
      ? [refused, ...(call > 1 ? [answerOf(handle, ask, 2, landed)] : [])]
      : [answerOf(handle, ask, 1, landed)];

  return Schema.encodeSync(StatusJson)({
    command: "status",
    data: { answers, claims: [], handle: Handle.make(handle) },
    ok: true,
    v: 1,
  });
};

const paneJson = (pane: string) =>
  JSON.stringify({
    id: "cli:pane:split",
    result: { pane: { pane_id: pane, workspace_id: "w9" }, type: "pane_info" },
  });

const agentJson = (name: string, type: string) =>
  JSON.stringify({
    id: `cli:agent:${type}`,
    result: {
      agent: {
        agent: "claude",
        agent_status: "idle",
        interactive_ready: true,
        name,
        pane_id: "w9:p1",
      },
      type,
    },
  });

const claimOf = (ask: string, handle: string) => {
  const fork = `burrow--${ask}--${handle}`;

  return JSON.stringify({
    command: "claim",
    data: {
      claim: {
        ask,
        base: "9998ebe62c2f282d148b1d806372484916cc2548",
        checkCommand: `${Brand.cli} check`,
        claimant: handle,
        fork,
        lapsesAt: "2026-10-09T05:00:00.000Z",
        openedAt: "2026-10-08T05:00:00.000Z",
        project: "burrow",
        remote: `${platformUrl}/${fork}.git`,
        state: "live",
        warnsAt: "2026-10-08T17:00:00.000Z",
      },
    },
    ok: true,
    v: 1,
  });
};

const herdrWorld = (replay: Ending) =>
  Effect.gen(function* () {
    const panes = yield* Ref.make(1);
    const reads = yield* Ref.make(new Map<string, number>());
    const listed = yield* fixture("list-asks.json");

    const shown = (yield* fixture("show-ask.json")).replaceAll(
      "{configDir}",
      Brand.configDir
    );

    const answer = (call: Spawned) =>
      Effect.gen(function* () {
        const { args, command, env } = call;
        const [first = "", second = "", third = ""] = args;

        if (command === "herdr") {
          if (first === "workspace") {
            return JSON.stringify({
              id: "cli:workspace:create",
              result: {
                root_pane: { pane_id: "w9:p1", workspace_id: "w9" },
                type: "workspace_created",
                workspace: { workspace_id: "w9" },
              },
            });
          }

          if (second === "split") {
            return paneJson(
              `w9:p${yield* Ref.updateAndGet(panes, (n) => n + 1)}`
            );
          }

          if (first === "agent") {
            return agentJson(
              third,
              second === "start" ? "agent_started" : "agent_prompted"
            );
          }

          return JSON.stringify({ id: "cli:pane", result: { type: "ok" } });
        }

        if (command === "git") {
          return "d7064cb4f9f0f0e0d0c0b0a090807060504030201\n";
        }

        if (first === "status") {
          const handle = holderOf(env) ?? "nobody";

          const count =
            (yield* Ref.updateAndGet(reads, (seen) =>
              new Map(seen).set(handle, (seen.get(handle) ?? 0) + 1)
            )).get(handle) ?? 1;

          return statusOf(handle, count);
        }

        return (
          {
            ask: shown,
            asks: listed,
            claim: claimOf(third, holderOf(env) ?? "nobody"),
          }[second] ?? ""
        );
      });

    return yield* fakeSpawner((call) => {
      if (call.command !== "curl") {
        return Effect.map(answer(call), (stdout) => ({ stdout }));
      }

      return Effect.succeed(
        call.args.includes("content-type: application/json") ? replay : {}
      );
    });
  });

const emptyReplay: Ending = {
  stdout:
    '[{"_tag":"Exit","requestId":"1","exit":{"_tag":"Success","value":null}}]',
};

const inAPane = { HERDR_ENV: "1" };

const herdrRunWith = (
  herdrEnv: Readonly<Record<string, string>>,
  replay: Ending = emptyReplay
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const swarm = yield* fs.makeTempDirectoryScoped();
    const world = yield* herdrWorld(replay);
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      error: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    const sessions = Object.fromEntries(
      handles.map((handle) => [tokenOf(handle), handle])
    );

    const result = yield* main([
      "--stage",
      "dev-oscabriel",
      "--url",
      platformUrl,
      "--view",
      "herdr",
    ]).pipe(
      Effect.provide(world.layer),
      Effect.provideService(SwarmDir, swarm),
      Effect.provideService(LedgerFile, `${swarm}/created.jsonl`),
      Effect.provideService(Console.Console, captured),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: {
            ...herdrEnv,
            HOME: "/home/user",
            SESSION_TOKENS: JSON.stringify(sessions),
            SHELL: "/usr/bin/zsh",
            TERM: "xterm-256color",
          },
        })
      ),
      Effect.result
    );

    const run = `${swarm}/19700101-000000`;
    const summary = `${run}/agents.json`;
    const wrensScript = `${run}/wren/pane-shell`;

    return {
      agents: (yield* fs.exists(summary))
        ? Option.some(yield* fs.readFileString(summary))
        : Option.none<string>(),
      printed,
      result,
      root: (yield* repoRoot).replace(/\/$/u, ""),
      run,
      spawned: yield* world.spawned,
      wrensScript: (yield* fs.exists(wrensScript))
        ? yield* fs.readFileString(wrensScript)
        : "",
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const herdrRun = herdrRunWith(inAPane);

const herdrCalls = (spawned: readonly Spawned[]) =>
  spawned.flatMap(({ args, command }) => (command === "herdr" ? [args] : []));

const agentCalls = (calls: readonly (readonly string[])[], verb: string) =>
  calls.flatMap((call) =>
    call[0] === "agent" && call[1] === verb
      ? [{ args: call, name: call[2] ?? "" }]
      : []
  );

const paneOf = new Map([
  ["wren", "w9:p1"],
  ["counter", "w9:p2"],
  ["marisol", "w9:p3"],
  ["tamsin", "w9:p4"],
  ["ivo", "w9:p5"],
  ["dagny", "w9:p6"],
  ["pell", "w9:p7"],
]);

const byName = (
  one: { readonly name: string },
  other: { readonly name: string }
) => one.name.localeCompare(other.name);

describe("a run in herdr's panes", () => {
  it.effect(
    "lays the panes out in a workspace of their own, with a counter pane that shows the run's counter file",
    () =>
      Effect.gen(function* () {
        const { result, root, run, spawned } = yield* herdrRun;
        const calls = herdrCalls(spawned);

        expect(Result.isSuccess(result)).toBeTruthy();
        expect(calls.slice(0, 7)).toStrictEqual([
          [
            "workspace",
            "create",
            "--cwd",
            root,
            "--label",
            "swarm oscabriel/burrow",
            "--focus",
          ],
          ...[
            ["w9:p1", "down", "0.85"],
            ["w9:p1", "down", "0.5"],
            ["w9:p1", "right", "0.333"],
            ["w9:p4", "right", "0.5"],
            ["w9:p3", "right", "0.333"],
            ["w9:p6", "right", "0.5"],
          ].map(([pane = "", direction = "", ratio = ""]) => [
            "pane",
            "split",
            pane,
            "--direction",
            direction,
            "--ratio",
            ratio,
            "--cwd",
            root,
            "--no-focus",
          ]),
        ]);
        expect(calls).toContainEqual([
          "pane",
          "run",
          "w9:p2",
          `clear; tail -n +1 -F ${run}/counter.log`,
        ]);
        expect(calls).toContainEqual([
          "pane",
          "rename",
          "w9:p1",
          "wren · claude-code",
        ]);
      })
  );

  it.effect(
    "starts each contributor's harness in their pane with their driver's flags",
    () =>
      Effect.gen(function* () {
        const { run, spawned } = yield* herdrRun;
        const starts = agentCalls(herdrCalls(spawned), "start");

        expect(starts.toSorted(byName).map(({ args }) => args)).toStrictEqual(
          roster
            .map((contributor) => {
              const { argv, kind } = interactiveLaunch({
                contributor,
                dir: `${run}/${contributor.handle}`,
              });

              return {
                args: [
                  "agent",
                  "start",
                  contributor.handle,
                  "--kind",
                  kind,
                  "--pane",
                  paneOf.get(contributor.handle) ?? "",
                  "--timeout",
                  "120000",
                  "--",
                  ...argv,
                ],
                name: contributor.handle,
              };
            })
            .toSorted(byName)
            .map(({ args }) => args)
        );
        // wren's harness is Claude Code, started with the headless run's
        // safety flags: every tool allowed, no MCP server of the machine's own.
        expect(
          starts.find(({ name }) => name === "wren")?.args.slice(9)
        ).toStrictEqual([
          "--",
          "--permission-mode",
          "bypassPermissions",
          "--strict-mcp-config",
          "--model",
          "claude-opus-5-5",
        ]);
      })
  );

  it.effect(
    "sends each contributor's brief into their pane's session and waits until it settles",
    () =>
      Effect.gen(function* () {
        const { spawned } = yield* herdrRun;
        const prompts = agentCalls(herdrCalls(spawned), "prompt");

        const firsts = handles.map(
          (handle) => prompts.find(({ name }) => name === handle)?.args ?? []
        );

        expect(
          firsts.map((prompt) => [prompt[2], prompt[4], prompt.length])
        ).toStrictEqual(handles.map((handle) => [handle, "--wait", 5]));
        expect(
          firsts.map((prompt, at) =>
            (prompt[3] ?? "").includes(children[at] ?? "?")
          )
        ).toStrictEqual(handles.map(() => true));
      })
  );

  it.effect(
    "sends a refusal back into the same pane's session as a second prompt, and reads the outcome only from status",
    () =>
      Effect.gen(function* () {
        const { agents, spawned } = yield* herdrRun;

        const wrens = agentCalls(herdrCalls(spawned), "prompt").filter(
          ({ name }) => name === "wren"
        );

        expect(wrens).toHaveLength(2);
        expect(wrens[1]?.args[3]).toContain(
          [...explain([outOfScope]), "", `Next: ${outOfScope.next}`].join("\n")
        );

        const summary = yield* Schema.decodeEffect(
          Schema.fromJsonString(AgentsResult)
        )(Option.getOrElse(agents, () => ""));

        expect(
          summary.runs.map(({ attempts, handle, outcome, refusals }) => [
            handle,
            outcome,
            attempts,
            refusals,
          ])
        ).toStrictEqual(
          handles.map((handle) =>
            handle === "wren"
              ? [handle, "landed", 2, { OutOfScope: 1 }]
              : [handle, "landed", 1, {}]
          )
        );
      })
  );

  it.effect(
    "refuses outside a herdr pane, before anything is claimed, rather than drive whichever session is focused",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* herdrRunWith({});

        expect(
          Result.match(result, {
            onFailure: ({ reason }) => reason,
            onSuccess: () => "",
          })
        ).toContain("start the swarm from a herdr pane");
        expect(
          spawned.flatMap(({ args, command }) =>
            command === "herdr" || args[1] === "claim" ? [args] : []
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "stops before it opens a pane or claims anything when the counter can't read where the project stands",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* herdrRunWith(inAPane, {
          code: 7,
          stderr:
            "curl: (7) Failed to connect to platform-dev-oscabriel.example.workers.dev port 443\n",
        });

        expect(
          Result.match(result, {
            onFailure: ({ reason }) => reason,
            onSuccess: () => "",
          })
        ).toBe(
          "the counter couldn't read oscabriel/burrow's events: curl exited 7: curl: (7) Failed to connect to platform-dev-oscabriel.example.workers.dev port 443"
        );
        expect(
          spawned.flatMap(({ args, command }) =>
            command === "herdr" || args[1] === "claim" ? [args] : []
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "hands each pane its contributor's env through a pipe, so no token is in any argv, script or line",
    () =>
      Effect.gen(function* () {
        const { printed, run, spawned, wrensScript } = yield* herdrRun;

        expect(
          spawned.flatMap(({ args, command }) =>
            command === "mkfifo" ? [args] : []
          )
        ).toContainEqual(["-m", "600", `${run}/wren/pane-env`]);
        expect(herdrCalls(spawned)).toContainEqual([
          "pane",
          "run",
          "w9:p1",
          `exec ${run}/wren/pane-shell`,
        ]);
        expect(wrensScript).toContain(`${run}/wren/pane-env`);
        expect(
          [
            wrensScript,
            ...printed,
            ...spawned.flatMap(({ args }) => args),
          ].filter((text) =>
            handles.some((handle) => text.includes(tokenOf(handle)))
          )
        ).toStrictEqual([]);
      })
  );
});

const trustQuestion = [
  " Accessing workspace:",
  "",
  " Quick safety check: Is this a project you created or one you trust?",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
].join("\n");

/** …and then whether to import the CLAUDE.md files above the clone, "No" under the cursor. */
const importsQuestion = [
  "  Allow external CLAUDE.md file imports?",
  "",
  "  ❯ No, disable external imports",
  "    Yes, allow external imports",
].join("\n");

const [wren] = roster;

const wrensWorkspace: AgentWorkspace = {
  clone: "/work/.swarm/r1/wren/clone",
  dir: "/work/.swarm/r1/wren",
  env: { [`${SLUG}_TOKEN`]: tokenOf("wren") },
  redacted: [`${SLUG}_TOKEN`],
};

const takeFrom = (queue: Ref.Ref<readonly string[]>) =>
  Ref.modify(queue, (all) => [
    all[0] ?? "",
    all.length > 1 ? all.slice(1) : all,
  ]);

const blockedStart = (input: {
  readonly states: readonly string[];
  readonly screens: readonly string[];
  readonly clock: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const states = yield* Ref.make(input.states);
    const screens = yield* Ref.make(input.screens);

    const world = yield* fakeSpawner(({ args, command }) =>
      Effect.gen(function* () {
        if (command !== "herdr" || args[0] !== "agent") {
          return {};
        }

        if (args[1] === "start") {
          return {
            code: 1,
            stderr: JSON.stringify({
              error: {
                code: "agent_not_ready",
                message:
                  "agent wren is blocked during startup and is not ready for prompts",
              },
              id: "cli:agent:start",
            }),
          };
        }

        if (args[1] === "get") {
          const status = yield* takeFrom(states);

          return {
            stdout: JSON.stringify({
              result: {
                agent: {
                  agent_status: status,
                  interactive_ready: status === "idle",
                },
              },
            }),
          };
        }

        if (args[1] === "read") {
          return { stdout: yield* takeFrom(screens) };
        }

        return args[1] === "prompt"
          ? { stdout: agentJson("wren", "agent_prompted") }
          : {};
      })
    );

    const files = new Map<string, string>();

    const memoryFs = FileSystem.makeNoop({
      chmod: () => Effect.void,
      remove: () => Effect.void,
      writeFileString: (path, data, options) =>
        Effect.sync(() => {
          files.set(
            path,
            options?.flag === "a" ? `${files.get(path) ?? ""}${data}` : data
          );
        }),
    });

    const fiber = yield* herdrView(new Map([["wren", "w9:p1"]]))
      .attempt({
        contributor: wren,
        env: { HOME: "/home/user", ...wrensWorkspace.env },
        file: `${wrensWorkspace.dir}/attempt-1.jsonl`,
        onSession: Effect.void,
        turn: Turn.Start({ brief: "Answer the ask." }),
        workspace: wrensWorkspace,
      })
      .pipe(
        Effect.provide(world.layer),
        Effect.provideService(FileSystem.FileSystem, memoryFs),
        Effect.result,
        Effect.forkChild
      );

    yield* input.clock;

    return {
      calls: herdrCalls(yield* world.spawned),
      result: yield* Fiber.join(fiber),
    };
  });

describe("a harness blocked at startup", () => {
  it.effect(
    "gets Claude Code past its folder-trust and CLAUDE.md-import questions as the swarm decides, then sends the brief",
    () =>
      Effect.gen(function* () {
        const { calls, result } = yield* blockedStart({
          clock: TestClock.adjust("10 seconds"),
          screens: [trustQuestion, trustQuestion, importsQuestion],
          states: ["blocked", "blocked", "blocked", "idle"],
        });

        expect(
          agentCalls(calls, "send-keys").map(({ args }) => args)
        ).toStrictEqual([
          ["agent", "send-keys", "wren", "down", "enter"],
          ["agent", "send-keys", "wren", "enter"],
        ]);
        expect(
          agentCalls(calls, "prompt").map(({ args }) => args)
        ).toStrictEqual([
          ["agent", "prompt", "wren", "Answer the ask.", "--wait"],
        ]);
        expect(
          Result.map(result, ({ heard }) => [heard.session, heard.settled])
        ).toStrictEqual(Result.succeed([Option.some("wren"), true]));
      })
  );

  it.effect(
    "leaves a question it doesn't know to the person at the panes, and fails the run when nobody answers it",
    () =>
      Effect.gen(function* () {
        const { calls, result } = yield* blockedStart({
          clock: TestClock.adjust("4 minutes"),
          screens: ["  Do you want to enable telemetry?\n  ❯ Yes\n    No"],
          states: ["blocked"],
        });

        expect(agentCalls(calls, "send-keys")).toStrictEqual([]);
        expect(
          Result.match(result, {
            onFailure: ({ reason }) => reason,
            onSuccess: () => "",
          })
        ).toBe(
          "claude-code is still blocked at startup in herdr pane w9:p1: answer it there, or run --view headless"
        );
      })
  );
});

const replayed = [
  '[{"_tag":"Chunk","requestId":"1","values":[',
  '{"_tag":"AskOpened","at":"2026-10-08T05:21:35.148Z","seq":7,"ask":{"ask":"drop-legacy-fetch-burrow-notify","blockedBy":[],"claimed":false,"kind":"migrate","territory":"@burrow/notify","want":"@burrow/notify: 1 caller of legacyFetch → http.get"}},',
  '{"_tag":"AskOpened","at":"2026-10-08T05:21:35.148Z","seq":8,"ask":{"ask":"drop-legacy-fetch-burrow-search","blockedBy":[],"claimed":false,"kind":"migrate","territory":"@burrow/search","want":"@burrow/search: 1 caller of legacyFetch → http.get"}}',
  ']},{"_tag":"Exit","requestId":"1","exit":{"_tag":"Success","value":null}}]',
].join("");

/** The first frame repeats an event the counter already heard, so a double count would show. */
const streamed = [
  '{"_tag":"Chunk","requestId":"1","values":[{"_tag":"Claimed","at":"2026-10-08T12:00:00.000Z","seq":8,"ask":"drop-legacy-fetch-burrow-billing","claimant":"tamsin"}]}',
  '{"_tag":"Chunk","requestId":"1","values":[{"_tag":"Claimed","at":"2026-10-08T12:05:00.000Z","seq":9,"ask":"drop-legacy-fetch-burrow-auth","claimant":"wren"}]}',
  `{"_tag":"Chunk","requestId":"1","values":[{"_tag":"Pushed","at":"2026-10-08T12:06:00.000Z","seq":10,"ask":"drop-legacy-fetch-burrow-auth","head":"${"1".repeat(40)}"},{"_tag":"Released","at":"2026-10-08T12:07:00.000Z","seq":11,"ask":"drop-legacy-fetch-burrow-kit"}]}`,
  '{"_tag":"Exit","requestId":"1","exit":{"_tag":"Success","value":null}}',
].join("\n");

describe("the counter's watch", () => {
  it.effect(
    "starts after the last event the project holds, from watch's plain JSON replay",
    () =>
      Effect.gen(function* () {
        const world = yield* fakeSpawner(() =>
          Effect.succeed({ stdout: replayed })
        );

        const from = yield* lastHeld(
          platformUrl,
          ProjectName.make("oscabriel/burrow")
        ).pipe(Effect.provide(world.layer));

        expect(from).toBe(8);
        expect((yield* world.spawned).map(({ args }) => args)).toStrictEqual([
          [
            "--silent",
            "--show-error",
            "--fail",
            "--no-buffer",
            "--request",
            "POST",
            "--header",
            "content-type: application/json",
            "--data-binary",
            '[{"_tag":"Request","headers":[],"id":"1","payload":{"project":"oscabriel/burrow"},"tag":"watch"}]',
            `${platformUrl}/rpc`,
          ],
        ]);
      })
  );

  it.effect(
    "refuses to guess where to start when the project's events can't be read, rather than count its whole history",
    () =>
      Effect.gen(function* () {
        const reasons = yield* Effect.forEach(
          [
            {
              code: 22,
              stderr: "curl: (22) The requested URL returned error: 502\n",
            },
            { stdout: "<html>502 Bad Gateway</html>" },
          ],
          (ending) =>
            Effect.gen(function* () {
              const world = yield* fakeSpawner(() => Effect.succeed(ending));

              const read = yield* lastHeld(
                platformUrl,
                ProjectName.make("oscabriel/burrow")
              ).pipe(Effect.provide(world.layer), Effect.result);

              return Result.match(read, {
                onFailure: ({ reason }) => reason,
                onSuccess: (from) => `counts from event ${from}`,
              });
            })
        );

        expect(reasons).toStrictEqual([
          "the counter couldn't read oscabriel/burrow's events: curl exited 22: curl: (22) The requested URL returned error: 502",
          "the counter couldn't read oscabriel/burrow's events: <html>502 Bad Gateway</html>",
        ]);
      })
  );

  it.effect("says once why it can't follow watch, and keeps trying", () =>
    Effect.gen(function* () {
      const world = yield* fakeSpawner(() =>
        Effect.succeed({
          code: 22,
          stderr: "curl: (22) The requested URL returned error: 503\n",
        })
      );

      const files = new Map<string, string>();

      const memoryFs = FileSystem.makeNoop({
        writeFileString: (path, data, options) =>
          Effect.sync(() => {
            files.set(
              path,
              options?.flag === "a" ? `${files.get(path) ?? ""}${data}` : data
            );
          }),
      });

      const fiber = yield* followCounter({
        file: "/work/counter.log",
        from: 8,
        origin: platformUrl,
        project: ProjectName.make("oscabriel/burrow"),
      }).pipe(
        Effect.provide(world.layer),
        Effect.provideService(FileSystem.FileSystem, memoryFs),
        Effect.forkChild
      );

      yield* TestClock.adjust("5 seconds");
      yield* Fiber.interrupt(fiber);

      expect(files.get("/work/counter.log")?.split("\n")).toStrictEqual([
        "claims 0 · pushes 0 · landed 0  (oscabriel/burrow, after event 8)",
        "counter: watch didn't run: curl exited 22: curl: (22) The requested URL returned error: 503",
        "",
      ]);
      expect((yield* world.spawned).length).toBeGreaterThan(1);
    })
  );

  it.effect(
    "follows the framed stream after that event and writes a line per claim, push and landing",
    () =>
      Effect.gen(function* () {
        const world = yield* fakeSpawner(() =>
          Effect.succeed({ stdout: streamed })
        );

        const files = new Map<string, string>();

        const memoryFs = FileSystem.makeNoop({
          writeFileString: (path, data, options) =>
            Effect.sync(() => {
              files.set(
                path,
                options?.flag === "a" ? `${files.get(path) ?? ""}${data}` : data
              );
            }),
        });

        const fiber = yield* followCounter({
          file: "/work/counter.log",
          from: 8,
          origin: platformUrl,
          project: ProjectName.make("oscabriel/burrow"),
        }).pipe(
          Effect.provide(world.layer),
          Effect.provideService(FileSystem.FileSystem, memoryFs),
          Effect.forkChild
        );

        yield* TestClock.adjust("1 second");
        yield* Fiber.interrupt(fiber);

        expect(files.get("/work/counter.log")?.split("\n")).toStrictEqual([
          "claims 0 · pushes 0 · landed 0  (oscabriel/burrow, after event 8)",
          "12:05:00  claims 1 · pushes 0 · landed 0  wren claimed drop-legacy-fetch-burrow-auth",
          "12:06:00  claims 1 · pushes 1 · landed 0  drop-legacy-fetch-burrow-auth pushed 1111111",
          "",
        ]);
        expect(
          (yield* world.spawned).map(({ args }) => args.slice(7, 10))
        ).toStrictEqual([
          [
            "content-type: application/ndjson",
            "--data-binary",
            '{"_tag":"Request","headers":[],"id":"1","payload":{"project":"oscabriel/burrow","since":8},"tag":"watch"}\n',
          ],
        ]);
      })
  );
});
