import { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Clock, Effect, Option, Schema } from "effect";

import { Sessions } from "../sessions.ts";

const GrantProps = Schema.Struct({ handle: Handle });

const decodeProps = Schema.decodeUnknownOption(GrantProps);

export interface TokenReader {
  readonly unwrapToken: (token: string) => Promise<{
    readonly expiresAt: number;
    readonly grant: { readonly props: unknown };
  } | null>;
}

export const OAuthSessions = (helpers: TokenReader) =>
  Sessions.of({
    verify: (token) =>
      Effect.gen(function* () {
        const summary = yield* Effect.promise(() => helpers.unwrapToken(token));

        const now = yield* Clock.currentTimeMillis;

        return Option.fromNullishOr(summary).pipe(
          Option.filter(({ expiresAt }) => expiresAt * 1000 > now),
          Option.flatMap(({ grant }) => decodeProps(grant.props)),
          Option.map(({ handle }) => Person.make({ handle }))
        );
      }),
  });
