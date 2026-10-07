/**
 * The CLI's hand-written commands, by the path a person types. Each issue
 * that builds one replaces its file; none edits `main.ts`, which builds the
 * command tree from this list.
 */
import type { Command } from "effect/cli";

import { check } from "./check.ts";
import { envSet } from "./env-set.ts";
import { init } from "./init.ts";
import { login, logout } from "./login.ts";
import { why } from "./why.ts";

/** One hand-written command, and the words that reach it. */
export interface LocalEntry {
  /** The words after the CLI's name; the last is the command's own name. */
  readonly path: readonly [string, ...string[]];
  readonly command: Command.Command.Any;
}

export const local = [
  { command: login, path: ["login"] },
  { command: logout, path: ["logout"] },
  { command: init, path: ["init"] },
  { command: check, path: ["check"] },
  { command: why, path: ["why"] },
  { command: envSet, path: ["env", "set"] },
] as const satisfies readonly LocalEntry[];
