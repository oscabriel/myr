/**
 * `Network` and `Snapshots` over a Durable Object's own container, as the
 * Container API runs one (`ctx.container`; Sandbox SDK 1.0 leaves both to
 * it, W3 315 Comments):
 *
 * - the network is the container's outbound intercepts. The container starts
 *   with the internet off, so a request leaves only through an intercept:
 *   the clone host goes to `CloneGateway`, each `@proxy` host of the job to
 *   `EgressGateway` until egress is off and to `EnvGateway` after, and every
 *   other host, HTTPS (`*`) and HTTP, to `EgressGateway`, whose props say
 *   what it lets out. A host is registered ahead of the catch-all, which
 *   takes every host registered after it (the Sandbox SDK's
 *   `DirectoryBackup.intercept`), so the job's `@proxy` hosts are reserved
 *   when the layer is built. Registering a target again replaces its handler
 *   in place, which is how the allow-list changes, how the clone route
 *   closes once setup starts, how egress goes off, and how the env route
 *   opens.
 * - a snapshot is a Container snapshot (public beta) of the whole root
 *   filesystem, its id kept in an index the project's checks share; a
 *   restore starts the container again from it, so the intercepts are
 *   registered again too (they last only as long as one container).
 */
import {
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
} from "effect";

import { BoxFailed } from "../box.ts";
import type { EnvGatewayProps } from "../env-gateway.ts";
import type { CloneProps, EgressProps } from "../outbound.ts";
import { Network } from "./network.ts";
import type { CloneRoute, EnvRoute } from "./network.ts";
import { Snapshots } from "./snapshots.ts";

/**
 * The outbound entrypoints' loopbacks: `ctx.exports` holds one per export of
 * the Worker's main module.
 */
export interface Gateways {
  readonly CloneGateway: (options: { readonly props: CloneProps }) => Fetcher;
  readonly EgressGateway: (options: { readonly props: EgressProps }) => Fetcher;
  readonly EnvGateway: (options: {
    readonly props: EnvGatewayProps;
  }) => Fetcher;
}

/** Whether `ctx.exports` holds every gateway: `worker.ts` must export them. */
export const hasGateways = (
  exports: Cloudflare.Exports
): exports is Cloudflare.Exports & Gateways =>
  Predicate.hasProperty(exports, "CloneGateway") &&
  Predicate.isFunction(exports.CloneGateway) &&
  Predicate.hasProperty(exports, "EgressGateway") &&
  Predicate.isFunction(exports.EgressGateway) &&
  Predicate.hasProperty(exports, "EnvGateway") &&
  Predicate.isFunction(exports.EnvGateway);

/** Where snapshot ids are kept, by key, for every check of one project. */
export interface SnapshotIndex {
  readonly find: (key: string) => Promise<string | null>;
  readonly keep: (key: string, id: string) => Promise<void>;
  readonly forget: (key: string) => Promise<void>;
}

/** What the container's intercepts say now. */
interface Routes {
  readonly clone: Option.Option<CloneRoute>;
  readonly allow: readonly string[];
  /**
   * The clone is done: the first `allow` closes its route, so setup and the
   * lanes reach the clone host only as a host they are refused.
   */
  readonly cloned: boolean;
  /**
   * The job's `@proxy` hosts, registered ahead of the catch-all from the
   * first install on: to the egress gateway, like any other host, until
   * the env route opens.
   */
  readonly proxied: readonly string[];
  /** The env route, once open: its hosts go to the env gateway. */
  readonly env: Option.Option<EnvRoute>;
}

/** The name every setup snapshot carries; its index key tells them apart. */
const SNAPSHOT_NAME = "check-setup";

/** What a restored container runs while commands run beside it. */
const IDLE = ["sleep", "infinity"];

const failed = (reason: string) => (cause: unknown) =>
  new BoxFailed({ operation: "exec", reason: `${reason}: ${String(cause)}` });

/**
 * One intercept registered. One that will not register leaves the network
 * other than the job needs, so it ends the job (a defect), never a lane's run.
 */
const intercept = (register: () => Promise<void>) => Effect.promise(register);

/**
 * The env gateway's props for `route`: plain data on the Worker's side,
 * the values opened from their redaction only here.
 */
const envProps = ({ rules, values }: EnvRoute): EnvGatewayProps => ({
  rules,
  values: values.map(({ key, placeholder, value }) => ({
    key,
    placeholder,
    value: Redacted.value(value),
  })),
});

/** The hosts the env route has opened, and the gateway they go to. */
interface Opened {
  readonly hosts: readonly string[];
  readonly to: Fetcher;
}

/**
 * Points the container's intercepts where `routes` says: the clone host to
 * the clone gateway (or, once the clone is done, to the egress gateway, which
 * refuses it), each `@proxy` host to the env gateway once its route is open
 * (to the egress gateway until then), and every other host, HTTPS and HTTP,
 * to an egress gateway allowing `allow`, in that order.
 */
const install = (
  container: Container,
  gateways: Gateways,
  { allow, clone, cloned, env, proxied }: Routes
) =>
  Effect.gen(function* () {
    const egress = gateways.EgressGateway({ props: { allow } });

    if (Option.isSome(clone)) {
      const route = clone.value;

      yield* intercept(() =>
        container.interceptOutboundHttps(
          route.host,
          cloned
            ? egress
            : gateways.CloneGateway({
                props: {
                  remote: route.remote,
                  token: Redacted.value(route.token),
                },
              })
        )
      );
    }

    const opened = Option.match(env, {
      onNone: (): Opened => ({ hosts: [], to: egress }),
      onSome: (route): Opened => ({
        hosts: route.hosts,
        to: gateways.EnvGateway({ props: envProps(route) }),
      }),
    });

    yield* Effect.forEach(
      [...new Set([...proxied, ...opened.hosts])],
      (host) =>
        intercept(() =>
          container.interceptOutboundHttps(
            host,
            opened.hosts.includes(host) ? opened.to : egress
          )
        ),
      { discard: true }
    );

    yield* intercept(() => container.interceptOutboundHttps("*", egress));
    yield* intercept(() => container.interceptAllOutboundHttp(egress));
  });

/** The restored container answers a command, or the snapshot is gone. */
const probe = (container: Container) =>
  Effect.tryPromise({
    catch: failed("the restored container did not answer"),
    try: () => container.exec(["true"]),
  }).pipe(
    Effect.flatMap((process) =>
      Effect.tryPromise({
        catch: failed("the restored container did not answer"),
        try: () => process.output(),
      })
    ),
    Effect.filterOrFail(
      ({ exitCode }) => exitCode === 0,
      ({ exitCode }) =>
        new BoxFailed({
          operation: "exec",
          reason: `the restored container's probe exited ${exitCode}`,
        })
    )
  );

export const SdkChecker = {
  /**
   * `proxied` is every host the job's env route may open (`checker/env.ts`):
   * a host first registered after the catch-all would never be reached.
   */
  layer: (
    container: Container,
    gateways: Gateways,
    index: SnapshotIndex,
    proxied: readonly string[] = []
  ): Layer.Layer<Network | Snapshots> =>
    Layer.effectContext(
      Effect.gen(function* () {
        const routes = yield* Ref.make<Routes>({
          allow: [],
          clone: Option.none(),
          cloned: false,
          env: Option.none(),
          proxied,
        });

        const reinstall = (change: (now: Routes) => Routes) =>
          Effect.flatMap(Ref.updateAndGet(routes, change), (now) =>
            install(container, gateways, now)
          );

        const network = Network.of({
          allow: (hosts) =>
            reinstall((now) => ({ ...now, allow: [...hosts], cloned: true })),
          routeClone: (route) =>
            reinstall((now) => ({ ...now, clone: Option.some(route) })),
          routeEnv: (route) =>
            Effect.andThen(
              Effect.forEach(
                route.hosts.filter((host) => !proxied.includes(host)),
                (host) =>
                  Effect.logWarning(
                    "a proxy host was not reserved: the catch-all takes its requests"
                  ).pipe(Effect.annotateLogs({ host })),
                { discard: true }
              ),
              reinstall((now) => ({ ...now, env: Option.some(route) }))
            ),
        });

        const restoreFrom = (key: string, id: string) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              catch: failed("the container did not stop for a restore"),
              try: () => container.destroy(),
            });

            yield* Effect.try({
              catch: failed("the snapshot did not start"),
              try: () => {
                container.start({
                  containerSnapshot: { id },
                  enableInternet: false,
                  entrypoint: IDLE,
                });
              },
            });

            yield* reinstall((now) => now);
            yield* probe(container);
          }).pipe(
            // A snapshot that will not come back is dropped, so the next
            // check runs setup instead.
            Effect.tapError(() =>
              Effect.ignore(Effect.tryPromise(() => index.forget(key)))
            )
          );

        const snapshots = Snapshots.of({
          restore: (key) =>
            Effect.gen(function* () {
              const id = yield* Effect.tryPromise({
                catch: failed("the snapshot index did not answer"),
                try: () => index.find(key),
              });

              if (id === null) {
                return false;
              }

              yield* restoreFrom(key, id);

              return true;
            }),
          save: (key) =>
            Effect.tryPromise({
              catch: failed("the snapshot was not taken"),
              try: () => container.snapshotContainer({ name: SNAPSHOT_NAME }),
            }).pipe(
              Effect.flatMap(({ id }) =>
                Effect.tryPromise({
                  catch: failed("the snapshot index did not keep it"),
                  try: () => index.keep(key, id),
                })
              )
            ),
        });

        return Context.make(Network, network).pipe(
          Context.add(Snapshots, snapshots)
        );
      })
    ),
};
