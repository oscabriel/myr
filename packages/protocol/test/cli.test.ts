import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Result, Schema } from "effect";
import { CliOutput, Command } from "effect/cli";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { toCommand } from "../src/cli.ts";
import { Client, Contracts, ListAsks, SubmitAnswer } from "../src/contracts.ts";
import { CommitSha, KindName, ProjectName, RequestId } from "../src/ids.ts";
import { StaleBase } from "../src/refusal.ts";
import { asTester, unanswered } from "../src/testing.ts";
import { ask, base, main, path } from "./examples.ts";

const head = CommitSha.make("3333333333333333333333333333333333333333");

const project = ProjectName.make("datekit");

const requestId = RequestId.make("answer-0001");

/** An answer's flags, as a person types them. */
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

/** `listAsks` echoes its project as the territory. */
const quiet = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("listAsks", ({ project: echoed }) =>
    Effect.succeed({
      asks: [
        {
          ask,
          blockedBy: [],
          claimed: false,
          kind: KindName.make("fix"),
          territory: echoed,
          want: "Parse a comma",
        },
      ],
    })
  )
);

/** Contracts whose answers always meet a moved main. */
const stale = (refusal: StaleBase) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("submitAnswer", () => Effect.fail(refusal))
  );

/** What was printed, one entry per line however it was written. */
const lines = (output: Effect.Effect<readonly unknown[]>) =>
  Effect.map(output, (all) =>
    all.flatMap((chunk) => String(chunk).split("\n"))
  );

/**
 * Runs `command` on `args`, its calls answered by `handlers`, and returns how
 * it ended with what it printed to stdout and stderr.
 */
const run = <Name extends string, Input, E, R, ContextInput>(
  handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>>,
  command: Command.Command<Name, Input, ContextInput, E, R>,
  args: readonly string[]
) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      Command.runWith(command, { version: "0.0.0" })(args)
    );

    return {
      err: yield* lines(TestConsole.errorLines),
      out: yield* lines(TestConsole.logLines),
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

const Json = Schema.fromJsonString(Schema.Unknown);

const submitAnswer = toCommand(SubmitAnswer, Effect.service(Client));

describe("the contracts as CLI commands", () => {
  it.effect("takes the payload as flags and prints the success as JSON", () =>
    Effect.gen(function* () {
      const { out } = yield* run(
        quiet,
        toCommand(ListAsks, Effect.service(Client)),
        ["--project", "demo"]
      );

      expect(yield* Schema.decodeEffect(Json)(out.join("\n"))).toStrictEqual({
        asks: [
          {
            ask: "fix-parser",
            blockedBy: [],
            claimed: false,
            kind: "fix",
            territory: "demo",
            want: "Parse a comma",
          },
        ],
      });
    })
  );

  it.effect("prints a refusal as the renderer's text and fails with it", () =>
    Effect.gen(function* () {
      const refusal = new StaleBase({ base, conflicts: [path], main });

      const { err, result } = yield* run(stale(refusal), submitAnswer, answer);

      expect(result).toStrictEqual(Result.fail(refusal));
      expect(err).toStrictEqual([
        "StaleBase: main moved to 2222222, past your base 1111111; conflicts in src/a.ts",
        "  next: git pull --rebase",
        "  retryable: yes",
      ]);
    })
  );

  it.effect("with --json, prints the refusal as JSON that keeps its tag", () =>
    Effect.gen(function* () {
      const refusal = new StaleBase({ base, conflicts: [path], main });

      const { err, out, result } = yield* run(stale(refusal), submitAnswer, [
        ...answer,
        "--json",
      ]);

      const printed = yield* Schema.decodeEffect(Json)(out.join("\n"));

      expect(result).toStrictEqual(Result.fail(refusal));
      expect(err).toStrictEqual([]);
      expect(printed).toHaveProperty("_tag", "StaleBase");
      expect(
        yield* Schema.decodeUnknownEffect(StaleBase)(printed)
      ).toStrictEqual(refusal);
    })
  );

  it.effect("refuses a malformed commit id before calling anything", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const { err, result } = yield* run(
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("submitAnswer", () =>
            Ref.update(calls, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("a malformed answer reached the call"))
            )
          )
        ),
        submitAnswer,
        answer.map((value) => (value === base ? "not-a-sha" : value))
      );

      expect(Result.isFailure(result)).toBeTruthy();
      expect(yield* Ref.get(calls)).toBe(0);
      expect(err.join("\n")).toContain("--base");
    })
  );
});
