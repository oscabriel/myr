import { RepoNotFound } from "@repo/artifacts/repo-host";
import type { RepoName } from "@repo/artifacts/repo-host";
import { Upstream } from "@repo/git/upstream";
import type { LayerAccess } from "@repo/project/visibility-port";
import type { LayerName, ProjectName } from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import type { Option } from "effect";
import { Context, Effect, Layer } from "effect";

export interface LayerTarget {
  readonly layer: LayerName;
  readonly project: ProjectName;
}

export interface LayerReach {
  readonly access: LayerAccess;
  readonly target: LayerTarget;
}

export interface LayerGatePort {
  readonly classify: (
    repo: RepoName,
    who: Principal
  ) => Effect.Effect<Option.Option<LayerReach>>;
  readonly upstream: Upstream["Service"];
}

export const noLayers: LayerGatePort = {
  classify: () => Effect.succeedNone,
  upstream: Upstream.of({
    exchange: (repo) => Effect.fail(new RepoNotFound({ name: repo })),
  }),
};

export const LayerGate = Context.Reference<LayerGatePort>(
  "platform/LayerGate",
  {
    defaultValue: () => noLayers,
  }
);

export const NoLayers: Layer.Layer<never> = Layer.succeed(LayerGate, noLayers);
