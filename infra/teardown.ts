/**
 * teardown: `bunx varlock run --path infra/ -- bun infra/teardown.ts
 * [--stage <s>] [--keep <project>]… [--apply]`. Prints which throwaways the
 * ledger (`infra/created.jsonl`) still has on the account, and with `--apply`
 * deletes exactly those; `infra/lib/teardown.ts` decides what may be deleted,
 * and `.agents/ops/stages.md` ("Teardown policy") says why.
 *
 * It reaches Artifacts with the infra token (`CLOUDFLARE_ACCOUNT_ID` and
 * `CLOUDFLARE_API_TOKEN`, from `varlock run --path infra/`): repos through
 * `@repo/artifacts`' REST adapter, one per namespace, and a namespace itself
 * over the same REST API bootstrap uses to make one (`RepoHost` has no route
 * for a namespace). It mints no repo token. Nothing it runs is a Wrangler or
 * cf `delete`, and it touches no Worker, D1, KV or R2.
 */
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

/** The infra credentials `varlock run --path infra/` puts in the environment. */
const Credentials = Config.all({
  accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
});

/** Where a request went: the origin and the path, never a query or a header. */
const placeOf = (request: Request) => {
  const url = new URL(request.url);

  return `${url.origin}${url.pathname}`;
};

/** The `Fetch` port over Bun's own fetch, as effect/http finds it. */
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

/**
 * The account over its REST API: a namespace's repos through a REST
 * `RepoHost` made on first use and kept for the run, and a namespace's own
 * route read or deleted directly, where 404 means it isn't there and any
 * other refusal stops the run.
 */
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

    /** One call to a namespace's own route: true on 200, false on 404. */
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
