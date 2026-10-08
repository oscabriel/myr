/**
 * The four harnesses a swarm contributor runs, each driven headless: how to
 * start one on a brief, how to resume its session with a new prompt, and
 * what one line of its JSON output says. A harness's output gives only its
 * session's id, that the session settled, and the tokens it used; where the
 * answer stands comes from `<cli> status` (`../outcome.ts`), never from
 * what a harness printed.
 *
 * Every flag here was read from the installed harness's `--help` on
 * 2026-10-08 (Claude Code 2.1.293, OpenCode 2.0.7, Amp 0.0.1789750518, pi
 * 1.1.0), and each start and resume was run once headless against a
 * scratch clone; `packages/config/test/fixtures/swarm/harness-output/` holds
 * what they printed.
 */
import type { Harness } from "../results.ts";
import { amp } from "./amp.ts";
import { claudeCode } from "./claude-code.ts";
import type { HarnessDriver } from "./event.ts";
import { opencode } from "./opencode.ts";
import { pi } from "./pi.ts";

export { HarnessEvent, lineAs, sessionDirOf, Tokens } from "./event.ts";

export type {
  HarnessDriver,
  ResumeInput,
  StartInput,
  WorkspaceFile,
} from "./event.ts";

/** Each harness's driver. */
export const drivers = {
  amp,
  "claude-code": claudeCode,
  opencode,
  pi,
} as const satisfies Readonly<Record<Harness, HarnessDriver>>;
