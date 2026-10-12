// Usage: bunx varlock run --path infra/ -- bun infra/teardown.ts
//   [--stage <s>] [--keep <project>]… [--apply]
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostRest } from "@repo/artifacts/repo-host/rest";
import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Scope,
  Stdio,
  SynchronizedRef,
} from "effect";
import { FetchHttpClient } from "effect/http";

import { teardown, TeardownAccount } from "./lib/teardown.ts";

const API = "https://api.cloudflare.com/client/v4";

const Credentials = Config.all({
  accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
});

// Never a query or a header, so no credential reaches the output.
const placeOf = (request: Request) => {
  const url = new URL(request.url);

  return `${url.origin}${url.pathname}`;
};

const BunFetch = Layer.effect(
  Fetch,
  Effect.gen(function* () {
    const send = yield* FetchHttpClient.Fetch;

    return Fetch.of({
      fetch: (request) =>
        Effect.tryPromise({
          catch: (cause) =>
            new FetchFailed({
              reason:
                cause instanceof Error
                  ? `the request got no response: ${cause.name}`
                  : "the request got no response",
              url: placeOf(request),
            }),
          try: () => send(request),
        }),
    });
  })
);

const LiveAccount = Layer.effect(
  TeardownAccount,
  Effect.gen(function* () {
    const { accountId, token } = yield* Credentials;
    const fetch = yield* Fetch;
    const scope = yield* Scope.Scope;

    const hosts = yield* SynchronizedRef.make<
      ReadonlyMap<string, RepoHost["Service"]>
    >(new Map());

    const repos = (namespace: string) =>
      SynchronizedRef.modifyEffect(hosts, (all) =>
        Option.match(Option.fromNullishOr(all.get(namespace)), {
          onNone: () =>
            Layer.buildWithScope(
              RepoHostRest.layer({ accountId, namespace, token }),
              scope
            ).pipe(
              Effect.provideService(Fetch, fetch),
              Effect.map((context) => {
                const host = Context.get(context, RepoHost);

                return [host, new Map(all).set(namespace, host)] as const;
              })
            ),
          onSome: (host) => Effect.succeed([host, all] as const),
        })
      );

    const namespaceCall = (name: string, method: "DELETE" | "GET") =>
      Effect.gen(function* () {
        const response = yield* fetch
          .fetch(
            new Request(
              `${API}/accounts/${encodeURIComponent(accountId)}/artifacts/namespaces/${encodeURIComponent(name)}`,
              {
                headers: {
                  accept: "application/json",
                  authorization: `Bearer ${Redacted.value(token)}`,
                },
                method,
              }
            )
          )
          .pipe(Effect.orDie);

        if (response.status === 200 || response.status === 404) {
          return response.status === 200;
        }

        return yield* Effect.die(
          `${method} namespace ${name} answered ${response.status}`
        );
      });

    return TeardownAccount.of({
      namespaceExists: (name) => namespaceCall(name, "GET"),
      removeNamespace: (name) => namespaceCall(name, "DELETE"),
      repos,
    });
  })
);

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* teardown(args);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          LiveAccount.pipe(Layer.provide(BunFetch)),
          BunServices.layer
        )
      )
    )
  );
}
