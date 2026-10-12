#!/usr/bin/env node
// One file plays two roles, chosen by the name it was started by: the CLI, and git's credential helper.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Brand } from "@repo/brand";
import { Effect, Layer, Path, Stdio } from "effect";

import { CliServices, program } from "./main.ts";

const live = CliServices.pipe(Layer.provideMerge(BunServices.layer));

/** The compiled binary keeps its link's name in `argv0`; Node or Bun through an npm bin link keep it in `argv[1]`. */
const startedAs = Effect.map(Path.Path, (path) =>
  [process.argv0, process.argv[1]].map((name) => path.basename(name ?? ""))
);

const main = Effect.gen(function* () {
  const names = yield* startedAs;
  const args = yield* Effect.flatMap(Stdio.Stdio, (stdio) => stdio.args);

  return yield* program(
    names.includes(Brand.gitCredentialHelper) ? ["credential", ...args] : args
  );
});

BunRuntime.runMain(main.pipe(Effect.provide(live)));
