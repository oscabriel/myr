import { describe, expect, it } from "@effect/vitest";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { Box, BoxFailed } from "../src/box.ts";
import { SdkBox } from "../src/box/sdk.ts";

/** `text` as the Container API hands output back: a plain `ArrayBuffer`. */
const bytes = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.length);

  new Uint8Array(buffer).set(encoded);

  return buffer;
};

/**
 * A Durable Object's container as the Container API shows it: it records
 * what starts it and each command it runs, and every command prints
 * `git version 2.47.3`.
 */
const fakeContainer = (running: boolean) => {
  const started: ContainerStartupOptions[] = [];
  const commands: { argv: string[]; options: ContainerExecOptions }[] = [];

  const container = untouchable<Container>("container", {
    exec: (argv, options = {}) => {
      commands.push({ argv, options });

      return Promise.resolve(
        untouchable<ExecProcess>("process", {
          output: () =>
            Promise.resolve({
              exitCode: 0,
              stderr: bytes(""),
              stdout: bytes("git version 2.47.3\n"),
            }),
        })
      );
    },
    running,
    start: (options) => {
      if (options !== undefined) {
        started.push(options);
      }
    },
  });

  return { commands, container, started };
};

const start = { enableInternet: false, image: "check" };

/** A running container whose one command never ends until it is killed. */
const hungContainer = () => {
  const killed: (number | undefined)[] = [];

  const container = untouchable<Container>("container", {
    exec: () =>
      Promise.resolve(
        untouchable<ExecProcess>("process", {
          kill: (signal) => {
            killed.push(signal);
          },
          // A race of nothing never settles: the command runs until it is killed.
          output: () => Promise.race<ExecOutput>([]),
        })
      ),
    running: true,
  });

  return { container, killed };
};

describe("Box over the Sandbox SDK", () => {
  it.effect(
    "runs a command in the container and reads its output as text",
    () =>
      Effect.gen(function* () {
        const fake = fakeContainer(true);

        const executed = yield* Box.use(({ exec }) =>
          exec(["git", "--version"], { cwd: "/workspace", env: { HOME: "/" } })
        ).pipe(Effect.provide(SdkBox.layer(fake.container, start)));

        expect(executed).toStrictEqual({
          exitCode: 0,
          stderr: "",
          stdout: "git version 2.47.3\n",
        });
        expect(
          fake.commands.map(({ argv, options }) => ({
            argv,
            cwd: options.cwd,
            env: options.env,
          }))
        ).toStrictEqual([
          { argv: ["git", "--version"], cwd: "/workspace", env: { HOME: "/" } },
        ]);
        expect(fake.started).toStrictEqual([]);
      })
  );

  it.effect(
    "starts a stopped container with its image, offline, before the first command",
    () =>
      Effect.gen(function* () {
        const fake = fakeContainer(false);

        yield* Box.use(({ exec }) => exec(["true"])).pipe(
          Effect.provide(SdkBox.layer(fake.container, start))
        );

        expect(fake.started).toStrictEqual([
          { enableInternet: false, image: "check" },
        ]);
      })
  );

  it.effect(
    "kills a command that runs past its time limit, so it stops beside the lanes after it",
    () =>
      Effect.gen(function* () {
        const hung = hungContainer();

        const running = yield* Box.use(({ exec }) =>
          exec(["bun", "test"], { timeoutMs: 1000 })
        ).pipe(
          Effect.provide(SdkBox.layer(hung.container, start)),
          Effect.flip,
          Effect.forkChild
        );

        yield* TestClock.adjust("2 seconds");

        expect({
          failed: yield* Fiber.join(running),
          killed: hung.killed.length,
        }).toStrictEqual({
          failed: new BoxFailed({
            operation: "exec",
            reason: "timed out after 1000 ms",
          }),
          killed: 1,
        });
      })
  );
});
