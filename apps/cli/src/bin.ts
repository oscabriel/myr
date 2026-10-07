#!/usr/bin/env node
/**
 * The CLI's process entry: `program` over the arguments the process was
 * started with, on Bun's services and `CliServices` (the credentials file,
 * the invocation policy, output in its form and the remote client).
 * Tests never import this file; they run `program` with their own services,
 * and `test/build.test.ts` runs what `build.ts` makes of it. One file plays
 * two roles, chosen by the name it was started by: the CLI, and git's
 * credential helper.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Brand } from "@repo/brand";
import { Effect, Layer, Path, Stdio } from "effect";

import { CliServices, program } from "./main.ts";

const live = CliServices.pipe(Layer.provideMerge(BunServices.layer));

/**
 * The names this process may have been started by. The compiled binary
 * keeps the name of the link it was run through in `argv0` (its `argv[1]`
 * is its own bundled path); Node or Bun running `dist/bin.js` through an
 * npm bin link keeps the link's path in `argv[1]` (their `argv0` is the
 * runtime's).
 */
const startedAs = Effect.map(Path.Path, (path) =>
  [process.argv0, process.argv[1]].map((name) => path.basename(name ?? ""))
);

/**
 * Run as `git-credential-<slug>`, the process is `<cli> credential` with
 * git's arguments (`get`, `store` or `erase`); run by any other name, it is
 * the CLI.
 */
const main = Effect.gen(function* () {
  const names = yield* startedAs;
  const args = yield* Effect.flatMap(Stdio.Stdio, (stdio) => stdio.args);

  return yield* program(
    names.includes(Brand.gitCredentialHelper) ? ["credential", ...args] : args
  );
});

BunRuntime.runMain(main.pipe(Effect.provide(live)));
