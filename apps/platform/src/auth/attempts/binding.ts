import { Effect, Layer } from "effect";

import { SignInAttempts } from "../attempts.ts";

/**
 * Attempts counted by a Workers ratelimit binding (`SIGN_IN_LIMIT`: five a
 * minute per key, per Cloudflare location). Every call counts, admitted or
 * not; a binding that cannot answer is a defect, never an admission.
 */
export const SignInAttemptsBinding = (limiter: RateLimit) =>
  Layer.succeed(
    SignInAttempts,
    SignInAttempts.of({
      admit: (key) =>
        Effect.promise(() => limiter.limit({ key })).pipe(
          Effect.map(({ success }) => success)
        ),
    })
  );
