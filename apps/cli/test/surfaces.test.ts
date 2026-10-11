import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Contracts, Surfaces, surfaced } from "@repo/protocol/contracts";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  DecisionId,
  ProjectName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { DecisionClosed, StaleBase } from "@repo/protocol/refusal";
import { explain, receiptLine } from "@repo/protocol/render";
import { unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Ref,
  Result,
  Schema,
} from "effect";
import type { Command } from "effect/cli";

import { local } from "../src/local/index.ts";
import { commands, entries } from "../src/surfaces.ts";
import { runProgram } from "./remote-server.ts";
import { session } from "./stdio.ts";

const ask = AskId.make("fix-parser");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const main = CommitSha.make("2222222222222222222222222222222222222222");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const project = ProjectName.make("oscabriel/datekit");

const requestId = RequestId.make("answer-0001");

const refusal = new StaleBase({
  base,
  conflicts: [RepoPath.make("src/a.ts")],
  main,
});

/** Contracts whose answers always meet a moved main. */
const stale = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("submitAnswer", () => Effect.fail(refusal))
);

const clientInfo = { name: "test", version: "0.0.0" };

const initialize = (protocolVersion: string) => ({
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: { capabilities: {}, clientInfo, protocolVersion },
});

const Initialized = Schema.Struct({ protocolVersion: Schema.String });

/** A tools/call result whose one content block is JSON text. */
const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

describe("the CLI's MCP server over stdio", () => {
  it.effect("agrees each session-based protocol a client asks for", () =>
    Effect.gen(function* () {
      const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

      const agreed = yield* Effect.forEach(versions, (version) =>
        session(stale, [initialize(version)]).pipe(
          Effect.flatMap((replies) =>
            Schema.decodeUnknownEffect(Initialized)(replies.get(1))
          ),
          Effect.map((result) => result.protocolVersion)
        )
      );

      expect(agreed).toStrictEqual(versions);
    })
  );

  it.effect("answers discovery in the stateless 2026-07-28 protocol", () =>
    Effect.gen(function* () {
      const replies = yield* session(stale, [
        {
          id: 1,
          jsonrpc: "2.0",
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": clientInfo,
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            },
          },
        },
      ]);

      const discovered = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ supportedVersions: Schema.Array(Schema.String) })
      )(replies.get(1));

      expect(discovered.supportedVersions).toContain("2026-07-28");
    })
  );

  // A stream has no tool form, and a write-only value must never pass
  // through an agent's transcript.
  it.effect("lists the MCP-surfaced contracts only: no watch, no setEnv", () =>
    Effect.gen(function* () {
      const replies = yield* session(stale, [
        initialize("2025-11-25"),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
      ]);

      const { tools } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          tools: Schema.Array(Schema.Struct({ name: Schema.String })),
        })
      )(replies.get(2));

      const names = tools.map(({ name }) => name);

      expect(names).toStrictEqual([...surfaced("mcp").requests.keys()]);
      expect(names).not.toContain("watch");
      expect(names).not.toContain("setEnv");
    })
  );

  it.effect("returns a refusal as JSON that keeps its tag", () =>
    Effect.gen(function* () {
      const replies = yield* session(stale, [
        initialize("2025-11-25"),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          id: 2,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: { ask, base, head, project, requestId },
            name: "submitAnswer",
          },
        },
      ]);

      const result = yield* Schema.decodeUnknownEffect(ToolResult)(
        replies.get(2)
      );

      const [{ text }] = result.content;

      expect(result.isError).toBeTruthy();
      expect(text).toHaveProperty("_tag", "StaleBase");
      expect(yield* Schema.decodeUnknownEffect(StaleBase)(text)).toStrictEqual(
        refusal
      );
    })
  );
});

/** The names of a command's subcommands, in order. */
const subcommandsOf = (command: Command.Command.Any | undefined) =>
  (command?.subcommands ?? []).flatMap(({ commands: group }) =>
    group.map(({ name }) => name)
  );

const top = (name: string) => commands.find((command) => command.name === name);

describe("the CLI's command tree", () => {
  it("has one command per contract served on the CLI, every local one, and schema", () => {
    const onCli = [...Contracts.requests.values()].filter((rpc) =>
      Context.get(rpc.annotations, Surfaces).includes("cli")
    );

    const paths = entries.map(({ path: words }) => words.join(" "));

    // `init` and `env set` are the local commands that wrap their contracts.
    expect(paths).toHaveLength(onCli.length - 2 + local.length + 1);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toStrictEqual(
      expect.arrayContaining([
        "asks",
        "ask",
        "ask open",
        "ask flag",
        "env shape",
        "env set",
        "init",
        "schema",
      ])
    );
  });

  it("puts ask open, ask draft and ask flag under ask, and env shape beside env set", () => {
    expect(subcommandsOf(top("ask"))).toStrictEqual(["open", "draft", "flag"]);
    expect(subcommandsOf(top("env"))).toStrictEqual(["shape", "set"]);
  });

  it("leaves init and env set to their local commands", () => {
    const [localInit, localEnvSet] = [
      local.find(({ path }) => path.join(" ") === "init")?.command,
      local.find(({ path }) => path.join(" ") === "env set")?.command,
    ];

    const envSet = top("env")
      ?.subcommands.flatMap(({ commands: group }) => group)
      .find(({ name }) => name === "set");

    expect(top("init")).toBe(localInit);
    expect(envSet).toBe(localEnvSet);
  });
});

const decision = DecisionId.make("dec-000001");

const decideArgs = [
  "decide",
  "--project",
  "oscabriel/datekit",
  "--decision",
  decision,
  "--choice",
  "accept",
];

/** A platform that counts the decisions it is asked to take, and takes none. */
const deciding = (calls: Ref.Ref<number>) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("decide", () =>
      Ref.update(calls, (count) => count + 1).pipe(
        Effect.andThen(Effect.fail(new DecisionClosed({ decision })))
      )
    )
  );

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

describe("a command that needs approval", () => {
  it.effect(
    "exits 2 without --yes, in one line naming --yes, and calls nothing",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const run = yield* runProgram(decideArgs, {
          handlers: deciding(calls),
        });

        expect(run.code).toBe(2);
        expect(run.err).toHaveLength(1);
        expect(run.err[0]).toContain("--yes");
        expect(run.out).toStrictEqual([]);
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );

  it.effect(
    "prints the payload it would send under --dry-run, and calls nothing",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const run = yield* runProgram([...decideArgs, "--dry-run", "--json"], {
          handlers: deciding(calls),
        });

        expect(run.code).toBe(0);
        expect(run.out).toHaveLength(1);
        expect(yield* decodeEnvelope(run.out[0] ?? "")).toStrictEqual({
          command: "decide",
          data: {
            dryRun: true,
            payload: {
              choice: "accept",
              decision,
              project: "oscabriel/datekit",
            },
          },
          ok: true,
          v: 1,
        });
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );

  it.effect("prints the payload as text for a person under --dry-run", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const run = yield* runProgram([...decideArgs, "--dry-run"], {
        handlers: deciding(calls),
      });

      expect(run.out.join("\n")).toContain(`"decision": "${decision}"`);
      expect(yield* Ref.get(calls)).toBe(0);
    })
  );

  it.effect("calls the platform with --yes", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const run = yield* runProgram([...decideArgs, "--yes"], {
        handlers: deciding(calls),
      });

      // DecisionClosed: the decision named no longer stands open.
      expect(run.code).toBe(66);
      expect(yield* Ref.get(calls)).toBe(1);
    })
  );
});

describe("a read", () => {
  it.effect("has no --dry-run: asking for one is a usage error", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(
        ["asks", "--project", "oscabriel/datekit", "--dry-run"],
        { handlers: unanswered }
      );

      expect(run.code).toBe(2);
      expect(run.err.join("\n")).toContain("--dry-run");
    })
  );
});

/** A platform that lists no asks, recording the project each listing names. */
const listing = (asked: Ref.Ref<readonly string[]>) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("listAsks", ({ project: named }) =>
      Ref.update(asked, (all) => [...all, named]).pipe(Effect.as({ asks: [] }))
    )
  );

/** A fresh git repo whose `origin` is `url`, at its real path. */
const repoWithOrigin = (url: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

    yield* gitOk(dir, "init", "--quiet");
    yield* gitOk(dir, "remote", "add", "origin", url);

    return dir;
  });

describe("the project a command is about", () => {
  it.live("comes from the repo's remote when --project is left out", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make<readonly string[]>([]);

      const cwd = yield* repoWithOrigin(
        "https://platform-dev.example.workers.dev/datekit--fix-week--tester.git"
      );

      const run = yield* runProgram(["asks", "--json"], {
        cwd,
        handlers: listing(asked),
      });

      expect(run.code).toBe(0);
      expect(yield* Ref.get(asked)).toStrictEqual(["oscabriel/datekit"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("is a usage error outside a platform's repo, naming --project", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make<readonly string[]>([]);
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped();

      const run = yield* runProgram(["asks"], {
        cwd,
        handlers: listing(asked),
      });

      expect(run.code).toBe(2);
      expect(run.err.join("\n")).toContain("--project");
      expect(yield* Ref.get(asked)).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("a misuse", () => {
  it.effect(
    "prints one line on stderr and nothing on stdout, even with --json",
    () =>
      Effect.gen(function* () {
        const run = yield* runProgram(
          ["asks", "--project", "oscabriel/datekit", "--bogus", "--json"],
          { env: { CLAUDECODE: "1" }, handlers: unanswered }
        );

        expect(run.code).toBe(2);
        expect(run.out).toStrictEqual([]);
        expect(run.err).toHaveLength(1);
        expect(run.err[0]).toContain("--bogus");
      })
  );

  it.effect("leaves help asked for on stdout", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(["--help"], { handlers: unanswered });

      expect(run.code).toBe(0);
      expect(run.out.join("\n")).toContain("Start here:");
      expect(run.err).toStrictEqual([]);
    })
  );
});

const submitArgs = [
  "submit",
  "--project",
  project,
  "--ask",
  ask,
  "--base",
  base,
  "--head",
  head,
  "--requestId",
  requestId,
];

/** An answer's receipt, standing at `outcome`. */
const receiptAt = (outcome: Outcome) => ({
  ask,
  base,
  head,
  outcome,
  project,
  requestId,
});

/** A platform whose `submitAnswer` gives `receipt` back. */
const receiving = (receipt: ReturnType<typeof receiptAt>) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("submitAnswer", () => Effect.succeed(receipt))
  );

/** Each command that names an ask, and what else it takes, as a person types it. */
const naming = {
  finish: [
    "--project",
    project,
    "--base",
    base,
    "--head",
    head,
    "--requestId",
    requestId,
    "--yes",
  ],
  release: ["--project", project],
  submit: [
    "--project",
    project,
    "--base",
    base,
    "--head",
    head,
    "--requestId",
    requestId,
  ],
  verdict: ["--project", project],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** A platform that records the ask each call names, and answers each call plainly. */
const recordingAsks = (named: Ref.Ref<readonly string[]>) => {
  const record = (given: string) => Ref.update(named, (all) => [...all, given]);

  const receipt = receiptAt(Outcome.cases.Checking.make({ stage: "merge" }));

  return Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("verdict", (payload) =>
      record(payload.ask).pipe(Effect.as({}))
    ),
    Contracts.toLayerHandler("release", (payload) =>
      record(payload.ask).pipe(Effect.as({ released: true }))
    ),
    Contracts.toLayerHandler("submitAnswer", (payload) =>
      record(payload.ask).pipe(Effect.as(receipt))
    ),
    Contracts.toLayerHandler("finish", (payload) =>
      record(payload.ask).pipe(Effect.as(receipt))
    )
  );
};

describe("the ask a command is about", () => {
  it.effect(
    "is its first argument on verdict, release, submit and finish, as on claim",
    () =>
      Effect.gen(function* () {
        const named = yield* Ref.make<readonly string[]>([]);

        const codes = yield* Effect.forEach(
          Object.entries(naming),
          ([command, rest]) =>
            Effect.map(
              runProgram([command, ask, ...rest], {
                handlers: recordingAsks(named),
              }),
              ({ code }) => [command, code] as const
            )
        );

        expect(codes).toStrictEqual(
          Object.keys(naming).map((command) => [command, 0])
        );
        expect(yield* Ref.get(named)).toStrictEqual([ask, ask, ask, ask]);
      })
  );

  it.effect(
    "still comes from --ask, which help no longer shows and which prints nothing more",
    () =>
      Effect.gen(function* () {
        const named = yield* Ref.make<readonly string[]>([]);

        const runs = yield* Effect.forEach(
          Object.entries(naming),
          ([command, rest]) =>
            runProgram([command, "--ask", ask, ...rest], {
              handlers: recordingAsks(named),
            })
        );

        expect(runs.map(({ code }) => code)).toStrictEqual([0, 0, 0, 0]);
        expect(runs.flatMap(({ err }) => err)).toStrictEqual([]);
        expect(yield* Ref.get(named)).toStrictEqual([ask, ask, ask, ask]);

        const help = yield* runProgram(["verdict", "--help"], {
          handlers: unanswered,
        });

        expect(help.out.join("\n")).toContain("<ask>");
        expect(help.out.join("\n")).not.toContain("--ask");
      })
  );

  it.effect("is a usage error naming <ask> when neither form gives it", () =>
    Effect.gen(function* () {
      const named = yield* Ref.make<readonly string[]>([]);

      const run = yield* runProgram(["verdict", ...naming.verdict], {
        handlers: recordingAsks(named),
      });

      expect(run.code).toBe(2);
      expect(run.err).toHaveLength(1);
      expect(run.err[0]).toContain("<ask>");
      expect(yield* Ref.get(named)).toStrictEqual([]);
    })
  );
});

describe("an answer offered with submit", () => {
  it.effect("prints the same line git's remote: output gives its push", () =>
    Effect.gen(function* () {
      const offered = receiptAt(
        Outcome.cases.Checking.make({ stage: "merge" })
      );

      const run = yield* runProgram(submitArgs, {
        handlers: receiving(offered),
      });

      expect(run.code).toBe(0);
      expect(Result.map(receiptLine(offered), (line) => [line])).toStrictEqual(
        Result.succeed(run.out)
      );
    })
  );

  it.effect(
    "prints a refused receipt as a refusal: once on stderr, nothing on stdout, exit 75 for a moved main",
    () =>
      Effect.gen(function* () {
        const run = yield* runProgram(submitArgs, {
          handlers: receiving(
            receiptAt(Outcome.cases.Refused.make({ refusals: [refusal] }))
          ),
        });

        expect(run.code).toBe(75);
        expect(run.out).toStrictEqual([]);
        expect(run.err).toStrictEqual(explain([refusal]));
      })
  );

  it.effect("puts a refused receipt in one refused envelope under --json", () =>
    Effect.gen(function* () {
      const run = yield* runProgram([...submitArgs, "--json"], {
        handlers: receiving(
          receiptAt(Outcome.cases.Refused.make({ refusals: [refusal] }))
        ),
      });

      expect(run.code).toBe(75);
      expect(run.err).toStrictEqual([]);
      expect(run.out).toHaveLength(1);
      expect(yield* decodeEnvelope(run.out[0] ?? "")).toStrictEqual({
        command: "submit",
        ok: false,
        refusals: [refusal],
        v: 1,
      });
    })
  );
});
