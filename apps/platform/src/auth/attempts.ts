import { Context, Duration } from "effect";
import type { Effect } from "effect";

// Mirrors `SIGN_IN_LIMIT` in wrangler.jsonc.
export const AttemptPolicy = {
  limit: 5,
  period: Duration.minutes(1),
} as const;

export class SignInAttempts extends Context.Service<
  SignInAttempts,
  {
    readonly admit: (key: string) => Effect.Effect<boolean>;
  }
>()("platform/SignInAttempts") {}
