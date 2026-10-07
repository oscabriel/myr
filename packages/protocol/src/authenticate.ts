import { Context, Effect, Layer, Option } from "effect";

import { Audience } from "./annotations.ts";
import {
  Anonymous,
  Authenticated,
  CurrentPrincipal,
  Unauthenticated,
} from "./principal.ts";
import type { Person, Principal } from "./principal.ts";

/** The credential in an `authorization: Bearer <token>` header. */
const bearer = (authorization: string) =>
  Option.fromNullishOr(
    /^Bearer (?<token>\S+)$/u.exec(authorization)?.groups?.token
  );

/**
 * Server side of `Authenticated`: a credential names a Person; no credential
 * is Anonymous only for a `public` contract. A credential `verify` doesn't
 * know is refused, never taken for anyone, and so is an `authorization`
 * header that holds no bearer token. A `verify` that fails can't say who is
 * calling, so the call dies rather than run as anyone.
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

        return Option.match(bearer(authorization), {
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
