import { Effect } from "effect";
import { Command } from "effect/cli";

/** `init`: issue 413 replaces this stub. */
export const init = Command.make("init", {}, () =>
  Effect.die("not built: issue 413")
).pipe(
  Command.withDescription(
    "Make this repo, or a public HTTPS repo, a project: find its checks, write its config and push."
  )
);
