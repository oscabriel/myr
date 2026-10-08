/**
 * Today in the terminal, as a decider works it: the keys they press, the
 * screen they read, and the refusal an agent or a script meets instead.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { createTestRenderer } from "@opentui/core/testing";
import { createElement } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { Decide } from "@repo/protocol/contracts";
import { DecisionClosed, NotDecider } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import {
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schema,
  Stdio,
} from "effect";
import { Command } from "effect/cli";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { OutputLive } from "../../src/output.ts";
import { policyFor } from "../../src/policy.ts";
import type { Policy } from "../../src/policy.ts";
import { today as todayCommand } from "../../src/tui/command.ts";
import { OpenScreen, runTodayTui, TuiRefused } from "../../src/tui/run.ts";
import type { Screen } from "../../src/tui/run.ts";
import { screenOn } from "../../src/tui/screen.ts";
import { reduce, start } from "../../src/tui/today.ts";
import type { DecideCall, TodayViewState } from "../../src/tui/today.ts";
import { TodayView } from "../../src/tui/view.ts";
import { runProgram } from "../remote-server.ts";
import { datekit, okonkwo, proposal, stray, today, vouch } from "./fixture.ts";

/** The state after `keys`, one after another, and every call they made. */
const press = (state: TodayViewState, keys: readonly string[]) => {
  const calls: DecideCall[] = [];
  let now = state;

  for (const key of keys) {
    const step = reduce(now, key);

    calls.push(...Option.toArray(step.call));
    now = step.state;
  }

  return { calls, state: now };
};

describe("the keys a decider presses on Today", () => {
  it("declines the second decision with d, its default, at once", () => {
    const { calls } = press(start(today), ["down", "d"]);

    expect(calls).toStrictEqual([
      { choice: "decline", decision: vouch.id, project: datekit },
    ]);
  });

  it("asks before a choice other than the default, and sends it on y", () => {
    const asked = press(start(today), ["down", "a"]);

    expect([asked.calls, asked.state.confirming]).toStrictEqual([
      [],
      Option.some({ choice: "accept", decision: vouch.id, project: datekit }),
    ]);

    expect(press(asked.state, ["y"]).calls).toStrictEqual([
      { choice: "accept", decision: vouch.id, project: datekit },
    ]);
  });

  it("keeps the decision open when the decider says n, or moves on", () => {
    const asked = press(start(today), ["down", "a"]).state;

    expect(press(asked, ["n", "y"]).calls).toStrictEqual([]);
    expect(press(asked, ["up", "y"])).toStrictEqual({
      calls: [],
      state: { ...asked, confirming: Option.none(), cursor: 0 },
    });
  });

  it("offers a stray push its own choices: r reverts at once, a adopts after y, d does nothing", () => {
    expect(press(start(today), ["d", "r"]).calls).toStrictEqual([
      { choice: "revert", decision: stray.id, project: datekit },
    ]);

    expect(press(start(today), ["a", "y"]).calls).toStrictEqual([
      { choice: "adopt", decision: stray.id, project: datekit },
    ]);
  });

  it("keeps the cursor on Today's decisions, and closes on q", () => {
    const { state } = press(start(today), ["up", "down", "down", "down"]);

    expect(state.cursor).toBe(2);
    expect(reduce(state, "q").quit).toBeTruthy();
    expect(reduce(state, "down").quit).toBeFalsy();
  });
});

/** The screen `TodayView` draws for `state`, one string per terminal row. */
const screenOf = (state: TodayViewState) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      testRender(createElement(TodayView, { state }), {
        height: 40,
        width: 120,
      })
    ),
    (setup) =>
      Effect.promise(() => setup.renderOnce()).pipe(
        Effect.map(() =>
          setup
            .captureCharFrame()
            .split("\n")
            .map((row) => row.trimEnd())
        )
      ),
    (setup) =>
      Effect.sync(() => {
        setup.renderer.destroy();
      })
  );

/** The rows of a screen that hold `text`. */
const rowsWith = (rows: readonly string[], text: string) =>
  rows.filter((row) => row.includes(text));

describe("Today as the terminal shows it", () => {
  it.live("says whose Today it is and how much of the budget is used", () =>
    Effect.gen(function* () {
      const rows = yield* screenOf(start(today));

      expect(rowsWith(rows, "Today for okonkwo")).toHaveLength(1);
      expect(rowsWith(rows, "Budget: 2 of 5 decisions used")).toStrictEqual([
        "Budget: 2 of 5 decisions used, 3 left today · 1 finish, counted apart",
      ]);
      expect(rowsWith(rows, "1 more waits for tomorrow")).toHaveLength(1);
    })
  );

  it.live("lists the decisions in expiry order, the cursor on the first", () =>
    Effect.gen(function* () {
      const rows = yield* screenOf(start(today));

      // A decision's first row: the cursor's mark, then its project and id.
      const listed = rows.flatMap((row) => {
        const found =
          /^(?<mark>[> ]) {1,3}(?:! )?datekit\/(?<id>dec-\d+) /u.exec(
            row
          )?.groups;

        return found === undefined ? [] : [`${found.mark}${found.id}`];
      });

      expect(listed).toStrictEqual([
        ">dec-000002",
        " dec-000003",
        " dec-000001",
      ]);
    })
  );

  it.live(
    "marks each decision's default, and the one expiring within the day",
    () =>
      Effect.gen(function* () {
        const rows = yield* screenOf(start(today));

        const defaults = rows.flatMap(
          (row) =>
            /if nobody decides: (?<choice>\w+)/u.exec(row)?.groups?.choice ?? []
        );

        expect(defaults).toStrictEqual(["revert", "decline", "accept"]);
        expect(
          rows
            .filter((row) => row.includes("if nobody decides:"))
            .map((row) => row.includes("within the day"))
        ).toStrictEqual([true, false, false]);
        expect(rowsWith(rows, "! datekit/")).toHaveLength(1);
      })
  );

  it.live("shows each decision's evidence and the newcomers to welcome", () =>
    Effect.gen(function* () {
      const rows = yield* screenOf(start(today));

      expect(
        rowsWith(rows, "pushed by: a token outside the platform")
      ).toHaveLength(1);
      expect(rowsWith(rows, "Newcomers to welcome: ada, grace")).toHaveLength(
        1
      );
    })
  );

  it.live(
    "names the keys the decision under the cursor takes, and asks before a non-default",
    () =>
      Effect.gen(function* () {
        const first = yield* screenOf(start(today));

        expect(rowsWith(first, "a adopt")).toStrictEqual([
          "up/down move · a adopt · r revert · q quit",
        ]);

        const asking = yield* screenOf(
          press(start(today), ["down", "a"]).state
        );

        expect(rowsWith(asking, "Accept datekit/dec-000003?")).toStrictEqual([
          "Accept datekit/dec-000003? Its default is decline. y to send it, n to keep it open.",
        ]);
      })
  );
});

/**
 * Where the TUI may be asked to open: the env and terminals of the process,
 * and a platform that no test here may reach.
 */
const surroundings = (input: {
  readonly env: Readonly<Record<string, string>>;
  readonly stdoutIsTTY: boolean;
  readonly stdinIsTTY: boolean;
}) =>
  Layer.mergeAll(
    policyFor({ env: input.env, isTTY: input.stdoutIsTTY }),
    Stdio.layerTest({ stdinIsTerminal: Effect.succeed(input.stdinIsTTY) }),
    Layer.mock(Client)({})
  );

/** What `runTodayTui` refused with, as its next command and its one line. */
const refusalIn = (layer: ReturnType<typeof surroundings>) =>
  runTodayTui({ project: Option.none() }).pipe(
    Effect.flip,
    Effect.map((failure) =>
      Schema.is(TuiRefused)(failure)
        ? { message: failure.message, next: failure.next }
        : failure
    ),
    Effect.provide(layer)
  );

describe("who may open Today full-screen", () => {
  it.effect(
    "refuses an agent, before calling the platform, and points to today --json",
    () =>
      Effect.gen(function* () {
        const refused = yield* refusalIn(
          surroundings({
            env: { CLAUDECODE: "1" },
            stdinIsTTY: true,
            stdoutIsTTY: true,
          })
        );

        expect(refused).toStrictEqual({
          message: `${Brand.cli} today --tui needs a person at a terminal, but the env names the harness claude-code: run ${Brand.cli} today --json instead`,
          next: `${Brand.cli} today --json`,
        });
      })
  );

  it.effect.each([
    {
      reason: "stdout is not a terminal",
      stdinIsTTY: true,
      stdoutIsTTY: false,
    },
    { reason: "stdin is not a terminal", stdinIsTTY: false, stdoutIsTTY: true },
  ])("refuses when $reason", ({ reason, stdinIsTTY, stdoutIsTTY }) =>
    Effect.gen(function* () {
      const refused = yield* refusalIn(
        surroundings({ env: {}, stdinIsTTY, stdoutIsTTY })
      );

      expect(refused).toStrictEqual({
        message: `${Brand.cli} today --tui needs a person at a terminal, but ${reason}: run ${Brand.cli} today --json instead`,
        next: `${Brand.cli} today --json`,
      });
    })
  );
});

/** A screen that reads `keys` in turn (then `q`) and keeps every state it is shown. */
const scripted = (keys: readonly string[]) =>
  Effect.gen(function* () {
    const left = yield* Ref.make(keys);
    const shown = yield* Ref.make<readonly TodayViewState[]>([]);

    const screen: Screen = {
      forget: Effect.void,
      key: Ref.modify(left, ([next = "q", ...rest]) => [next, rest]),
      show: (state) => Ref.update(shown, (all) => [...all, state]),
    };

    return { screen, shown };
  });

/**
 * The platform for one decider: `today` lists the fixture's decisions but
 * those decided since, and `decide` takes every choice but those on
 * `closed`, which it refuses as already decided. Returns the client, and
 * every `decide` payload it saw.
 */
const platform = (closed: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const decided = yield* Ref.make<
      readonly (typeof Decide.payloadSchema.Type)[]
    >([]);

    const handlers = Layer.mergeAll(
      unanswered,
      Contracts.toLayerHandler("today", () =>
        Effect.map(Ref.get(decided), (calls) => ({
          ...today,
          decisions: today.decisions.filter(
            ({ id }) => !calls.some(({ decision }) => decision === id)
          ),
        }))
      ),
      Contracts.toLayerHandler("decide", (payload) =>
        closed.has(payload.decision)
          ? Effect.fail(new DecisionClosed({ decision: payload.decision }))
          : Effect.gen(function* () {
              yield* Ref.update(decided, (all) => [...all, payload]);

              const decision =
                today.decisions.find(({ id }) => id === payload.decision) ??
                vouch;

              return {
                decision: {
                  ...decision,
                  decided: {
                    at: DateTime.makeUnsafe("2026-10-08T08:00:00Z"),
                    by: okonkwo,
                    choice: payload.choice,
                  },
                },
              };
            })
      )
    );

    const client = Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([handlers, asTester])
    );

    return { client, decided };
  });

/** A person at a terminal, with the platform `client` and the screen `screen`. */
const atTerminal =
  (client: Layer.Layer<Client>, screen: Screen) =>
  <A, E>(effect: Effect.Effect<A, E, Client | Policy | Stdio.Stdio>) =>
    effect.pipe(
      Effect.provideService(OpenScreen, Effect.succeed(screen)),
      Effect.provide(
        Layer.mergeAll(
          policyFor({ env: {}, isTTY: true }),
          Stdio.layerTest({ stdinIsTerminal: Effect.succeed(true) }),
          client
        )
      )
    );

const ids = (state: TodayViewState | undefined) =>
  state?.today.decisions.map(({ id }) => id);

describe("Today full-screen, worked by a decider", () => {
  it.effect(
    "sends d on the second decision as a decline, then shows Today without it",
    () =>
      Effect.gen(function* () {
        const { client, decided } = yield* platform(new Set());
        const { screen, shown } = yield* scripted(["down", "d"]);

        yield* atTerminal(
          client,
          screen
        )(runTodayTui({ project: Option.none() }));

        const states = yield* Ref.get(shown);
        const last = states.at(-1);

        expect(yield* Ref.get(decided)).toStrictEqual([
          { choice: "decline", decision: vouch.id, project: datekit },
        ]);
        expect(states.map(({ notice }) => notice)).toContainEqual([
          "Sending decline on datekit/dec-000003…",
        ]);
        expect([last?.notice, ids(last), last?.cursor]).toStrictEqual([
          ["Decided: decline on datekit/dec-000003"],
          [proposal.id, stray.id],
          1,
        ]);
      })
  );

  it.effect(
    "shows a refused choice in the renderer's words, and keeps Today as it was",
    () =>
      Effect.gen(function* () {
        const { client } = yield* platform(new Set([stray.id]));
        const { screen, shown } = yield* scripted(["r"]);

        yield* atTerminal(
          client,
          screen
        )(runTodayTui({ project: Option.none() }));

        const last = (yield* Ref.get(shown)).at(-1);

        expect([last?.notice, ids(last)]).toStrictEqual([
          explain([new DecisionClosed({ decision: stray.id })]),
          today.decisions.map(({ id }) => id),
        ]);
      })
  );
});

describe("the terminal Today is drawn on", () => {
  it.live("draws each state in place of the last, and reads keys by name", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* Effect.acquireRelease(
          Effect.promise(() => createTestRenderer({ height: 40, width: 120 })),
          ({ renderer }) =>
            Effect.sync(() => {
              renderer.destroy();
            })
        );

        const screen = yield* screenOn(setup.renderer);

        /** The terminal's rows once `state` is drawn. */
        const drawn = (state: TodayViewState) =>
          Effect.gen(function* () {
            yield* screen.show(state);
            yield* Effect.promise(() => setup.renderOnce());

            return setup.captureCharFrame().split("\n");
          });

        yield* drawn(start(today));
        const moved = yield* drawn(press(start(today), ["down"]).state);

        expect(rowsWith(moved, "Today for okonkwo")).toHaveLength(1);
        expect(rowsWith(moved, "> ").map((row) => row.trim())).toStrictEqual([
          ">   datekit/dec-000003  vouch for ada",
        ]);

        setup.mockInput.pressArrow("down");
        setup.mockInput.pressKey("d");
        setup.mockInput.pressKey("c", { ctrl: true });

        expect([
          yield* screen.key,
          yield* screen.key,
          yield* screen.key,
        ]).toStrictEqual(["down", "d", "ctrl+c"]);

        setup.mockInput.pressKey("a");
        yield* screen.forget;
        setup.mockInput.pressKey("q");

        expect(yield* screen.key).toBe("q");
      })
    )
  );
});

/** What was printed to a stream, one entry per line however it was written. */
const lines = (chunks: readonly unknown[]) =>
  chunks.flatMap((chunk) => String(chunk).split("\n"));

/**
 * `today` as the tree will hold it, run on `args` as the process would:
 * the mode from `env`, a terminal on both ends, and the platform `client`;
 * no screen opens. Returns what it printed on stdout and stderr, and how it
 * ended.
 */
const runToday = (
  args: readonly string[],
  input: {
    readonly client: Layer.Layer<Client>;
    readonly env: Readonly<Record<string, string>>;
  }
) => {
  const policy = policyFor({ env: input.env, isTTY: true });

  return Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Command.runWith(todayCommand, { version: "0.0.0" })(args)
    );

    return {
      err: lines(yield* TestConsole.errorLines),
      exit,
      out: lines(yield* TestConsole.logLines),
    };
  }).pipe(
    Effect.provideService(OpenScreen, Effect.die("no screen opens here")),
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        // Its own console: a layer built twice in one memo map is shared.
        Layer.fresh(TestConsole.layer),
        input.client,
        policy,
        OutputLive.pipe(Layer.provide(policy)),
        Stdio.layerTest({ stdinIsTerminal: Effect.succeed(true) })
      )
    )
  );
};

describe("the today command, with and without --tui", () => {
  it.effect(
    "refuses --tui under an agent with the same refusal, and calls nothing",
    () =>
      Effect.gen(function* () {
        const { exit } = yield* runToday(["--tui"], {
          client: Layer.mock(Client)({}),
          env: { CLAUDECODE: "1" },
        });

        const failure = Exit.findErrorOption(exit);

        expect(
          Option.map(failure, (failed) =>
            Schema.is(TuiRefused)(failed) ? failed.next : failed
          )
        ).toStrictEqual(Option.some(`${Brand.cli} today --json`));
      })
  );

  it.effect("refuses --tui with --json: one document is for a script", () =>
    Effect.gen(function* () {
      const { exit } = yield* runToday(["--tui", "--json"], {
        client: Layer.mock(Client)({}),
        env: {},
      });

      expect(
        Option.map(Exit.findErrorOption(exit), (failed) =>
          Schema.is(TuiRefused)(failed) ? failed.reason : failed
        )
      ).toStrictEqual(Option.some("--json asks for one document for a script"));
    })
  );

  it.effect("prints Today's own refusal once, before any screen opens", () =>
    Effect.gen(function* () {
      const handlers = Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("today", () => Effect.fail(new NotDecider()))
      );

      const client = Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
        Layer.provide([handlers, asTester])
      );

      const { err, exit } = yield* runToday(["--tui"], { client, env: {} });

      expect([
        err,
        Option.map(Exit.findErrorOption(exit), String),
      ]).toStrictEqual([explain([new NotDecider()]), Option.some("Reported")]);
    })
  );

  it.effect.each([{ flags: [] }, { flags: ["--json"] }])(
    "prints Today as the projected command does, given $flags",
    ({ flags }) =>
      Effect.gen(function* () {
        const { client } = yield* platform(new Set());

        const handlers = Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("today", () => Effect.succeed(today))
        );

        const projected = yield* runProgram(["today", ...flags], {
          env: {},
          handlers,
        });

        const ours = yield* runToday(flags, { client, env: {} });

        expect(ours.out).toStrictEqual(projected.out);
        expect(ours.out.join("\n")).toContain("okonkwo");
      })
  );
});
