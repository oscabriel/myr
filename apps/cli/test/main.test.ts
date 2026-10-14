import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { Effect, FileSystem, Layer } from "effect";
import { CliOutput, Command } from "effect/cli";
import { TestConsole } from "effect/testing";

import { Credentials } from "../src/credentials.ts";
import { program, root } from "../src/main.ts";
import { OutputPlain } from "../src/output.ts";
import { WorkingDirectory } from "../src/surfaces.ts";
import { SignedOut } from "./signed-out.ts";

const printed = Effect.map(TestConsole.logLines, (all) =>
  all.flatMap((chunk) => String(chunk).split("\n"))
);

const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  Layer.mock(Client)({}),
  Layer.mock(Credentials)({}),
  OutputPlain
).pipe(Layer.provideMerge(NodeServices.layer));

const help = Effect.gen(function* () {
  yield* Command.runWith(root, { version: "0.0.0" })(["--help"]);

  return yield* printed;
}).pipe(Effect.provide(services));

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

describe(`${Brand.cli} asks outside a clone`, () => {
  it.live(
    "says which flag it needs, and that front lists every project's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* Effect.exit(program(["asks"])).pipe(
          Effect.provideService(WorkingDirectory, dir)
        );

        const said = (yield* TestConsole.errorLines).map(String).join("\n");

        expect(said).toContain("asks needs --project");
        expect(said).toContain(`${Brand.cli} front lists every project's`);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            TestConsole.layer,
            CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
            Layer.mock(Client)({}),
            SignedOut,
            OutputPlain
          ).pipe(Layer.provideMerge(NodeServices.layer))
        )
      )
  );
});

describe(`${Brand.cli} --help`, () => {
  it.effect("opens with the start-here banner, before the command list", () =>
    Effect.gen(function* () {
      const lines = yield* help;

      expect(section(lines, "DESCRIPTION")).toStrictEqual([
        "Start here:",
        `${Brand.cli} front     list the open asks across every project`,
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
