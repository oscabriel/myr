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

export class NoPlatform extends Schema.TaggedError<NoPlatform>()("NoPlatform", {
  variable: Schema.String,
}) {
  override get message() {
    return `no platform to call: run ${Brand.cli} login, or set ${this.variable} to call one as anyone`;
  }
}

const isClientError = Schema.is(RpcClientError.RpcClientError);

const isDefect = Schema.is(RpcClientError.RpcClientDefect);

const isNoPlatformError = Schema.is(NoPlatform);

const isHttpFailure = Schema.is(HttpClientError.HttpClientErrorSchema);

export const isTransportFailure = isClientError;

/** An HTTP failure's own message is empty: its cause says what failed. */
export const transportMessage = (failure: RpcClientError.RpcClientError) =>
  isHttpFailure(failure.reason) &&
  Predicate.hasProperty(failure.reason.cause, "message") &&
  Predicate.isString(failure.reason.cause.message)
    ? failure.reason.cause.message
    : failure.message;

export const noPlatformOf = (
  failure: RpcClientError.RpcClientError
): Option.Option<NoPlatform> =>
  isDefect(failure.reason) && isNoPlatformError(failure.reason.cause)
    ? Option.some(failure.reason.cause)
    : Option.none();

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

const over = (origin: string, token: Option.Option<Redacted.Redacted>) =>
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
              HttpClient.mapRequest((request) =>
                Option.match(token, {
                  onNone: () => request,
                  onSome: (bearer) =>
                    HttpClientRequest.bearerToken(
                      request,
                      Redacted.value(bearer)
                    ),
                })
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

const noPlatform = new NoPlatform({ variable: URL_VARIABLE });

const nowhere = Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
  Layer.provide(
    Layer.effect(RpcClient.Protocol)(
      Effect.flatMap(
        Effect.service(RpcSerialization.RpcSerialization),
        (serialization) =>
          RpcClient.Protocol.make(() =>
            Effect.succeed({
              codecFor: serialization.codecFor,
              send: () =>
                Effect.fail(
                  new RpcClientError.RpcClientError({
                    reason: new RpcClientError.RpcClientDefect({
                      cause: noPlatform,
                      message: noPlatform.message,
                    }),
                  })
                ),
              supportsAck: false,
              supportsTransferables: false,
            })
          )
      )
    )
  ),
  Layer.provide(RpcSerialization.layerJson)
);

export const RemoteClient: Layer.Layer<Client, never, Credentials> =
  Layer.unwrap(
    Effect.gen(function* () {
      const profile = yield* Effect.flatMap(
        Effect.service(Credentials),
        (credentials) => credentials.current
      );

      if (Option.isSome(profile)) {
        return over(profile.value.url, Option.some(profile.value.token));
      }

      const url = yield* Config.option(
        Config.NonEmptyString(URL_VARIABLE)
      ).pipe(Effect.orElseSucceed(() => Option.none()));

      return Option.match(url, {
        onNone: () => nowhere,
        onSome: (origin) => over(origin, Option.none()),
      });
    })
  );
