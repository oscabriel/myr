// The token rides as the HTTP `authorization` header: Rpc headers would ride in the body, where the gate never looks.
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Authenticated, Unauthenticated } from "@repo/protocol/principal";
import {
  Config,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/http";
import {
  RpcClient,
  RpcClientError,
  RpcMiddleware,
  RpcSerialization,
} from "effect/rpc";

import { Credentials } from "./credentials.ts";

const URL_VARIABLE = `${Brand.slug.toUpperCase()}_URL`;

const isClientError = Schema.is(RpcClientError.RpcClientError);

const isHttpFailure = Schema.is(HttpClientError.HttpClientErrorSchema);

export const isTransportFailure = isClientError;

/** An HTTP failure's own message is empty: its cause says what failed. */
export const transportMessage = (failure: RpcClientError.RpcClientError) =>
  isHttpFailure(failure.reason) &&
  Predicate.hasProperty(failure.reason.cause, "message") &&
  Predicate.isString(failure.reason.cause.message)
    ? failure.reason.cause.message
    : failure.message;

const isUnauthorized = (failure: RpcClientError.RpcClientError) =>
  Predicate.hasProperty(failure.reason, "cause") &&
  failure.reason.cause instanceof HttpClientError.StatusCodeError &&
  failure.reason.cause.response.status === 401;

/** A 401 from the platform's gate is the same `Unauthenticated` a contract gives a call without a token. */
const SignedIn = RpcMiddleware.layerClient(Authenticated, ({ next, request }) =>
  next(request).pipe(
    Effect.catchIf(
      (failure) => isClientError(failure) && isUnauthorized(failure),
      () => Effect.fail(new Unauthenticated())
    )
  )
);

// The token is read for each request, not once: `mcp` serves for hours, and
// the stored token is renewed under it as it nears its lapse.
const over = (
  origin: string,
  token: Effect.Effect<Option.Option<Redacted.Redacted>>
) =>
  Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
    Layer.provide(SignedIn),
    Layer.provide(
      Layer.effect(RpcClient.Protocol)(
        Effect.flatMap(HttpClient.HttpClient, (client) =>
          RpcClient.makeProtocolHttp(
            client.pipe(
              HttpClient.mapRequest(
                HttpClientRequest.prependUrl(
                  `${origin.replace(/\/+$/u, "")}/rpc`
                )
              ),
              HttpClient.mapRequestEffect((request) =>
                Effect.map(token, (bearer) =>
                  Option.match(bearer, {
                    onNone: () => request,
                    onSome: (value) =>
                      HttpClientRequest.bearerToken(
                        request,
                        Redacted.value(value)
                      ),
                  })
                )
              ),
              // Any status but 2xx fails as itself, so a 401 is told apart.
              HttpClient.filterStatusOk
            )
          )
        )
      )
    ),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
  );

export const RemoteClient: Layer.Layer<Client, never, Credentials> =
  Layer.unwrap(
    Effect.gen(function* () {
      const credentials = yield* Credentials;

      const profile = yield* credentials.current;

      if (Option.isSome(profile)) {
        const { url } = profile.value;

        return over(
          url,
          Effect.map(credentials.current, (now) =>
            Option.map(
              Option.filter(now, (kept) => kept.url === url),
              ({ token }) => token
            )
          )
        );
      }

      const url = yield* Config.option(
        Config.NonEmptyString(URL_VARIABLE)
      ).pipe(Effect.orElseSucceed(() => Option.none()));

      // With nothing naming a platform, the platform itself, as anyone.
      return over(
        Option.getOrElse(url, () => Brand.platformUrl),
        Effect.succeedNone
      );
    })
  );
