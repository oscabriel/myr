/**
 * Sessions for the platform's own OAuth access tokens: the provider looks
 * the token up in `OAUTH_KV` by its hash and decrypts the grant's props,
 * which carry only `{ handle }`. A token the provider does not know, one
 * past its expiry, or one whose props name no handle verifies as nobody.
 * The Worker puts these first in `firstOf`, before the operator and
 * `SESSION_TOKENS` tables.
 */
import { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Clock, Effect, Option, Schema } from "effect";

import { Sessions } from "../sessions.ts";

/** What a grant's props carry: who signed in. */
const GrantProps = Schema.Struct({ handle: Handle });

const decodeProps = Schema.decodeUnknownOption(GrantProps);

/**
 * What a session needs from the provider: a token's record, its props
 * decrypted, or nothing for a token it does not know or that has expired
 * (`OAuthHelpers.unwrapToken`; `auth/provider.ts`'s `tokenReader`).
 */
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
