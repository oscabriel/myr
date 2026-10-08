/**
 * The `Box` port: the one container a Checker or a Lander Durable Object
 * runs its commands in. Both run through it, so their scripts are tested in
 * Node over local processes and run in a container in the
 * Worker (`box/sdk.ts`).
 */
import { Context, Schema } from "effect";
import type { Array, Effect } from "effect";

/** The container would not run a command, take a file or answer at all. */
export class BoxFailed extends Schema.TaggedError<BoxFailed>()("BoxFailed", {
  operation: Schema.Literals(["exec", "writeFile"]),
  reason: Schema.String,
}) {}

/** How one command runs: where, with what env, and for how long at most. */
export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** What one command left: its exit code and its output, as text. */
export interface Executed {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class Box extends Context.Service<
  Box,
  {
    /** Runs `argv` and waits for it; a command that exits non-zero is still a success. */
    readonly exec: (
      argv: Array.NonEmptyReadonlyArray<string>,
      options?: ExecOptions
    ) => Effect.Effect<Executed, BoxFailed>;
    readonly writeFile: (
      path: string,
      bytes: Uint8Array
    ) => Effect.Effect<void, BoxFailed>;
    /** Stops the container and drops everything in it. */
    readonly destroy: () => Effect.Effect<void>;
  }
>()("sandbox/Box") {}
