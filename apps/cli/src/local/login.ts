import { Effect } from "effect";
import { Command } from "effect/cli";

/** `login`: issue 412 replaces this stub (PKCE, or `--token-stdin`). */
export const login = Command.make("login", {}, () =>
  Effect.die("not built: issue 412")
).pipe(
  Command.withDescription(
    "Sign in to a platform; git and this CLI then use its token."
  )
);

/** `logout`: issue 412 replaces this stub. */
export const logout = Command.make("logout", {}, () =>
  Effect.die("not built: issue 412")
).pipe(Command.withDescription("Forget a platform's stored token."));
