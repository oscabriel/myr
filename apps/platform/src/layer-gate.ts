/**
 * The gateway's neutral port for layer repos (W6 609; ADR 0007): which repo
 * names are a project's layers, how far a person may reach into one, and
 * the private namespace's git server behind them. The default is a
 * platform without typed visibility: no name is a layer, so a layer's URL
 * is an unknown repo (404), and nothing routes to the private namespace.
 *
 * The visibility cartridge (`./visibility/layers.ts`, 606) provides the live
 * gate: a name `<project>--<layer>` the project declares, access from the
 * layer's readers and writers through the project's DO, and the private
 * namespace's upstream. The gateway (`git.ts`) and custody
 * (`adapters/custody.ts`) depend on this port only.
 */
import { RepoNotFound } from "@repo/artifacts/repo-host";
import type { RepoName } from "@repo/artifacts/repo-host";
import { Upstream } from "@repo/git/upstream";
import type { LayerAccess } from "@repo/project/visibility-port";
import type { LayerName, ProjectName } from "@repo/protocol/ids";
import type { Person } from "@repo/protocol/principal";
import type { Option } from "effect";
import { Context, Effect, Layer } from "effect";

/** A layer repo, by the project that declares it and the layer's name. */
export interface LayerTarget {
  readonly layer: LayerName;
  readonly project: ProjectName;
}

/** The gateway's view of layer repos. */
export interface LayerGatePort {
  /** The layer a repo name is, when its project declares one by that name; none for every other name. */
  readonly classify: (
    repo: RepoName
  ) => Effect.Effect<Option.Option<LayerTarget>>;
  /** How far a signed-in person may reach into a layer: a clone needs `read`, a push `write`. */
  readonly access: (
    who: Person,
    target: LayerTarget
  ) => Effect.Effect<LayerAccess>;
  /** The git server behind the layer repos: the private namespace, with the platform's own credentials. */
  readonly upstream: Upstream["Service"];
}

/** A platform without layers: no repo name is one, and no layer repo exists. */
export const noLayers: LayerGatePort = {
  access: () => Effect.succeed("none"),
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
