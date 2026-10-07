import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoName, TokenScope } from "@repo/artifacts/repo-host";
import {
  Cache,
  Data,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Redacted,
} from "effect";

import { Exchange, Upstream, UpstreamFailure } from "../upstream.ts";
import type { Service } from "../upstream.ts";

/** How long a token the upstream mints is asked to last. */
const TOKEN_TTL = Duration.hours(1);

/** A token is dropped this long before it expires, so none expires mid-exchange. */
const MARGIN = Duration.minutes(1);

/** Tokens kept at once, one per (repo, scope). */
const CAPACITY = 1024;

class TokenKey extends Data.Class<{
  readonly repo: RepoName;
  readonly scope: TokenScope;
}> {}

/** A clone or fetch reads; only a push writes. */
const scopeOf = (service: Service): TokenScope =>
  service === "git-receive-pack" ? "write" : "read";

/**
 * Basic auth as Artifacts takes it: any user name, and the token's secret
 * without its `?expires=` suffix as the password.
 */
const basic = (secret: Redacted.Redacted) => {
  const [password = ""] = Redacted.value(secret).split("?expires=");

  return `Basic ${btoa(`x:${password}`)}`;
};

const requestOf = (
  remote: string,
  exchange: Exchange,
  authorization: string
) => {
  const headers = new Headers(exchange.headers);

  headers.set("authorization", authorization);

  return Exchange.$match(exchange, {
    Advertise: ({ service }) =>
      new Request(`${remote}/info/refs?service=${service}`, { headers }),
    Call: ({ body, service }) => {
      // Node sends a streamed body only with `duplex: "half"`; the Workers
      // types lack the key, and workerd ignores it.
      const init = { body, duplex: "half", headers, method: "POST" };

      return new Request(`${remote}/${service}`, init);
    },
  });
};

/**
 * The production `Upstream`: each exchange goes to the repo's own remote in
 * the store, with a token the store minted for the exchange's scope. Tokens
 * are cached per (repo, scope) until a minute before they expire, in a cache
 * made when the layer is built: one per isolate in a Worker (S7 #2).
 */
export const UpstreamRepoHost: Layer.Layer<Upstream, never, RepoHost | Fetch> =
  Layer.effect(
    Upstream,
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const client = yield* Fetch;

      const credentials = yield* Cache.makeWith(
        ({ repo, scope }: TokenKey) =>
          Effect.gen(function* () {
            const remote = yield* host.remote(repo);
            const token = yield* host.mintToken(repo, scope, TOKEN_TTL);
            const now = yield* DateTime.now;

            return {
              authorization: basic(token.secret),
              lasts: Duration.subtract(
                DateTime.distance(now, token.expiresAt),
                MARGIN
              ),
              remote,
            };
          }),
        {
          capacity: CAPACITY,
          // A failed mint is not kept, nor a token too short-lived to use.
          timeToLive: (exit) =>
            Exit.isSuccess(exit) &&
            Duration.isGreaterThan(exit.value.lasts, Duration.zero)
              ? exit.value.lasts
              : Duration.zero,
        }
      );

      return Upstream.of({
        exchange: (repo, exchange) =>
          Effect.gen(function* () {
            const { authorization, remote } = yield* Cache.get(
              credentials,
              new TokenKey({ repo, scope: scopeOf(exchange.service) })
            );

            return yield* client
              .fetch(requestOf(remote, exchange, authorization))
              .pipe(
                Effect.mapError(
                  ({ reason }) => new UpstreamFailure({ reason, repo })
                )
              );
          }),
      });
    })
  );
