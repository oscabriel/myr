import { Effect, Layer } from "effect";

import { disposed } from "../../adapters/rpc-result.ts";
import { SignInAttempts } from "../attempts.ts";

export const SignInAttemptsBinding = (limiter: RateLimit) =>
  Layer.succeed(
    SignInAttempts,
    SignInAttempts.of({
      admit: (key) =>
        Effect.promise(() => limiter.limit({ key })).pipe(
          Effect.flatMap(disposed),
          Effect.map(({ success }) => success)
        ),
    })
  );
