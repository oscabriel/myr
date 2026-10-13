// A console in memory, for the logger to write to in a test: each line kept
// as the logger handed it over, by the method it was written through.
import { Console, Layer } from "effect";
import { constVoid } from "effect/Function";

export type Method = "debug" | "error" | "info" | "log" | "trace" | "warn";

export interface Written {
  readonly method: Method;
  readonly line: unknown;
}

export interface RecordingConsole {
  readonly layer: Layer.Layer<never>;
  readonly written: () => readonly Written[];
  /** What reached `console.error`, where Issues hears it. */
  readonly errors: () => readonly Written["line"][];
}

export const recordingConsole = (): RecordingConsole => {
  const written: Written[] = [];

  const write =
    (method: Method) =>
    (...lines: readonly Written["line"][]) => {
      written.push(...lines.map((line) => ({ line, method })));
    };

  const console: Console.Console = {
    assert: constVoid,
    clear: constVoid,
    count: constVoid,
    countReset: constVoid,
    debug: write("debug"),
    dir: constVoid,
    dirxml: constVoid,
    error: write("error"),
    group: constVoid,
    groupCollapsed: constVoid,
    groupEnd: constVoid,
    info: write("info"),
    log: write("log"),
    table: constVoid,
    time: constVoid,
    timeEnd: constVoid,
    timeLog: constVoid,
    trace: write("trace"),
    warn: write("warn"),
  };

  return {
    errors: () =>
      written.flatMap(({ line, method }) => (method === "error" ? [line] : [])),
    layer: Layer.succeed(Console.Console, console),
    written: () => [...written],
  };
};
