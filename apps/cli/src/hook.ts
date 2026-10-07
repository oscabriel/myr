import { Effect } from "effect";
import { Command } from "effect/cli";

/** `hook <event> --json`: issue 415 replaces this stub. */
export const hook = Command.make("hook", {}, () =>
  Effect.die("not built: issue 415")
).pipe(
  Command.withDescription(
    "Answer a harness hook (session-start, pre-tool-use, stop) with the gate's policy."
  )
);
