import { Context, Effect, Layer, Option } from "effect";

import { Audience } from "./annotations.ts";
import {
  Anonymous,
  Authenticated,
  CurrentPrincipal,
  Unauthenticated,
} from "./principal.ts";
import type { Person, Principal } from "./principal.ts";

export const bearerToken = (authorization: string | undefined) =>
  Option.fromNullishOr(
    /^Bearer (?<token>\S+)$/iu.exec(authorization ?? "")?.groups?.token
  );

/**
 * An unknown credential, or an `authorization` header with no bearer token,
 * is refused, never taken for anyone; a failing `verify` kills the call
 * rather than run it as anyone.
 */
export const authenticated = <E, R>(
  verify: (credential: string) => Effect.Effect<Option.Option<Person>, E, R>
): Layer.Layer<Authenticated, never, R> =>
  Layer.effect(
    Authenticated,
    Effect.gen(function* () {
      const services = yield* Effect.context<R>();

      const verified = (credential: string) =>
        verify(credential).pipe(Effect.orDie, Effect.provideContext(services));

      const principalOf = (
        authorization: string | undefined,
        audience: (typeof Audience)["Service"]
      ): Effect.Effect<Option.Option<Principal>> => {
        if (authorization === undefined) {
          return audience === "public"
            ? Effect.succeedSome(Anonymous.make({}))
            : Effect.succeedNone;
        }

        return Option.match(bearerToken(authorization), {
          onNone: () => Effect.succeedNone,
          onSome: verified,
        });
      };

      return (effect, { headers, rpc }) =>
        Effect.gen(function* () {
          const principal = yield* principalOf(
            headers.authorization,
            Context.get(rpc.annotations, Audience)
          );

          if (Option.isNone(principal)) {
            return yield* new Unauthenticated();
          }

          return yield* Effect.provideService(
            effect,
            CurrentPrincipal,
            principal.value
          );
        });
    })
  );
