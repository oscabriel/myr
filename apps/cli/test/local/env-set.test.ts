import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { SetEnv } from "@repo/protocol/contracts";
import { Envelope } from "@repo/protocol/envelope";
import { EnvKey, Handle } from "@repo/protocol/ids";
import { NotSensitive, ValueTooShort } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import {
  Cause,
  DateTime,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Queue,
  Redacted,
  Ref,
  References,
  Runtime,
  Schema,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { CliOutput } from "effect/cli";
import { RpcTest } from "effect/rpc";
import type { Rpc } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { refuseStrangeFlags } from "../../src/local/env-set.ts";
import { program } from "../../src/main.ts";
import { Output, OutputPlain } from "../../src/output.ts";
import type { Mode } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";

/** A value no output, note or log line may ever hold. */
const secret = "sk_live_0123456789abcdef";

const key = EnvKey.make("SENTRY_AUTH_TOKEN");

const setAt = DateTime.makeUnsafe("2026-10-07T09:00:00Z");

/** A person piping the value in, as `printf '…\n' |` does. */
const piped = Stream.make(new TextEncoder().encode(`${secret}\n`));

type Payload = Rpc.Payload<typeof SetEnv>;

/** What the platform answers `setEnv` with. */
type Answer = Effect.Effect<
  Rpc.Success<typeof SetEnv>,
  NotSensitive | ValueTooShort
>;

const stored: Answer = Effect.succeed({
  key,
  setAt,
  setBy: Handle.make("alice"),
});

/** One call through `Output`, as the command made it. */
interface Printed {
  readonly method: "success" | "refused" | "plan" | "note";
  /** The call's input: a note's text, or the others' object. */
  readonly input: object | string;
}

/**
 * How one run went: its exit code, what reached stdout, stderr and the
 * logger, what the platform was asked, and what the command handed `Output`.
 */
interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly logged: string;
  readonly calls: readonly Payload[];
  readonly printed: readonly Printed[];
  readonly shown: string;
}

interface Setup {
  /** Who reads: 401's person at a terminal, or 404's agent policy. */
  readonly mode?: Mode;
  readonly stdin?: Stream.Stream<Uint8Array>;
  readonly stdinIsTerminal?: boolean;
  /** What a person types at the hidden prompt, key by key. */
  readonly typed?: string;
  readonly answer?: Answer;
}

/** How the process would exit, by the runtime's own rule. */
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

const press = (name: string, input: Option.Option<string>) => ({
  input,
  key: { ctrl: false, meta: false, name, shift: false },
});

/**
 * Runs `<cli> env set …` with `setup`'s stdin, terminal and platform, and
 * returns everything it printed, logged and asked.
 */
const run = (args: readonly string[], setup: Setup = {}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<readonly Payload[]>([]);
    const printed = yield* Ref.make<readonly Printed[]>([]);
    const shown = yield* Ref.make<readonly string[]>([]);
    const logged: string[] = [];

    const record = (method: Printed["method"], input: Printed["input"]) =>
      Ref.update(printed, (all) => [...all, { input, method }]);

    // 401's plain output, recorded, as whichever reader `setup` names.
    const output = Layer.effect(
      Output,
      Effect.gen(function* () {
        const plain = yield* Effect.service(Output);

        return {
          mode: setup.mode ?? "human",
          note: (text) =>
            Effect.andThen(record("note", text), plain.note(text)),
          plan: (input) =>
            Effect.andThen(record("plan", input), plain.plan(input)),
          refused: (input) =>
            Effect.andThen(record("refused", input), plain.refused(input)),
          success: (input) =>
            Effect.andThen(record("success", input), plain.success(input)),
        } satisfies Output["Service"];
      })
    ).pipe(Layer.provide(OutputPlain));

    const terminal = Layer.succeed(Terminal.Terminal)(
      Terminal.make({
        columns: Effect.succeed(80),
        display: (text) => Ref.update(shown, (all) => [...all, text]),
        readInput: Effect.gen(function* () {
          if (setup.typed === undefined) {
            return yield* Effect.die("prompted, where no prompt may run");
          }

          const keys = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();

          yield* Queue.offerAll(keys, [
            ...setup.typed
              .split("")
              .map((char) => press(char, Option.some(char))),
            press("enter", Option.none()),
          ]);

          return keys;
        }),
        readLine: Effect.die("readLine is never used"),
        rows: Effect.succeed(24),
      })
    );

    // The platform in process: `setEnv` records what it got and answers.
    const platform = Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("setEnv", (payload) =>
            Ref.update(calls, (all) => [...all, payload]).pipe(
              Effect.andThen(setup.answer ?? stored)
            )
          )
        ),
        asTester,
      ])
    );

    const exit = yield* Effect.exit(
      program(["env", "set", ...args]).pipe(
        Effect.provide(
          Layer.mergeAll(
            CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
            platform,
            output,
            SignedOut,
            terminal,
            Logger.layer([
              Logger.make((options) => {
                logged.push(Logger.formatSimple.log(options));
              }),
            ]),
            Stdio.layerTest({
              stdin: setup.stdin ?? piped,
              stdinIsTerminal: Effect.succeed(setup.stdinIsTerminal ?? false),
            })
          )
        ),
        Effect.provideService(References.MinimumLogLevel, "All")
      )
    );

    return {
      calls: yield* Ref.get(calls),
      code: exitCodeOf(exit),
      err: (yield* TestConsole.errorLines).map(String).join("\n"),
      logged: logged.join("\n"),
      out: (yield* TestConsole.logLines).map(String).join("\n"),
      printed: yield* Ref.get(printed),
      shown: (yield* Ref.get(shown)).join(""),
    } satisfies Ran;
  }).pipe(Effect.provide(TestConsole.layer));

/** Asserts the value reached no output, note, log line or terminal frame. */
const neverShown = (ran: Ran) => {
  for (const seen of [
    ran.out,
    ran.err,
    ran.logged,
    ran.shown,
    JSON.stringify(ran.printed),
  ]) {
    expect(seen).not.toContain(secret);
    expect(seen).not.toContain("0123456789abcdef");
  }
};

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/** The one call the platform got, with its value opened for the check. */
const onlyCall = (ran: Ran) => {
  expect(ran.calls).toHaveLength(1);

  const [call] = ran.calls;

  expect(call).toBeDefined();
  expect(Redacted.isRedacted(call?.value)).toBeTruthy();

  return {
    ...call,
    value: call === undefined ? undefined : Redacted.value(call.value),
  };
};

const always = ["--project", "datekit"];

describe(`${Brand.cli} env set`, () => {
  it.live(
    "sends the piped value, less one newline, as a Redacted, and prints only who set which key and when",
    () =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--yes", "--json"]);

        expect(ran.code).toBe(0);
        expect(onlyCall(ran)).toStrictEqual({
          key: "SENTRY_AUTH_TOKEN",
          project: "datekit",
          value: secret,
        });
        expect(ran.err).toBe("");
        expect(yield* decodeEnvelope(ran.out)).toStrictEqual({
          command: "env set",
          data: {
            key: "SENTRY_AUTH_TOKEN",
            setAt: "2026-10-07T09:00:00.000Z",
            setBy: "alice",
          },
          ok: true,
          v: 1,
        });
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "refuses a value given as an argument, as a usage error that does not echo it",
    () =>
      Effect.gen(function* () {
        const ran = yield* run([key, secret, ...always, "--yes"]);

        expect(ran.code).toBe(2);
        expect(ran.calls).toStrictEqual([]);
        expect(ran.err).toContain("stdin");
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live.each([
    {
      typed: `-${secret}`,
      why: "a value that starts with a dash, holding a v that would read as --version",
    },
    {
      typed: "-Zq8_w0rd5ecret",
      why: "a value effect/cli would read as short flags and print back letter by letter",
    },
    { typed: `--${secret}`, why: "a value that reads as a long flag" },
    { typed: `--token=${secret}`, why: "a value given to a flag it lacks" },
  ])(
    "refuses $why as a usage error, in one line that repeats none of it",
    ({ typed }) =>
      Effect.gen(function* () {
        const ran = yield* run([key, typed, ...always, "--yes"]);

        expect(ran.code).toBe(2);
        expect(ran.calls).toStrictEqual([]);
        expect(ran.out).toBe("");
        expect(ran.err.split("\n")).toStrictEqual([
          expect.stringContaining("stdin"),
        ]);
        expect(ran.err).not.toContain(typed.slice(1, 4));
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live.each([
    { args: [key, "--project=datekit", "--yes"], shows: "set by alice" },
    {
      args: [key, ...always, "--yes", "--log-level", "debug"],
      shows: "set by alice",
    },
    { args: [key, "-h"], shows: "--acknowledge-short" },
    { args: [key, "--no-json", ...always, "--yes"], shows: "set by alice" },
  ])("still takes its own flags and effect/cli's: $args", ({ args, shows }) =>
    Effect.gen(function* () {
      const ran = yield* run(args);

      expect(ran.code).toBe(0);
      expect(ran.out).toContain(shows);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("screens out no flag that `env set --help` names", () =>
    Effect.gen(function* () {
      const help = yield* run(["--help"]);

      const named = help.out.split("\n").flatMap((line) => {
        const flags = /^\s+(?<flags>-[^\s,]+(?:, -[^\s,]+)*)/u.exec(line)
          ?.groups?.flags;

        return flags === undefined ? [] : flags.split(", ");
      });

      expect(named).toStrictEqual(
        expect.arrayContaining(["--yes", "--project", "--help", "-h"])
      );

      const screened = yield* Effect.filter(named, (flag) =>
        Effect.map(
          Effect.exit(refuseStrangeFlags(["env", "set", key, flag])),
          Exit.isFailure
        )
      );

      expect(screened).toStrictEqual([]);
    }).pipe(
      Effect.provide([NodeServices.layer, OutputPlain, TestConsole.layer])
    )
  );

  it.live.each([
    { kept: `${secret}\n`, sent: `${secret}\n\n`, why: "only one newline" },
    { kept: secret, sent: `${secret}\r\n`, why: "a CRLF as one newline" },
    { kept: secret, sent: secret, why: "nothing from a value with no newline" },
  ])("strips $why from the piped value", ({ kept, sent }) =>
    Effect.gen(function* () {
      const ran = yield* run([key, ...always, "--yes"], {
        stdin: Stream.make(new TextEncoder().encode(sent)),
      });

      expect(ran.code).toBe(0);
      expect(onlyCall(ran).value).toBe(kept);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live.each([
    { sent: "", why: "nothing piped" },
    { sent: "\n", why: "an empty line piped" },
  ])(
    "with $why, exits 2 telling how to pipe the value, and calls nothing",
    ({ sent }) =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--yes"], {
          stdin: Stream.make(new TextEncoder().encode(sent)),
        });

        expect(ran.code).toBe(2);
        expect(ran.calls).toStrictEqual([]);
        expect(ran.err).toContain(`| ${Brand.cli} env set ${key}`);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("without --yes, exits 2 naming it and calls nothing", () =>
    Effect.gen(function* () {
      const ran = yield* run([key, ...always]);

      expect(ran.code).toBe(2);
      expect(ran.calls).toStrictEqual([]);
      expect(ran.err).toContain("--yes");
      neverShown(ran);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "with --dry-run, hands over the payload it would send with the value redacted, and calls nothing",
    () =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--dry-run", "--json"]);

        expect(ran.code).toBe(0);
        expect(ran.calls).toStrictEqual([]);
        expect(ran.printed).toStrictEqual([
          {
            input: {
              command: "env set",
              json: true,
              payload: {
                key: "SENTRY_AUTH_TOKEN",
                project: "datekit",
                value: "<redacted>",
              },
            },
            method: "plan",
          },
        ]);
        expect(yield* decodeEnvelope(ran.out)).toStrictEqual({
          command: "env set",
          data: {
            dryRun: true,
            payload: {
              key: "SENTRY_AUTH_TOKEN",
              project: "datekit",
              value: "<redacted>",
            },
          },
          ok: true,
          v: 1,
        });
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live.each([
    { refusal: new NotSensitive({ key }) },
    { refusal: ValueTooShort.of(key, 12) },
  ])(
    "prints $refusal._tag from the platform once, and exits 1",
    ({ refusal }: { readonly refusal: NotSensitive | ValueTooShort }) =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--yes"], {
          answer: Effect.fail(refusal),
        });

        expect(ran.code).toBe(1);
        expect(ran.out).toBe("");
        expect(ran.err).toBe(explain([refusal]).join("\n"));
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("with --acknowledge-short, asks to store a short value anyway", () =>
    Effect.gen(function* () {
      const ran = yield* run([key, ...always, "--yes", "--acknowledge-short"]);

      expect(ran.code).toBe(0);
      expect(onlyCall(ran)).toStrictEqual({
        acknowledgeShort: true,
        key: "SENTRY_AUTH_TOKEN",
        project: "datekit",
        value: secret,
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "under an agent with a terminal on stdin, never prompts: it tells the person to pipe the value",
    () =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--yes"], {
          mode: "agent",
          stdinIsTerminal: true,
        });

        expect(ran.code).toBe(2);
        expect(ran.calls).toStrictEqual([]);
        expect(ran.err).toContain("pipe");
        expect(ran.shown).toBe("");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "asks a person at a terminal with a prompt that shows nothing typed, not even its length",
    () =>
      Effect.gen(function* () {
        const ran = yield* run([key, ...always, "--yes"], {
          stdin: Stream.empty,
          stdinIsTerminal: true,
          typed: secret,
        });

        expect(ran.code).toBe(0);
        expect(onlyCall(ran)).toStrictEqual({
          key: "SENTRY_AUTH_TOKEN",
          project: "datekit",
          value: secret,
        });
        expect(ran.shown).toContain(key);
        expect(ran.shown).not.toContain("*");
        neverShown(ran);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
