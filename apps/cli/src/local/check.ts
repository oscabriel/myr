import { Effect } from "effect";
import { Command } from "effect/cli";

/** `check`: issue 405 replaces this stub. */
export const check = Command.make("check", {}, () =>
  Effect.die("not built: issue 405")
).pipe(
  Command.withDescription(
    "Run the gate's checks on your answer locally, before you push."
  )
);
