import { Effect } from "effect";
import { Command } from "effect/cli";

/** `credential <get|store|erase>`, git's credential helper: issue 412 replaces this stub. */
export const credential = Command.make("credential", {}, () =>
  Effect.die("not built: issue 412")
).pipe(
  Command.withDescription(
    "Be git's credential helper: hand git the stored token for a platform."
  )
);
