import { Clock, Duration, Effect, Layer, Ref } from "effect";

import { AttemptPolicy, SignInAttempts } from "../attempts.ts";

interface Window {
  readonly count: number;
  readonly startedAt: number;
}

export const SignInAttemptsMemory = {
  layer: Layer.effect(
    SignInAttempts,
    Effect.gen(function* () {
      const windows = yield* Ref.make(new Map<string, Window>());

      const period = Duration.toMillis(AttemptPolicy.period);

      return SignInAttempts.of({
        admit: (key) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            return yield* Ref.modify(windows, (all) => {
              const open = all.get(key);

              if (open === undefined || now - open.startedAt >= period) {
                return [
                  true,
                  new Map(all).set(key, { count: 1, startedAt: now }),
                ];
              }

              return open.count < AttemptPolicy.limit
                ? [
                    true,
                    new Map(all).set(key, { ...open, count: open.count + 1 }),
                  ]
                : [false, all];
            });
          }),
      });
    })
  ),
};
