/**
 * The one way every command prints. A command hands its result, its
 * refusals or its plan to `Output`, which decides the form: text for a
 * person, Markdown for an agent, one `--json` envelope for a script. Notes
 * go to stderr only, so `--json` stdout is always exactly one document.
 */
import { Envelope } from "@repo/protocol/envelope";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Console, Context, Effect, Layer, Runtime, Schema } from "effect";
import type { Array } from "effect";

/** Who is reading: a person at a terminal, an agent, or a script. */
export type Mode = "human" | "agent" | "automation";

/** A result as prose: Markdown, and plain text where a person reads it. */
export interface View {
  readonly markdown: string;
  readonly text?: string;
}

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

/**
 * Everything a command printed has been printed: the program exits 1 and
 * prints nothing more, and the runtime reports nothing of its own.
 */
export class Reported extends Schema.TaggedError<Reported>()("Reported", {}) {
  override readonly [Runtime.errorExitCode] = 1;
  override readonly [Runtime.errorReported] = false;
}

/** Any envelope's JSON: its data is already encoded. */
const encodeEnvelope = Schema.encodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/** One envelope, as the one document on stdout. */
const printEnvelope = (envelope: Envelope<unknown>) =>
  encodeEnvelope(envelope).pipe(Effect.orDie, Effect.flatMap(Console.log));

/**
 * Plain output, for a person: text on stdout, refusals on stderr, and
 * `--json` as one `Envelope` (`@repo/protocol/envelope`) on stdout and
 * nothing else there. Issue 404's agent policy chooses Markdown for agents
 * behind the same service.
 */
export const OutputPlain = Layer.succeed(Output)({
  mode: "human",
  note: (text) => Console.error(text),
  plan: ({ command, json, payload }) =>
    json
      ? printEnvelope({ command, data: { dryRun: payload }, ok: true, v: 1 })
      : Console.log(
          `${command} would send:\n${JSON.stringify(payload, null, 2)}`
        ),
  refused: ({ command, json, refusals }) =>
    json
      ? printEnvelope({ command, ok: false, refusals, v: 1 })
      : Console.error(explain(refusals).join("\n")),
  success: ({ command, data, json, view }) =>
    json
      ? printEnvelope({ command, data, ok: true, v: 1 })
      : Console.log(view.text ?? view.markdown),
});
