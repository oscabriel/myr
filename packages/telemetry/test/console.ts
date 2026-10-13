import type { Console } from "effect";
import { constVoid } from "effect/Function";

export type Method = "debug" | "error" | "info" | "log" | "trace" | "warn";

export interface Written {
  readonly method: Method;
  readonly line: unknown;
}

/** A console that keeps each line a leveled method writes, by its method. */
export const capturing = () => {
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

  return { console, written };
};
