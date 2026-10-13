// What a check's phases printed reaches Workers Logs by its size alone. Issues
// reads any line that holds a stack trace as an error, and an answer's failing
// test prints one, as a red-then-green lane's first run does by design: its
// text would make every such answer an Issue. A failed lane's output is the
// answer's evidence, which the project keeps in R2.
import { Effect, Layer } from "effect";

import { CheckLogs } from "../logs.ts";

const linesIn = (text: string) =>
  text === "" ? 0 : text.split("\n").filter((line) => line !== "").length;

export const WorkerCheckLogs = {
  layer: Layer.succeed(
    CheckLogs,
    CheckLogs.of({
      report: (logs) =>
        Effect.forEach(
          logs,
          ({ name, phase, text }) =>
            Effect.logInfo("a check's phase printed").pipe(
              Effect.annotateLogs({
                bytes: new TextEncoder().encode(text).byteLength,
                lines: linesIn(text),
                log: name,
                phase,
              })
            ),
          { discard: true }
        ),
    })
  ),
};
