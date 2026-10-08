/**
 * The gateway's neutral port for layer repos (ADR 0007): which repo
 * names are a project's layers, how far a person may reach into one, and
 * the private namespace's git server behind them. The default is a
 * platform without typed visibility: no name is a layer, so a layer's URL
 * is an unknown repo (404), and nothing routes to the private namespace.
 *
 * The visibility cartridge (`./visibility/layers.ts`) provides the live
 * gate: a name `<project>--<layer>` the project declares, with the caller's
 * access from the layer's readers and writers, both in one ask of the
 * project's DO, and the private namespace's upstream. The gateway (`git.ts`)
 * and custody (`adapters/custody.ts`) depend on this port only.
 */
import { RepoNotFound } from "@repo/artifacts/repo-host";
import type { RepoName } from "@repo/artifacts/repo-host";
import { Upstream } from "@repo/git/upstream";
import type { LayerAccess } from "@repo/project/visibility-port";
import type { LayerName, ProjectName } from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import type { Option } from "effect";
import { Context, Effect, Layer } from "effect";

/** A layer repo, by the project that declares it and the layer's name. */
export interface LayerTarget {
  readonly layer: LayerName;
  readonly project: ProjectName;
}

/** A layer repo a request names, and how far its caller reaches into the layer. */
export interface LayerReach {
  /** A clone needs `read`, a push `write`; someone not signed in reaches `none`. */
  readonly access: LayerAccess;
  readonly target: LayerTarget;
}

/** The gateway's view of layer repos. */
export interface LayerGatePort {
  /**
   * The layer a repo name is, when its project declares one by that name,
   * with how far `who` reaches into it: one question to the project per
   * request. None for every other name.
   */
  readonly classify: (
    repo: RepoName,
    who: Principal
  ) => Effect.Effect<Option.Option<LayerReach>>;
  /** The git server behind the layer repos: the private namespace, with the platform's own credentials. */
  readonly upstream: Upstream["Service"];
}

/** A platform without layers: no repo name is one, and no layer repo exists. */
export const noLayers: LayerGatePort = {
  classify: () => Effect.succeedNone,
  upstream: Upstream.of({
    exchange: (repo) => Effect.fail(new RepoNotFound({ name: repo })),
  }),
};

/**
 * How a host gives the gateway layer repos. The default is `noLayers`, so a
 * platform composed without the visibility cartridge serves none.
 */
export const LayerGate = Context.Reference<LayerGatePort>(
  "platform/LayerGate",
  {
    defaultValue: () => noLayers,
  }
);

/** The default, said out loud: no layer repos. */
export const NoLayers: Layer.Layer<never> = Layer.succeed(LayerGate, noLayers);
