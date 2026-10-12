// Apart from `index.ts`, so no driver imports the module that imports it.
import type { Option } from "effect";
import { Data, Schema } from "effect";

import type { Harness } from "../results.ts";
import type { AgentWorkspace } from "../workspace.ts";

export type HarnessEvent = Data.TaggedEnum<{
  SessionStarted: { readonly id: string };
  // Per response (pi, OpenCode, Amp) or per run (Claude Code); cached input counts as input.
  Usage: {
    readonly input: number;
    readonly output: number;
    readonly stopReason: Option.Option<string>;
  };
  Settled: { readonly stopReason: Option.Option<string> };
  // A `Usage` after it means the harness recovered (pi retries on its own).
  Failed: { readonly reason: string };
}>;

export const HarnessEvent = Data.taggedEnum<HarnessEvent>();

export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface StartInput {
  readonly workspace: AgentWorkspace;
  readonly brief: string;
  readonly model: string;
  readonly adapter: boolean;
  readonly sessionDir: string;
  readonly sessionKey: string;
}

export interface ResumeInput {
  readonly session: string;
  readonly prompt: string;
  readonly model: string;
  readonly workspace: AgentWorkspace;
  readonly adapter: boolean;
}

export interface HarnessDriver {
  readonly harness: Harness;
  readonly start: (input: StartInput) => readonly string[];
  readonly resume: (input: ResumeInput) => readonly string[];
  readonly parse: (line: string) => readonly HarnessEvent[];
  readonly files: (workspace: AgentWorkspace) => readonly WorkspaceFile[];
}

export const sessionDirOf = (dir: string) => `${dir}/sessions`;

export const lineAs =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (line: string): Option.Option<A> =>
    Schema.decodeOption(Schema.fromJsonString(schema))(line);

export const Tokens = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
