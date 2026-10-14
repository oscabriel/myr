import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoName, TokenScope } from "@repo/artifacts/repo-host";
import { DateTime, Duration, Effect, Layer, Redacted, Ref } from "effect";

import { Exchange, Upstream, UpstreamFailure } from "../upstream.ts";
import type { Service } from "../upstream.ts";

const TOKEN_TTL = Duration.hours(1);

/** A token is dropped this long before it expires, so none expires mid-exchange. */
const MARGIN = Duration.minutes(1);

const CAPACITY = 1024;

interface Credentials {
  readonly authorization: string;
  readonly remote: string;
  readonly until: DateTime.Utc;
}

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
 * Tokens are kept per (repo, scope) in a map made when the layer is built: one
 * per isolate. A token being minted is never shared: on Workers a request that
 * awaits another request's I/O is cancelled as hung, and a request whose
 * client leaves is cancelled where it stands, so its mint may never end. Two
 * requests that miss at once each mint their own.
 */
export const UpstreamRepoHost: Layer.Layer<Upstream, never, RepoHost | Fetch> =
  Layer.effect(
    Upstream,
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const client = yield* Fetch;
      const kept = yield* Ref.make<ReadonlyMap<string, Credentials>>(new Map());

      const credentialsOf = (repo: RepoName, scope: TokenScope) =>
        Effect.gen(function* () {
          const key = `${scope}:${repo}`;
          const found = (yield* Ref.get(kept)).get(key);

          if (
            found !== undefined &&
            DateTime.isLessThan(yield* DateTime.now, found.until)
          ) {
            return found;
          }

          const remote = yield* host.remote(repo);
          const token = yield* host.mintToken(repo, scope, TOKEN_TTL);
          const now = yield* DateTime.now;

          const fresh: Credentials = {
            authorization: basic(token.secret),
            remote,
            until: DateTime.subtractDuration(token.expiresAt, MARGIN),
          };

          // A token too short-lived to use is not kept.
          if (DateTime.isLessThan(now, fresh.until)) {
            yield* Ref.update(kept, (all) => {
              const next = new Map(all);

              next.delete(key);
              next.set(key, fresh);

              for (const oldest of next.keys()) {
                if (next.size <= CAPACITY) {
                  break;
                }

                next.delete(oldest);
              }

              return next;
            });
          }

          return fresh;
        });

      return Upstream.of({
        exchange: (repo, exchange) =>
          Effect.gen(function* () {
            const { authorization, remote } = yield* credentialsOf(
              repo,
              scopeOf(exchange.service)
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
