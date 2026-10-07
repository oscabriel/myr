/**
 * The one way every command prints. A command hands its result, its
 * refusals or its plan to `Output`, which decides the form: text for a
 * person, Markdown for an agent or a script, one `--json` envelope when asked
 * for. Notes go to stderr only, so `--json` stdout is always exactly one
 * document.
 */
import type { View } from "@repo/protocol/cli";
import { Envelope } from "@repo/protocol/envelope";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Console, Context, Effect, Layer, Schema } from "effect";
import type { Array } from "effect";

import { Policy } from "./policy.ts";
import type { Mode } from "./policy.ts";

export { Reported } from "@repo/protocol/cli";

export type { View } from "@repo/protocol/cli";

export type { Mode } from "./policy.ts";

export class Output extends Context.Service<
  Output,
  {
    readonly mode: Mode;
    /** A command's result; `data` is its encoded success. */
    readonly success: (input: {
      readonly command: string;
      readonly json: boolean;
      readonly data: unknown;
      readonly view: View;
    }) => Effect.Effect<void>;
    /** The refusals a command met instead: printed here, and only here. */
    readonly refused: (input: {
      readonly command: string;
      readonly json: boolean;
      readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
    }) => Effect.Effect<void>;
    /** What `--dry-run` would send; `payload` is encoded. */
    readonly plan: (input: {
      readonly command: string;
      readonly json: boolean;
      readonly payload: unknown;
    }) => Effect.Effect<void>;
    /** A line for whoever watches stderr; never part of `--json` output. */
    readonly note: (text: string) => Effect.Effect<void>;
  }
>()("cli/Output") {}

/** Any envelope's JSON: its data is already encoded. */
const encodeEnvelope = Schema.encodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/** One envelope, as the one document on stdout. */
const printEnvelope = (envelope: Envelope<unknown>) =>
  encodeEnvelope(envelope).pipe(Effect.orDie, Effect.flatMap(Console.log));

const capitalized = (word: string) =>
  `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;

/**
 * `explain`'s lines as a Markdown list: one item per refusal, its pointer,
 * next command and `Retryable: yes|no` beneath it. The renderer stays the
 * one source of the words; only the layout changes.
 */
const asMarkdownList = (lines: readonly string[]) =>
  lines.map((line) => {
    const detail = /^ {2}(?<key>[a-z]+): (?<value>.*)$/u.exec(line)?.groups;

    if (detail?.key === undefined || detail.value === undefined) {
      return `- ${line}`;
    }

    const value = detail.key === "next" ? `\`${detail.value}\`` : detail.value;

    return `  - ${capitalized(detail.key)}: ${value}`;
  });

/** The JSON a plan sends, as a person reads it or as a Markdown block. */
const planText = (mode: Mode, command: string, json: string) =>
  mode === "human"
    ? `${command} would send this, and sent nothing:\n${json}`
    : [
        `\`${command}\` would send this, and sent nothing (--dry-run):`,
        "",
        "```json",
        json,
        "```",
      ].join("\n");

/**
 * Output for `mode`: a person reads `view.text` (or the Markdown when a view
 * has no text) and refusals as `explain`'s lines; an agent or a script
 * reads Markdown, with refusals as a Markdown list. Under `--json` stdout
 * holds one `Envelope` and nothing else, refusals included.
 */
const outputFor = (mode: Mode): Output["Service"] => ({
  mode,
  note: (text) => Console.error(text),
  plan: ({ command, json, payload }) =>
    json
      ? printEnvelope({
          command,
          data: { dryRun: true, payload },
          ok: true,
          v: 1,
        })
      : Console.log(planText(mode, command, JSON.stringify(payload, null, 2))),
  refused: ({ command, json, refusals }) => {
    if (json) {
      return printEnvelope({ command, ok: false, refusals, v: 1 });
    }

    const lines = explain(refusals);

    return Console.error(
      (mode === "human" ? lines : asMarkdownList(lines)).join("\n")
    );
  },
  success: ({ command, data, json, view }) => {
    if (json) {
      return printEnvelope({ command, data, ok: true, v: 1 });
    }

    return Console.log(
      mode === "human" ? (view.text ?? view.markdown) : view.markdown
    );
  },
});

/** Output for a person, whatever the process: what tests of a command's text use. */
export const OutputPlain = Layer.succeed(Output)(outputFor("human"));

/** Output in the form the invocation policy chose for this process. */
export const OutputLive: Layer.Layer<Output, never, Policy> = Layer.effect(
  Output
)(Effect.map(Effect.service(Policy), ({ mode }) => outputFor(mode)));

/**
 * Stdout held back until a command's handler runs. effect/cli prints help on
 * stdout for a misuse too: held, that help is dropped after a misuse (whose
 * one line goes to stderr), and printed when the run ends any other way
 * (help asked for, the version, a group run bare).
 */
export const holdStdout = (real: Console.Console) => {
  const held: (readonly unknown[])[] = [];
  let open = false;

  // Each method hands its call to the real console; only `log` waits.
  const console: Console.Console = {
    assert: (condition, ...args: readonly unknown[]) => {
      real.assert(condition, ...args);
    },
    clear: () => {
      real.clear();
    },
    count: (label) => {
      real.count(label);
    },
    countReset: (label) => {
      real.countReset(label);
    },
    debug: (...args: readonly unknown[]) => {
      real.debug(...args);
    },
    dir: (item, options) => {
      real.dir(item, options);
    },
    dirxml: (...args: readonly unknown[]) => {
      real.dirxml(...args);
    },
    error: (...args: readonly unknown[]) => {
      real.error(...args);
    },
    group: (...args: readonly unknown[]) => {
      real.group(...args);
    },
    groupCollapsed: (...args: readonly unknown[]) => {
      real.groupCollapsed(...args);
    },
    groupEnd: () => {
      real.groupEnd();
    },
    info: (...args: readonly unknown[]) => {
      real.info(...args);
    },
    log: (...args: readonly unknown[]) => {
      if (open) {
        real.log(...args);
      } else {
        held.push(args);
      }
    },
    table: (data, properties) => {
      real.table(data, properties);
    },
    time: (label) => {
      real.time(label);
    },
    timeEnd: (label) => {
      real.timeEnd(label);
    },
    timeLog: (label, ...args: readonly unknown[]) => {
      real.timeLog(label, ...args);
    },
    trace: (...args: readonly unknown[]) => {
      real.trace(...args);
    },
    warn: (...args: readonly unknown[]) => {
      real.warn(...args);
    },
  };

  return {
    console,
    open: Effect.sync(() => {
      open = true;
    }),
    release: Effect.sync(() => {
      for (const args of held.splice(0)) {
        real.log(...args);
      }
    }),
  };
};
