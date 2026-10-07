/**
 * Sign-in attempts: how many tries one key (a handle, or a client's
 * address) gets before the platform stops checking passwords for it for a
 * while. `/memory` for tests, the `SIGN_IN_LIMIT` ratelimit binding on
 * Cloudflare (`attempts/binding.ts`).
 */
import { Context, Duration } from "effect";
import type { Effect } from "effect";

/** Five attempts a minute per key, as `wrangler.jsonc` sets `SIGN_IN_LIMIT`. */
export const AttemptPolicy = {
  limit: 5,
  period: Duration.minutes(1),
} as const;

export class SignInAttempts extends Context.Service<
  SignInAttempts,
  {
    /** Counts one attempt under `key`; false once the key has used its allowance. */
    readonly admit: (key: string) => Effect.Effect<boolean>;
  }
>()("platform/SignInAttempts") {}
