// The platform's token endpoint, as the CLI's own OAuth client calls it: to
// trade a sign-in's code, to renew a token with its refresh token, and to
// revoke a grant at logout. Every token stays `Redacted`; it is written out
// only in the form that carries it to the endpoint.
import { Clock, Effect, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export const CLI_CLIENT_PATH = "/oauth/cli";

// Where the platform shows a code to paste: its page for a browser on another machine.
export const CLI_CODE_PATH = "/oauth/cli/code";

export const cliClientIdOf = (origin: string) => `${origin}${CLI_CLIENT_PATH}`;

const Secret = Schema.RedactedFromValue(Schema.NonEmptyString);

const TokenAnswer = Schema.Struct({
  access_token: Secret,
  expires_in: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  refresh_token: Schema.optionalKey(Secret),
  token_type: Schema.String,
});

const decodeTokenAnswer = Schema.decodeUnknownEffect(TokenAnswer);

export class TokenRefused extends Schema.TaggedError<TokenRefused>()(
  "TokenRefused",
  {}
) {}

/** What the endpoint issued: a token, and when it lapses and how to renew it, where it says. */
export interface Issued {
  readonly expiresAt: Option.Option<number>;
  readonly refreshToken: Option.Option<Redacted.Redacted>;
  readonly token: Redacted.Redacted;
}

const post = (url: string, fields: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* client.execute(
      HttpClientRequest.post(`${url}/token`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams(fields)
      )
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));

const issue = (url: string, fields: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const response = yield* post(url, fields);

    if (response.status !== 200) {
      return yield* new TokenRefused();
    }

    const answer = yield* decodeTokenAnswer(yield* response.json);

    if (answer.token_type.toLowerCase() !== "bearer") {
      return yield* new TokenRefused();
    }

    const now = yield* Clock.currentTimeMillis;

    const issued: Issued = {
      expiresAt: Option.map(
        Option.fromUndefinedOr(answer.expires_in),
        (seconds) => now + seconds * 1000
      ),
      refreshToken: Option.fromUndefinedOr(answer.refresh_token),
      token: answer.access_token,
    };

    return issued;
  }).pipe(Effect.mapError(() => new TokenRefused()));

export const tradeCode = (input: {
  readonly code: string;
  readonly redirectUri: string;
  readonly url: string;
  readonly verifier: string;
}) =>
  issue(input.url, {
    client_id: cliClientIdOf(input.url),
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });

export const renew = (url: string, refreshToken: Redacted.Redacted) =>
  issue(url, {
    client_id: cliClientIdOf(url),
    grant_type: "refresh_token",
    refresh_token: Redacted.value(refreshToken),
  });

/**
 * Revoking a refresh token ends its whole grant, the access tokens it gave
 * included (RFC 7009). Best effort: a platform out of reach changes nothing
 * here, and the token lapses on its own.
 */
export const revoke = (
  url: string,
  token: Redacted.Redacted,
  hint: "access_token" | "refresh_token"
) =>
  post(url, {
    client_id: cliClientIdOf(url),
    token: Redacted.value(token),
    token_type_hint: hint,
  }).pipe(Effect.map((response) => response.status === 200));
