import { Effect } from "effect";
import { Command } from "effect/cli";

/** `why`: issue 414 replaces this stub. */
export const why = Command.make("why", {}, () =>
  Effect.die("not built: issue 414")
).pipe(
  Command.withDescription(
    "Explain a line: the ask, the answer and the people that landed it."
  )
);
