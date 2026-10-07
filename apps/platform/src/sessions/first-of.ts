import { Effect, Option } from "effect";

import { Sessions } from "../sessions.ts";

/**
 * One `Sessions` over several: a token names whom the first of `sessions`
 * that knows it says, and the rest are not asked. So every source of tokens
 * (sign-in, the operator, `SESSION_TOKENS`) is checked by one service, and
 * the order says which wins when two know one token.
 */
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
