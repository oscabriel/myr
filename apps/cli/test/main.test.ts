import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { Cause, Effect, Exit, Layer } from "effect";
import { CliOutput, Command } from "effect/cli";
import { TestConsole } from "effect/testing";

import { Credentials } from "../src/credentials.ts";
import { program, root } from "../src/main.ts";
import { OutputPlain } from "../src/output.ts";

/** What was printed to stdout, one entry per line however it was written. */
const printed = Effect.map(TestConsole.logLines, (all) =>
  all.flatMap((chunk) => String(chunk).split("\n"))
);

/**
 * What the CLI runs with in these tests: a test console, plain output, and
 * a client and credentials no command here calls.
 */
const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  Layer.mock(Client)({}),
  Layer.mock(Credentials)({}),
  OutputPlain
).pipe(Layer.provideMerge(NodeServices.layer));

/** The help `root` prints for `--help`, line by line. */
const help = Effect.gen(function* () {
  yield* Command.runWith(root, { version: "0.0.0" })(["--help"]);

  return yield* printed;
}).pipe(Effect.provide(services));

/** The lines of `lines` between the heading `from` and the next heading. */
const section = (lines: readonly string[], from: string) => {
  const start = lines.indexOf(from) + 1;

  const end = lines.findIndex(
    (line, at) => at >= start && /^[A-Z][A-Z ]+$/u.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).flatMap((line) => {
    const trimmed = line.trim();

    return trimmed.length > 0 ? [trimmed] : [];
  });
};

describe(`${Brand.cli} --help`, () => {
  it.effect("opens with the start-here banner, before the command list", () =>
    Effect.gen(function* () {
      const lines = yield* help;

      expect(section(lines, "DESCRIPTION")).toStrictEqual([
        "Start here:",
        `${Brand.cli} asks      list the open asks you could take`,
        `${Brand.cli} claim     take one; you get a fork to push your answer to`,
        `${Brand.cli} check     run the gate's checks locally before you push`,
      ]);
      expect(lines.indexOf("DESCRIPTION")).toBeLessThan(
        lines.indexOf("SUBCOMMANDS")
      );
    })
  );

  it.effect(
    "lists the commands that read asks, take one, and every local command",
    () =>
      Effect.gen(function* () {
        const listed = section(yield* help, "SUBCOMMANDS").map(
          (line) => line.split(" ")[0]
        );

        expect(listed).toStrictEqual(
          expect.arrayContaining([
            "asks",
            "claim",
            "login",
            "logout",
            "init",
            "check",
            "why",
            "env",
            "hook",
            "credential",
            "mcp",
          ])
        );
      })
  );
});

describe("each command a later issue builds", () => {
  const stubs = [
    { args: ["init"], issue: "413" },
    { args: ["why"], issue: "414" },
    { args: ["env", "set"], issue: "414" },
    { args: ["hook"], issue: "415" },
  ] as const;

  it.effect.each(stubs)(
    "$args dies naming issue $issue, so a missed stub is loud",
    ({ args, issue }) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(program(args));

        const defect = Exit.match(exit, {
          onFailure: (cause) =>
            Cause.hasDies(cause) ? String(Cause.squash(cause)) : "no defect",
          onSuccess: () => "succeeded",
        });

        expect(defect).toBe(`not built: issue ${issue}`);
      }).pipe(Effect.provide(services))
  );
});
