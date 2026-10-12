import { Effect, Layer } from "effect";

import { SignInAttempts } from "../attempts.ts";

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
