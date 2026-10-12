import { Effect, Option } from "effect";

import { Sessions } from "../sessions.ts";

export const firstOf = (
  sessions: readonly Sessions["Service"][]
): Sessions["Service"] =>
  Sessions.of({
    verify: (token) =>
      Effect.gen(function* () {
        for (const { verify } of sessions) {
          const person = yield* verify(token);

          if (Option.isSome(person)) {
            return person;
          }
        }

        return Option.none();
      }),
  });
