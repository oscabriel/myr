// Each flag was read from the harness's `--help` (Claude Code 2.1.293, OpenCode 2.0.7,
// Amp 0.0.1789750518, pi 1.1.0); `packages/config/test/fixtures/swarm/harness-output/`
// holds what they printed. Where an answer stands comes from `<cli> status`, never
// from a harness's output.
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

export const drivers = {
  amp,
  "claude-code": claudeCode,
  opencode,
  pi,
} as const satisfies Readonly<Record<Harness, HarnessDriver>>;
