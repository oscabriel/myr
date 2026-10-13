import { describe, expect, it } from "@effect/vitest";
import { jsonLogger, scrubberOf } from "@repo/telemetry/logger";
import { recordingConsole } from "@repo/telemetry/logger/memory";
import { Effect, Layer, Logger } from "effect";

import { CheckLogs } from "../src/checker/logs.ts";
import { WorkerCheckLogs } from "../src/checker/logs/worker.ts";

// A red-then-green lane's first run, as bun prints a failing test.
const RED = [
  "$ sh -c bun test test/parse-year.test.ts",
  "error: expect(received).toBe(expected)",
  "      at <anonymous> (/workspace/repo/test/parse-year.test.ts:4:22)",
  "(fail) parse reads the year of an ISO date",
].join("\n");

describe("a check's phase logs on a Worker", () => {
  it.effect(
    "name each phase and its size, and never its text, since Issues reads a printed stack trace as an error",
    () =>
      Effect.gen(function* () {
        const console = recordingConsole();

        yield* CheckLogs.use(({ report }) =>
          report([
            { name: "clone", phase: "clone", text: "" },
            { name: "redThenGreen", phase: "lane", text: `${RED}\n` },
          ])
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              WorkerCheckLogs.layer,
              Logger.layer([jsonLogger(scrubberOf([]))]),
              console.layer
            )
          )
        );

        const written = console.written();

        expect(written).toMatchObject([
          {
            line: { bytes: 0, level: "info", lines: 0, log: "clone" },
            method: "info",
          },
          {
            line: {
              bytes: RED.length + 1,
              level: "info",
              lines: 4,
              log: "redThenGreen",
              phase: "lane",
            },
            method: "info",
          },
        ]);
        expect(JSON.stringify(written)).not.toMatch(
          /at <anonymous>|parse-year/u
        );
      })
  );
});
