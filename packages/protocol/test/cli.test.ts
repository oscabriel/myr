import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { CliOutput, Command } from "effect/cli";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import {
  ApprovalNeeded,
  MissingValue,
  Reported,
  toCommand,
  toCommands,
} from "../src/cli.ts";
import type { CommandOutput } from "../src/cli.ts";
import {
  Claim,
  Client,
  Contracts,
  Decide,
  ListAsks,
  ListProjects,
  OpenAsk,
  ShowAsk,
  SubmitAnswer,
} from "../src/contracts.ts";
import { Outcome } from "../src/domain/outcome.ts";
import {
  AskId,
  CommitSha,
  DecisionId,
  KindName,
  ProjectName,
  RequestId,
} from "../src/ids.ts";
import { AskFull, DecisionClosed, StaleBase } from "../src/refusal.ts";
import { asTester, unanswered } from "../src/testing.ts";
import { ask, base, main, path } from "./examples.ts";

const head = CommitSha.make("3333333333333333333333333333333333333333");

const project = ProjectName.make("oscabriel/datekit");

const requestId = RequestId.make("answer-0001");

const answer = [
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

const listing = (territory: string) => ({
  ask,
  blockedBy: [],
  claimed: false,
  kind: KindName.make("fix"),
  territory,
  want: "Parse a comma",
});

const quiet = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("listAsks", ({ project: echoed }) =>
    Effect.succeed({ asks: [listing(echoed)] })
  )
);

const stale = (refusal: StaleBase) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("submitAnswer", () => Effect.fail(refusal))
  );

type HandedTo<Method extends keyof CommandOutput> = Parameters<
  CommandOutput[Method]
>[0];

type Printed =
  | { readonly kind: "success"; readonly input: HandedTo<"success"> }
  | { readonly kind: "refused"; readonly input: HandedTo<"refused"> }
  | { readonly kind: "plan"; readonly input: HandedTo<"plan"> };

const lines = (output: Effect.Effect<readonly unknown[]>) =>
  Effect.map(output, (all) =>
    all.flatMap((chunk) => String(chunk).split("\n"))
  );

const run = <Name extends string, Input, E, R, ContextInput>(
  handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>>,
  build: (
    output: Effect.Effect<CommandOutput>
  ) => Command.Command<Name, Input, ContextInput, E, R>,
  args: readonly string[]
) =>
  Effect.gen(function* () {
    const printed = yield* Ref.make<readonly Printed[]>([]);

    const record = (entry: Printed) =>
      Ref.update(printed, (all) => [...all, entry]);

    const output: CommandOutput = {
      plan: (input) => record({ input, kind: "plan" }),
      refused: (input) => record({ input, kind: "refused" }),
      success: (input) => record({ input, kind: "success" }),
    };

    const result = yield* Effect.result(
      Command.runWith(build(Effect.succeed(output)), { version: "0.0.0" })(args)
    );

    return {
      err: yield* lines(TestConsole.errorLines),
      out: yield* lines(TestConsole.logLines),
      printed: yield* Ref.get(printed),
      result,
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestConsole.layer,
        CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
        Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
          Layer.provide([handlers, asTester])
        )
      ).pipe(Layer.provideMerge(NodeServices.layer))
    )
  );

const counting = <A, E>(calls: Ref.Ref<number>, reply: Effect.Effect<A, E>) =>
  Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(reply));

const decision = DecisionId.make("dec-000001");

const decided = Effect.fail(new DecisionClosed({ decision }));

describe("a contract as a CLI command", () => {
  it.effect(
    "takes the payload as flags and hands the encoded success to the output",
    () =>
      Effect.gen(function* () {
        const { printed } = yield* run(
          quiet,
          (output) => toCommand(ListAsks, Effect.service(Client), { output }),
          ["--project", "oscabriel/demo"]
        );

        const data = { asks: [listing("oscabriel/demo")] };

        expect(printed).toStrictEqual([
          {
            input: {
              command: "asks",
              data,
              json: false,
              view: {
                markdown: [
                  "```json",
                  JSON.stringify(data, null, 2),
                  "```",
                ].join("\n"),
                text: JSON.stringify(data, null, 2),
              },
            },
            kind: "success",
          },
        ]);
      })
  );

  it.effect("prints the success through the view it is given", () =>
    Effect.gen(function* () {
      const { printed } = yield* run(
        quiet,
        (output) =>
          toCommand(ListAsks, Effect.service(Client), {
            output,
            render: ({ asks }) =>
              Option.some({ markdown: `**${asks.length}** open asks` }),
          }),
        ["--project", "oscabriel/demo", "--json"]
      );

      expect(printed).toStrictEqual([
        {
          input: {
            command: "asks",
            data: { asks: [listing("oscabriel/demo")] },
            json: true,
            view: { markdown: "**1** open asks" },
          },
          kind: "success",
        },
      ]);
    })
  );

  it.effect(
    "hands a refusal to the output once, prints nothing itself, and fails as reported",
    () =>
      Effect.gen(function* () {
        const refusal = new StaleBase({ base, conflicts: [path], main });

        const { err, out, printed, result } = yield* run(
          stale(refusal),
          (output) =>
            toCommand(SubmitAnswer, Effect.service(Client), { output }),
          [...answer, "--json"]
        );

        expect(result).toStrictEqual(Result.fail(Reported.of([refusal])));
        expect(printed).toStrictEqual([
          {
            input: { command: "submit", json: true, refusals: [refusal] },
            kind: "refused",
          },
        ]);
        expect({ err, out }).toStrictEqual({ err: [], out: [] });
      })
  );

  it.effect(
    "hands the refusals a success carries to the output once, and fails as reported",
    () =>
      Effect.gen(function* () {
        const refusal = new StaleBase({ base, conflicts: [path], main });

        const refused = {
          ask,
          base,
          head,
          outcome: Outcome.cases.Refused.make({ refusals: [refusal] }),
          project,
          requestId,
        };

        const { printed, result } = yield* run(
          Layer.mergeAll(
            unanswered,
            Contracts.toLayerHandler("submitAnswer", () =>
              Effect.succeed(refused)
            )
          ),
          (output) =>
            toCommand(SubmitAnswer, Effect.service(Client), {
              output,
              refusalsIn: ({ outcome }) =>
                Outcome.guards.Refused(outcome) ? outcome.refusals : [],
            }),
          answer
        );

        expect(result).toStrictEqual(Result.fail(Reported.of([refusal])));
        expect(printed).toStrictEqual([
          {
            input: { command: "submit", json: false, refusals: [refusal] },
            kind: "refused",
          },
        ]);
      })
  );

  it.effect("refuses a malformed commit id before calling anything", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const { err, result } = yield* run(
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("submitAnswer", () =>
            counting(calls, Effect.die("a malformed answer reached the call"))
          )
        ),
        (output) => toCommand(SubmitAnswer, Effect.service(Client), { output }),
        answer.map((value) => (value === base ? "not-a-sha" : value))
      );

      expect(Result.isFailure(result)).toBeTruthy();
      expect(yield* Ref.get(calls)).toBe(0);
      expect(err.join("\n")).toContain("--base");
    })
  );

  it.effect(
    "is named by its Cli annotation, and takes the fields it names in order",
    () =>
      Effect.gen(function* () {
        const claimed = yield* Ref.make<readonly unknown[]>([]);

        const { result } = yield* run(
          Layer.mergeAll(
            unanswered,
            Contracts.toLayerHandler("claim", (payload) =>
              Ref.update(claimed, (all) => [...all, payload]).pipe(
                Effect.andThen(Effect.fail(new AskFull({ ask: payload.ask })))
              )
            )
          ),
          (output) => toCommand(Claim, Effect.service(Client), { output }),
          ["fix-week", "--project", project]
        );

        expect(result).toStrictEqual(
          Result.fail(
            Reported.of([new AskFull({ ask: AskId.make("fix-week") })])
          )
        );
        expect(yield* Ref.get(claimed)).toStrictEqual([
          { ask: AskId.make("fix-week"), project },
        ]);
      })
  );

  it("takes the last word of a two-word name as its own", () => {
    const output = Effect.succeed<CommandOutput>({
      plan: () => Effect.void,
      refused: () => Effect.void,
      success: () => Effect.void,
    });

    expect(
      [OpenAsk, ShowAsk, ListAsks].map(
        (rpc) => toCommand(rpc, Effect.service(Client), { output }).name
      )
    ).toStrictEqual(["open", "ask", "asks"]);
  });

  it.effect("takes nothing when the contract takes nothing", () =>
    Effect.gen(function* () {
      const { printed } = yield* run(
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("listProjects", () =>
            Effect.succeed({ projects: [] })
          )
        ),
        (output) => toCommand(ListProjects, Effect.service(Client), { output }),
        ["--json"]
      );

      expect(printed).toHaveLength(1);
      expect(printed[0]?.input).toHaveProperty("data", { projects: [] });
    })
  );
});

describe("--yes and --dry-run", () => {
  const decideArgs = [
    "--project",
    project,
    "--decision",
    decision,
    "--choice",
    "accept",
  ];

  it.effect(
    "refuses a contract that needs approval without --yes, before calling it",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const { printed, result } = yield* run(
          Layer.mergeAll(
            unanswered,
            Contracts.toLayerHandler("decide", () => counting(calls, decided))
          ),
          (output) => toCommand(Decide, Effect.service(Client), { output }),
          decideArgs
        );

        expect(result).toStrictEqual(
          Result.fail(new ApprovalNeeded({ command: "decide" }))
        );
        expect(yield* Ref.get(calls)).toBe(0);
        expect(printed).toStrictEqual([]);
      })
  );

  it.effect("calls it with --yes", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      yield* run(
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("decide", () => counting(calls, decided))
        ),
        (output) => toCommand(Decide, Effect.service(Client), { output }),
        [...decideArgs, "--yes"]
      );

      expect(yield* Ref.get(calls)).toBe(1);
    })
  );

  it.effect(
    "hands the encoded payload to the output's plan under --dry-run, and calls nothing",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const { printed, result } = yield* run(
          Layer.mergeAll(
            unanswered,
            Contracts.toLayerHandler("decide", () => counting(calls, decided))
          ),
          (output) => toCommand(Decide, Effect.service(Client), { output }),
          [...decideArgs, "--dry-run", "--json"]
        );

        expect(Result.isSuccess(result)).toBeTruthy();
        expect(yield* Ref.get(calls)).toBe(0);
        expect(printed).toStrictEqual([
          {
            input: {
              command: "decide",
              json: true,
              payload: { choice: "accept", decision, project },
            },
            kind: "plan",
          },
        ]);
      })
  );

  it.effect(
    "offers no --dry-run on a read, and no --yes where nobody approves",
    () =>
      Effect.gen(function* () {
        const dryRead = yield* run(
          quiet,
          (output) => toCommand(ListAsks, Effect.service(Client), { output }),
          ["--project", project, "--dry-run"]
        );

        const yesClaim = yield* run(
          quiet,
          (output) => toCommand(Claim, Effect.service(Client), { output }),
          ["fix-week", "--project", project, "--yes"]
        );

        expect(dryRead.err.join("\n")).toContain("--dry-run");
        expect(yesClaim.err.join("\n")).toContain("--yes");
        expect([dryRead.printed, yesClaim.printed]).toStrictEqual([[], []]);
      })
  );
});

describe("defaults", () => {
  it.effect(
    "fill a required field left out, and are read only when one is",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0);

        const defaults = {
          fields: { project: "the repo's project" },
          values: Ref.update(reads, (count) => count + 1).pipe(
            Effect.as({ project: "oscabriel/datekit" })
          ),
        };

        const build = (output: Effect.Effect<CommandOutput>) =>
          toCommand(ListAsks, Effect.service(Client), { defaults, output });

        const filled = yield* run(quiet, build, ["--json"]);

        const given = yield* run(quiet, build, [
          "--project",
          "oscabriel/demo",
          "--json",
        ]);

        expect(
          [filled, given].map(({ printed }) => printed[0]?.input)
        ).toStrictEqual([
          expect.objectContaining({
            data: { asks: [listing("oscabriel/datekit")] },
          }),
          expect.objectContaining({
            data: { asks: [listing("oscabriel/demo")] },
          }),
        ]);
        expect(yield* Ref.get(reads)).toBe(1);
      })
  );

  it.effect(
    "leave a field they have no value for missing, naming its flag",
    () =>
      Effect.gen(function* () {
        const { printed, result } = yield* run(
          quiet,
          (output) =>
            toCommand(ListAsks, Effect.service(Client), {
              defaults: {
                fields: { project: "the repo's project" },
                values: Effect.succeed({}),
              },
              output,
            }),
          []
        );

        expect(result).toStrictEqual(
          Result.fail(new MissingValue({ command: "asks", flag: "--project" }))
        );
        expect(printed).toStrictEqual([]);
      })
  );
});

const commands = (built: Effect.Effect<CommandOutput>) =>
  toCommands(Contracts, Effect.service(Client), {
    exclude: [],
    output: built,
    views: {
      listAsks: (success) =>
        Schema.is(ListAsks.successSchema)(success)
          ? Option.some({ markdown: `${success.asks.length} asks` })
          : Option.none(),
    },
  });

const root = (built: Effect.Effect<CommandOutput>) =>
  Command.make("root").pipe(
    Command.withSubcommands(commands(built).map(({ command }) => command))
  );

describe("the group as CLI commands", () => {
  const output = Effect.succeed<CommandOutput>({
    plan: () => Effect.void,
    refused: () => Effect.void,
    success: () => Effect.void,
  });

  it("projects each contract served on the CLI, but those excluded, at its path", () => {
    const paths = toCommands(Contracts, Effect.service(Client), {
      exclude: ["initProject", "setEnv"],
      output,
    }).map(({ path: words }) => words.join(" "));

    expect(paths).toStrictEqual([
      "projects",
      "front",
      "asks",
      "ask",
      "status",
      "whoami",
      "verdict",
      "landing",
      "credits",
      "today",
      "ledger",
      "env shape",
      "policy",
      "discussions",
      "discussion",
      "ask open",
      "discussion post",
      "decide",
      "claim",
      "release",
      "submit",
      "finish",
      "land",
      "fork",
      "vouch",
      "evidence",
    ]);
  });

  it.effect("renders each result with the view its tag names", () =>
    Effect.gen(function* () {
      const { printed } = yield* run(quiet, root, [
        "asks",
        "--project",
        "oscabriel/demo",
      ]);

      expect(printed[0]?.input).toHaveProperty("view", {
        markdown: "1 asks",
      });
    })
  );
});
