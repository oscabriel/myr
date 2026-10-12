import { Context, Schema } from "effect";
import type { Array, Effect } from "effect";

export class BoxFailed extends Schema.TaggedError<BoxFailed>()("BoxFailed", {
  operation: Schema.Literals(["exec", "writeFile"]),
  reason: Schema.String,
}) {}

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

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
    readonly destroy: () => Effect.Effect<void>;
  }
>()("sandbox/Box") {}
