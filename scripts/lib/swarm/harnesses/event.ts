/**
 * What every harness driver shares: the events a harness's output carries,
 * the driver's shape, and the helpers that read one JSON line. The drivers
 * (`claude-code.ts`, `opencode.ts`, `amp.ts`, `pi.ts`) import it, and
 * `index.ts` gathers them, so no module imports the one that imports it.
 */
import type { Option } from "effect";
import { Data, Schema } from "effect";

import type { Harness } from "../results.ts";
import type { AgentWorkspace } from "../workspace.ts";

/** What one line of a harness's output tells the swarm. */
export type HarnessEvent = Data.TaggedEnum<{
  /** The session the harness runs: the id a resume names. */
  SessionStarted: { readonly id: string };
  /**
   * Tokens one model response used (pi, OpenCode and Amp report each
   * response; Claude Code the whole run), counting cached input as input,
   * and why the response stopped when the harness says.
   */
  Usage: {
    readonly input: number;
    readonly output: number;
    readonly stopReason: Option.Option<string>;
  };
  /**
   * The session will do nothing more on its own (pi's `agent_settled`, the
   * `result` line of Claude Code and Amp, OpenCode's `error`), with why it
   * stopped when the line says.
   */
  Settled: { readonly stopReason: Option.Option<string> };
  /**
   * The run failed on the harness's side: a provider error or an abort, a
   * model the provider refused. A model response after it (`Usage`) means
   * the harness recovered (pi retries on its own).
   */
  Failed: { readonly reason: string };
}>;

export const HarnessEvent = Data.taggedEnum<HarnessEvent>();

/** A file a harness reads, written into the workspace before its first start. */
export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
}

/** How a harness is started on a contributor's brief. */
export interface StartInput {
  readonly workspace: AgentWorkspace;
  readonly brief: string;
  readonly model: string;
  /** Load the CLI's pi adapter (pi only). */
  readonly adapter: boolean;
  /** Where a harness that takes one keeps its sessions (pi). */
  readonly sessionDir: string;
  /** The session id a harness that takes one opens or creates (pi). */
  readonly sessionKey: string;
}

/** How a harness's session is resumed with a new prompt. */
export interface ResumeInput {
  /** The id the session's first run gave (`SessionStarted`). */
  readonly session: string;
  readonly prompt: string;
  readonly model: string;
  readonly workspace: AgentWorkspace;
  /** Load the CLI's pi adapter again (pi only): a resume is a new process. */
  readonly adapter: boolean;
}

/** One harness, driven headless. Every function is pure. */
export interface HarnessDriver {
  readonly harness: Harness;
  /** The argv that starts the harness on the brief, in the workspace's clone. */
  readonly start: (input: StartInput) => readonly string[];
  /** The argv that resumes the session with `prompt`. */
  readonly resume: (input: ResumeInput) => readonly string[];
  /** What one stdout line says; most lines say nothing the swarm reads. */
  readonly parse: (line: string) => readonly HarnessEvent[];
  /** Files the harness needs in the workspace before it starts (Amp's settings). */
  readonly files: (workspace: AgentWorkspace) => readonly WorkspaceFile[];
}

/** Where a contributor's harness keeps its sessions: `<dir>/sessions`. */
export const sessionDirOf = (dir: string) => `${dir}/sessions`;

/** One stdout line decoded as `schema`, or nothing when it is not that. */
export const lineAs =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (line: string): Option.Option<A> =>
    Schema.decodeOption(Schema.fromJsonString(schema))(line);

/** A token count as a harness prints it: a whole number, never negative. */
export const Tokens = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
