/**
 * `Network` and `Snapshots` over a Durable Object's own container, as the
 * Container API runs one (`ctx.container`; Sandbox SDK 1.0 leaves both to
 * it, W3 315 Comments):
 *
 * - the network is the container's outbound intercepts. The container starts
 *   with the internet off, so a request leaves only through an intercept:
 *   the clone host goes to `CloneGateway`, registered first so it keeps its
 *   requests, and every other host, HTTPS (`*`) and HTTP, to `EgressGateway`,
 *   whose props say what it lets out. Registering a target again replaces its
 *   handler, which is how the allow-list changes, how the clone route closes
 *   once setup starts, and how egress goes off.
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
import type { CloneProps, EgressProps } from "../outbound.ts";
import { Network } from "./network.ts";
import type { CloneRoute } from "./network.ts";
import { Snapshots } from "./snapshots.ts";

/**
 * The outbound entrypoints' loopbacks: `ctx.exports` holds one per export of
 * the Worker's main module.
 */
export interface Gateways {
  readonly CloneGateway: (options: { readonly props: CloneProps }) => Fetcher;
  readonly EgressGateway: (options: { readonly props: EgressProps }) => Fetcher;
}

/** Whether `ctx.exports` holds both gateways: `worker.ts` must export them. */
export const hasGateways = (
  exports: Cloudflare.Exports
): exports is Cloudflare.Exports & Gateways =>
  Predicate.hasProperty(exports, "CloneGateway") &&
  Predicate.isFunction(exports.CloneGateway) &&
  Predicate.hasProperty(exports, "EgressGateway") &&
  Predicate.isFunction(exports.EgressGateway);

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
 * Points the container's intercepts where `routes` says: the clone host to
 * the clone gateway (or, once the clone is done, to the egress gateway, which
 * refuses it), and every other host, HTTPS and HTTP, to an egress gateway
 * allowing `allow`.
 */
const install = (
  container: Container,
  gateways: Gateways,
  { allow, clone, cloned }: Routes
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
  layer: (
    container: Container,
    gateways: Gateways,
    index: SnapshotIndex
  ): Layer.Layer<Network | Snapshots> =>
    Layer.effectContext(
      Effect.gen(function* () {
        const routes = yield* Ref.make<Routes>({
          allow: [],
          clone: Option.none(),
          cloned: false,
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
