import { Effect } from "effect";
import { Command } from "effect/cli";

/** `env set`: issue 414 replaces this stub. */
export const envSet = Command.make("set", {}, () =>
  Effect.die("not built: issue 414")
).pipe(
  Command.withDescription(
    "Set a sensitive env item's value from stdin; nobody can read it back."
  )
);
