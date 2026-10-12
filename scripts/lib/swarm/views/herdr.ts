/**
 * Outcomes come only from `<cli> status --json`; pane text is read only to
 * answer a harness's startup questions. An agent in a pane outlives its run
 * until its herdr workspace is closed.
 */
import type { ProjectName } from "@repo/protocol/ids";
import {
  Config,
  Duration,
  Effect,
  FileSystem,
  Option,
  Ref,
  Result,
  Schedule,
  Schema,
} from "effect";
import type { Path, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { repoRoot } from "../../../../infra/stages.ts";
import { drivers, sessionDirOf } from "../harnesses/index.ts";
import type { Harness } from "../results.ts";
import type { Contributor } from "../roster.ts";
import { run, scrubbed, shellQuoted, SwarmFailed } from "../workspace.ts";
import type { AgentWorkspace } from "../workspace.ts";
import { followCounter, lastHeld } from "./counter.ts";
import { nothingHeard, Turn } from "./headless.ts";
import type { Attempted, SwarmView } from "./headless.ts";

export const COUNTER = "counter";

export interface Split {
  readonly slot: string;
  readonly from: string;
  readonly direction: "right" | "down";
  readonly ratio: number;
}

const ABOVE_COUNTER = 0.85;

const share = (ratio: number) => Math.round(ratio * 1000) / 1000;

export const herdrLayout = (handles: readonly string[]): readonly Split[] => {
  const [first] = handles;

  if (first === undefined) {
    return [];
  }

  const across =
    handles.length <= 3 ? handles.length : Math.ceil(handles.length / 2);

  const rows = [handles.slice(0, across), handles.slice(across)].filter(
    (row) => row.length > 0
  );

  const counter: Split = {
    direction: "down",
    from: first,
    ratio: ABOVE_COUNTER,
    slot: COUNTER,
  };

  const secondRow = rows.flatMap((row, at) => {
    const [head] = row;

    return at === 0 || head === undefined
      ? []
      : [{ direction: "down", from: first, ratio: 0.5, slot: head } as const];
  });

  const columns = rows.flatMap((row) =>
    row.slice(1).map((slot, at): Split => ({
      direction: "right",
      from: row[at] ?? first,
      ratio: share(1 / (row.length - at)),
      slot,
    }))
  );

  return [counter, ...secondRow, ...columns];
};

const START_TIMEOUT_MS = 120_000;

export const herdrStart = (input: {
  readonly handle: string;
  readonly kind: string;
  readonly pane: string;
  readonly argv: readonly string[];
}): readonly string[] => [
  "agent",
  "start",
  input.handle,
  "--kind",
  input.kind,
  "--pane",
  input.pane,
  "--timeout",
  String(START_TIMEOUT_MS),
  "--",
  ...input.argv,
];

// `--wait` alone also matches `idle`, which a turn can end in; `--until done --until blocked` would hang.
export const herdrPrompt = (input: {
  readonly handle: string;
  readonly text: string;
}): readonly string[] => [
  "agent",
  "prompt",
  input.handle,
  input.text,
  "--wait",
];

const HEADLESS_ONLY = {
  amp: {
    switches: ["--stream-json", "--no-archive-after-execute"],
    valued: ["-x"],
  },
  "claude-code": { switches: ["-p", "--verbose"], valued: ["--output-format"] },
  // `run` is OpenCode's headless subcommand; its interface takes no `-m`.
  opencode: { switches: ["run"], valued: ["--format", "-m"] },
  pi: { switches: ["-p"], valued: ["--mode"] },
} as const satisfies Readonly<
  Record<
    Harness,
    { readonly switches: readonly string[]; readonly valued: readonly string[] }
  >
>;

// Marks the brief in a driver's argv so it can be taken out.
const BRIEF = "\u0000brief";

export interface Launch {
  readonly kind: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Reuses the headless driver's start flags (less `HEADLESS_ONLY` and the
 * brief), so the settings that keep a session safe are the same.
 */
export const interactiveLaunch = (input: {
  readonly contributor: Contributor;
  readonly dir: string;
}): Launch => {
  const { adapter, handle, harness, model } = input.contributor;

  const [kind = harness, ...flags] = drivers[harness].start({
    adapter,
    brief: BRIEF,
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

  const { switches, valued } = HEADLESS_ONLY[harness];

  const argv = flags.filter((flag, at) => {
    const before = flags[at - 1] ?? "";

    return (
      flag !== BRIEF &&
      !switches.some((one) => one === flag) &&
      !valued.some((one) => one === flag || one === before)
    );
  });

  return {
    argv,
    env:
      harness === "opencode"
        ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model }) }
        : {},
    kind,
  };
};

class HerdrRefused extends Schema.TaggedError<HerdrRefused>()("HerdrRefused", {
  code: Schema.String,
  said: Schema.String,
  verb: Schema.String,
}) {
  override get message() {
    return `herdr ${this.verb}: ${this.code}: ${this.said}`;
  }
}

const isRefused = Schema.is(HerdrRefused);

const decodeRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Struct({ code: Schema.String, message: Schema.String }),
    })
  )
);

const herdr = (args: readonly string[]) =>
  Effect.flatMap(run({ args, command: "herdr", env: {} }), (ran) => {
    if (ran.code === 0) {
      return Effect.succeed(ran.stdout);
    }

    const verb = args.slice(0, 2).join(" ");

    return Effect.fail(
      Option.match(decodeRefusal(ran.stderr), {
        onNone: () =>
          new HerdrRefused({
            code: `exit ${ran.code}`,
            said: ran.stderr.trim().slice(0, 500),
            verb,
          }),
        onSome: ({ error }) =>
          new HerdrRefused({ code: error.code, said: error.message, verb }),
      })
    );
  });

const orFailed = <A, R>(
  effect: Effect.Effect<A, HerdrRefused | SwarmFailed, R>
): Effect.Effect<A, SwarmFailed, R> =>
  effect.pipe(
    Effect.catchTag("HerdrRefused", ({ message }) =>
      Effect.fail(new SwarmFailed({ reason: message }))
    )
  );

const answerOf =
  <A, I>(schema: Schema.Codec<A, I>, what: string) =>
  (printed: string) =>
    Schema.decodeEffect(Schema.fromJsonString(schema))(printed).pipe(
      Effect.mapError(
        () =>
          new SwarmFailed({
            reason: `herdr ${what} answered without its JSON: ${printed.trim().slice(0, 300)}`,
          })
      )
    );

const PaneId = Schema.Struct({ pane_id: Schema.NonEmptyString });

const WorkspaceMade = Schema.Struct({
  result: Schema.Struct({
    root_pane: PaneId,
    workspace: Schema.Struct({ workspace_id: Schema.NonEmptyString }),
  }),
});

const PaneMade = Schema.Struct({ result: Schema.Struct({ pane: PaneId }) });

const AgentSeen = Schema.Struct({
  result: Schema.Struct({
    agent: Schema.Struct({
      agent_status: Schema.String,
      interactive_ready: Schema.optionalKey(Schema.Boolean),
    }),
  }),
});

interface StartupQuestion {
  readonly asks: string;
  readonly keys: readonly string[];
}

/**
 * Claude Code trusts the clone (it is the swarm's own) and declines CLAUDE.md
 * files above it. Any other question is left for the person at the panes.
 */
const STARTUP_QUESTIONS = {
  amp: [],
  "claude-code": [
    { asks: "Yes, I trust this folder", keys: ["down", "enter"] },
    { asks: "Allow external CLAUDE.md file imports?", keys: ["enter"] },
  ],
  opencode: [],
  pi: [],
} as const satisfies Readonly<Record<Harness, readonly StartupQuestion[]>>;

const STARTUP_WAIT = Duration.minutes(3);

const readyIn = (printed: string) =>
  Effect.map(
    answerOf(AgentSeen, "agent get")(printed),
    ({ result: { agent } }) =>
      agent.interactive_ready === true &&
      (agent.agent_status === "idle" || agent.agent_status === "done")
  );

const pastStartup = (input: {
  readonly handle: string;
  readonly harness: Harness;
  readonly pane: string;
}) =>
  Effect.gen(function* () {
    const answered = yield* Ref.make<readonly string[]>([]);

    const look = Effect.gen(function* () {
      const seen = yield* herdr(["agent", "get", input.handle]);

      if (yield* readyIn(seen)) {
        return true;
      }

      const shown = yield* herdr([
        "agent",
        "read",
        input.handle,
        "--source",
        "detection",
      ]);

      const done = yield* Ref.get(answered);

      const question = STARTUP_QUESTIONS[input.harness].find(
        ({ asks }) => shown.includes(asks) && !done.includes(asks)
      );

      if (question !== undefined) {
        yield* Ref.set(answered, [...done, question.asks]);
        yield* herdr(["agent", "send-keys", input.handle, ...question.keys]);
      }

      return false;
    });

    const ready = yield* look.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(Duration.seconds(1)),
        until: (isReady: boolean) => isReady,
      }),
      Effect.timeoutOption(STARTUP_WAIT)
    );

    yield* Effect.fromOption(ready).pipe(
      Effect.mapError(
        () =>
          new SwarmFailed({
            reason: `${input.harness} is still blocked at startup in herdr pane ${input.pane}: answer it there, or run --view headless`,
          })
      )
    );
  });

const PANE_OWNS = ["TERM", "COLORTERM"];

const HERDR_NAMES = [
  "HERDR_BIN_PATH",
  "HERDR_ENV",
  "HERDR_PANE_ID",
  "HERDR_SOCKET_PATH",
  "HERDR_TAB_ID",
  "HERDR_WORKSPACE_ID",
];

/**
 * The env arrives through a pipe, so no token is ever in a file, an argv or
 * on screen; the shell skips rc files so no user setup sits in between.
 */
export const paneShell = (input: {
  readonly fifo: string;
  readonly clone: string;
}) =>
  [
    "#!/bin/sh",
    "# One swarm contributor's herdr pane: their harness's env from the swarm",
    "# through a pipe, then a shell in their clone for herdr to start it in.",
    `exec env -i ${[...PANE_OWNS, ...HERDR_NAMES].map((name) => `${name}="\${${name}-}"`).join(" ")} /bin/sh -c '`,
    "set -a",
    '. "$1"',
    "set +a",
    'cd "$2" || exit 1',
    `case "\${SHELL##*/}" in`,
    '  zsh) exec "$SHELL" -f ;;',
    '  bash) exec "$SHELL" --noprofile --norc ;;',
    `  *) exec "\${SHELL:-/bin/sh}" ;;`,
    `esac' pane-shell ${shellQuoted(input.fifo)} ${shellQuoted(input.clone)}`,
    "",
  ].join("\n");

const envLines = (env: Readonly<Record<string, string>>) =>
  Object.entries(env)
    .filter(([name]) => !PANE_OWNS.includes(name))
    .map(([name, value]) => `${name}=${shellQuoted(value)}\n`)
    .join("");

const ENV_READ_WAIT = Duration.seconds(30);

const BUSY_RETRIES = 10;

const SCRIPT_MODE = 0o700;

const startIn = (input: {
  readonly contributor: Contributor;
  readonly env: Readonly<Record<string, string>>;
  readonly pane: string;
  readonly workspace: AgentWorkspace;
  readonly log: (text: string) => Effect.Effect<void, SwarmFailed>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { contributor, pane, workspace } = input;
    const { handle, harness } = contributor;
    const launch = interactiveLaunch({ contributor, dir: workspace.dir });
    const fifo = `${workspace.dir}/pane-env`;
    const script = `${workspace.dir}/pane-shell`;

    const written = (what: string) =>
      Effect.mapError(
        ({ message }: { readonly message: string }) =>
          new SwarmFailed({ reason: `${handle}'s ${what}: ${message}` })
      );

    yield* fs.remove(fifo, { force: true }).pipe(written("pipe"));

    const made = yield* run({
      args: ["-m", "600", fifo],
      command: "mkfifo",
      env: {},
    });

    if (made.code !== 0) {
      return yield* new SwarmFailed({
        reason: `${handle}'s pipe: mkfifo exited ${made.code}: ${made.stderr.trim()}`,
      });
    }

    yield* fs
      .writeFileString(script, paneShell({ clone: workspace.clone, fifo }), {
        mode: SCRIPT_MODE,
      })
      .pipe(
        Effect.andThen(fs.chmod(script, SCRIPT_MODE)),
        written("pane script")
      );

    yield* orFailed(
      herdr(["pane", "run", pane, `exec ${shellQuoted(script)}`])
    );

    // Opening the pipe waits for the pane's script to read it.
    yield* fs
      .writeFileString(fifo, envLines({ ...input.env, ...launch.env }))
      .pipe(
        written("env"),
        Effect.timeoutOrElse({
          duration: ENV_READ_WAIT,
          orElse: () =>
            Effect.fail(
              new SwarmFailed({
                reason: `${handle}'s herdr pane ${pane} didn't read its env: is it at a shell prompt?`,
              })
            ),
        }),
        Effect.ensuring(Effect.ignore(fs.remove(fifo, { force: true })))
      );

    const started = yield* herdr(
      herdrStart({ argv: launch.argv, handle, kind: launch.kind, pane })
    ).pipe(
      // The pane's shell may still be starting.
      Effect.retry({
        schedule: Schedule.spaced(Duration.seconds(1)),
        times: BUSY_RETRIES,
        while: (error) => isRefused(error) && error.code === "agent_pane_busy",
      }),
      Effect.catchIf(
        (error): error is HerdrRefused =>
          isRefused(error) && error.code === "agent_not_ready",
        (error) =>
          Effect.as(
            pastStartup({ handle, harness, pane }),
            JSON.stringify({ startup: error.said })
          )
      ),
      orFailed
    );

    return yield* input.log(started);
  });

const promptHeard = (input: {
  readonly name: string;
  readonly pane: string;
  readonly harness: Harness;
  readonly answer: Result.Result<string, HerdrRefused>;
}): Effect.Effect<Attempted, SwarmFailed> =>
  Result.match(input.answer, {
    onFailure: (refused) =>
      Effect.succeed({
        code: Option.some(1),
        heard: {
          ...nothingHeard,
          failure: Option.some(refused.message),
          session: Option.some(input.name),
        },
        stderr: refused.message,
      }),
    onSuccess: (printed) =>
      Effect.map(
        answerOf(AgentSeen, "agent prompt")(printed),
        ({ result: { agent } }): Attempted => {
          const blocked = agent.agent_status === "blocked";

          return {
            code: Option.some(0),
            heard: {
              ...nothingHeard,
              failure: blocked
                ? Option.some(
                    `${input.harness} is blocked on a question in herdr pane ${input.pane}`
                  )
                : Option.none(),
              session: Option.some(input.name),
              settled: !blocked,
              stopReason: Option.some(agent.agent_status),
            },
            stderr: "",
          };
        }
      ),
  });

export const herdrView = (panes: ReadonlyMap<string, string>): SwarmView => ({
  attempt: ({ contributor, env, file, onSession, turn, workspace }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { handle, harness } = contributor;

      const pane = yield* Effect.fromNullishOr(panes.get(handle)).pipe(
        Effect.mapError(
          () => new SwarmFailed({ reason: `${handle} has no herdr pane` })
        )
      );

      const logged = Effect.mapError(
        ({ message }: { readonly message: string }) =>
          new SwarmFailed({ reason: `${handle}'s attempt log: ${message}` })
      );

      const log = (text: string) =>
        fs
          .writeFileString(file, `${scrubbed(text, workspace).trim()}\n`, {
            flag: "a",
          })
          .pipe(logged);

      yield* fs.writeFileString(file, "").pipe(logged);

      const name = yield* Turn.$match(turn, {
        Resume: ({ session }) => Effect.succeed(session),
        Start: () =>
          Effect.as(
            startIn({ contributor, env, log, pane, workspace }),
            handle
          ),
      });

      yield* onSession;

      const text = Turn.$match(turn, {
        Resume: ({ prompt }) => prompt,
        Start: ({ brief }) => brief,
      });

      const answer = yield* herdr(herdrPrompt({ handle: name, text })).pipe(
        Effect.map(Result.succeed),
        Effect.catchIf(isRefused, (refused) =>
          Effect.succeed(Result.fail(refused))
        )
      );

      yield* log(
        Result.match(answer, {
          onFailure: ({ message }) => message,
          onSuccess: (printed) => printed,
        })
      );

      return yield* promptHeard({ answer, harness, name, pane });
    }),
});

const titleOf = ({
  handle,
  harness,
}: Pick<Contributor, "handle" | "harness">) => `${handle} · ${harness}`;

// Refuses outside a herdr pane: herdr says not to drive a session from outside it.
export const openHerdrView = (input: {
  readonly contributors: readonly Pick<Contributor, "handle" | "harness">[];
  readonly project: ProjectName;
  readonly origin: string;
  readonly runDir: string;
}): Effect.Effect<
  { readonly view: SwarmView; readonly workspace: string },
  SwarmFailed,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const inHerdr = yield* Config.all({
      env: Config.option(Config.String("HERDR_ENV")),
      socket: Config.option(Config.String("HERDR_SOCKET_PATH")),
    }).pipe(
      Effect.map(
        ({ env, socket }) => Option.contains(env, "1") || Option.isSome(socket)
      ),
      Effect.orElseSucceed(() => false)
    );

    if (!inHerdr) {
      return yield* new SwarmFailed({
        reason:
          "--view herdr opens its panes in the herdr session it runs in: start the swarm from a herdr pane (herdr --session demo), or name the session's socket in HERDR_SOCKET_PATH",
      });
    }

    const from = yield* lastHeld(input.origin, input.project);
    const root = (yield* repoRoot).replace(/\/$/u, "");
    const counterFile = `${input.runDir}/counter.log`;
    const handles = input.contributors.map(({ handle }) => handle);

    yield* fs
      .makeDirectory(input.runDir, { recursive: true })
      .pipe(
        Effect.mapError(
          ({ message }) =>
            new SwarmFailed({ reason: `the run's folder: ${message}` })
        )
      );

    const made = yield* herdr([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      `swarm ${input.project}`,
      "--focus",
    ]).pipe(
      orFailed,
      Effect.flatMap(answerOf(WorkspaceMade, "workspace create"))
    );

    const first = handles[0] ?? COUNTER;

    const panes = yield* Effect.reduce(
      herdrLayout(handles),
      () => new Map([[first, made.result.root_pane.pane_id]]),
      (known, split) =>
        herdr([
          "pane",
          "split",
          known.get(split.from) ?? made.result.root_pane.pane_id,
          "--direction",
          split.direction,
          "--ratio",
          String(split.ratio),
          "--cwd",
          root,
          "--no-focus",
        ]).pipe(
          orFailed,
          Effect.flatMap(answerOf(PaneMade, "pane split")),
          Effect.map(({ result }) =>
            new Map(known).set(split.slot, result.pane.pane_id)
          )
        )
    );

    const titles = [
      ...input.contributors.map((one) => [one.handle, titleOf(one)] as const),
      [COUNTER, `counter · ${input.project}`] as const,
    ];

    yield* Effect.forEach(
      titles.flatMap(([slot, title]) =>
        Option.toArray(
          Option.map(Option.fromUndefinedOr(panes.get(slot)), (pane) => ({
            pane,
            title,
          }))
        )
      ),
      ({ pane, title }) => orFailed(herdr(["pane", "rename", pane, title])),
      { discard: true }
    );

    yield* Effect.forkScoped(
      followCounter({
        file: counterFile,
        from,
        origin: input.origin,
        project: input.project,
      }).pipe(Effect.ignore)
    );

    yield* Effect.forEach(
      Option.toArray(Option.fromUndefinedOr(panes.get(COUNTER))),
      (pane) =>
        orFailed(
          herdr([
            "pane",
            "run",
            pane,
            `clear; tail -n +1 -F ${shellQuoted(counterFile)}`,
          ])
        ),
      { discard: true }
    );

    return {
      view: herdrView(panes),
      workspace: made.result.workspace.workspace_id,
    };
  });
