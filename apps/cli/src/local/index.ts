import type { Command } from "effect/cli";

import { askOpen } from "./ask-open.ts";
import { check } from "./check.ts";
import { envSet } from "./env-set.ts";
import { init } from "./init.ts";
import { login, logout } from "./login.ts";
import { why } from "./why.ts";

export interface LocalEntry {
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
  { command: askOpen, path: ["ask", "open"] },
] as const satisfies readonly LocalEntry[];
