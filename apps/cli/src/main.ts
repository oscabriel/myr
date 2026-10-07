/**
 * The CLI's command tree and the program that runs it. `bin.ts` runs
 * `program` with the real services; tests run it, or `root`, with theirs.
 */
import { Brand } from "@repo/brand";
import { toCommand } from "@repo/protocol/cli";
import { Claim, Cli, Client, ListAsks } from "@repo/protocol/contracts";
import { Refusal } from "@repo/protocol/refusal";
import { Context, Effect, Schema } from "effect";
import { CliError, Command } from "effect/cli";

import { credential } from "./credential-helper.ts";
import { hook } from "./hook.ts";
import { local } from "./local/index.ts";
import { Output, Reported } from "./output.ts";
import { mcp } from "./surfaces.ts";

/**
 * The three commands that start any contribution, first in `--help`, so a
 * person or an agent who knows nothing else knows where to begin.
 */
export const banner = [
  "Start here:",
  `  ${Brand.cli} asks      list the open asks you could take`,
  `  ${Brand.cli} claim     take one; you get a fork to push your answer to`,
  `  ${Brand.cli} check     run the gate's checks locally before you push`,
].join("\n");

/**
 * The contracts as commands, each named (and given its positional fields)
 * by its `Cli` annotation. Only the two the banner names, until issue 404
 * projects every `cli` contract and merges their paths with `local`'s.
 */
const projected = [
  toCommand(
    ListAsks,
    Effect.service(Client),
    Context.get(ListAsks.annotations, Cli)
  ),
  toCommand(Claim, Effect.service(Client), Context.get(Claim.annotations, Cli)),
] as const;

/** `env`: the group `env set` (and, from 404, `env shape`) lives under. */
const env = Command.make("env").pipe(
  Command.withDescription(
    "Read a project's env shape, or set a write-only value."
  ),
  Command.withSubcommands(
    local.filter(({ path }) => path[0] === "env").map(({ command }) => command)
  )
);

/** The commands at the top: one word each. */
const tree = [
  ...projected,
  ...local
    .filter(({ path }) => path.length === 1)
    .map(({ command }) => command),
  env,
  mcp,
  hook,
  credential,
];

export const root = Command.make(Brand.cli).pipe(
  Command.withDescription(banner),
  Command.withSubcommands(tree)
);

/**
 * The CLI's version until issue 416's build stamps the release's own.
 */
const version = "0.0.0";

const isRefusal = Schema.is(Refusal);

const isReported = Schema.is(Reported);

/**
 * Runs the command `argv` names. Every failure has been printed once by the
 * time it ends as `Reported` (exit 1): a parse error by effect/cli, a
 * refusal by the command, anything else here, as a note. Help asked for, or
 * shown for a group run without a subcommand, is a success. A defect (a
 * stub's "not built") is not caught: the runtime prints it, loudly.
 */
export const program = (argv: readonly string[]) =>
  Command.runWith(root, { version })(argv).pipe(
    Effect.catchTag("ShowHelp", (help) =>
      help.errors.length === 0 ? Effect.void : Effect.fail(new Reported())
    ),
    // effect/cli printed its own errors, and a command its refusals.
    Effect.tapError((failure) =>
      CliError.isCliError(failure) || isRefusal(failure) || isReported(failure)
        ? Effect.void
        : Output.use((output) => output.note(String(failure)))
    ),
    Effect.mapError(() => new Reported())
  );
