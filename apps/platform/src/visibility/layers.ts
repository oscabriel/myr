import type { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Upstream } from "@repo/git/upstream";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { Projects } from "@repo/project/projects";
import { LayerName, nameOfKey, ProjectKey } from "@repo/protocol/ids";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Effect, Layer, Option, Schema } from "effect";

import { LayerGate } from "../layer-gate.ts";
import type { LayerTarget } from "../layer-gate.ts";
import type { PlatformConfig } from "../platform.ts";
import { layerRepos } from "./layer-repos.ts";

const asKey = Schema.decodeOption(ProjectKey);

const asProject = (first: string) => Option.flatMap(asKey(first), nameOfKey);

const asLayer = Schema.decodeOption(LayerName);

const spelled = (repo: string): Option.Option<LayerTarget> => {
  const [first = "", second = "", ...rest] = repo.split("--");

  return rest.length > 0
    ? Option.none()
    : Option.all({ layer: asLayer(second), project: asProject(first) });
};

// Fresh: a layer built twice in one memo map is shared, and the core ports build
// `UpstreamRepoHost` over the public namespace.
const privateUpstream: Layer.Layer<Upstream, never, LayerRepos | Fetch> =
  Layer.fresh(UpstreamRepoHost).pipe(
    Layer.provide(Layer.effect(RepoHost, LayerRepos.useSync(RepoHost.of)))
  );

export const LayerGateLive: Layer.Layer<
  never,
  never,
  Projects | LayerRepos | Fetch
> = Layer.effect(
  LayerGate,
  Effect.gen(function* () {
    const projects = yield* Projects;
    const upstream = yield* Upstream;

    return LayerGate.of({
      classify: (repo, who) =>
        Option.match(spelled(repo), {
          onNone: () => Effect.succeedNone,
          onSome: (target) =>
            projects.get(target.project).pipe(
              Effect.flatMap((api) => api.layerAccess(who, target.layer)),
              Effect.map(Option.map((access) => ({ access, target }))),
              Effect.catchTag("UnknownProject", () => Effect.succeedNone)
            ),
        }),
      upstream,
    });
  })
).pipe(Layer.provide(privateUpstream));

export const layersLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Projects | Fetch> =>
  LayerGateLive.pipe(Layer.provide(layerRepos(config)));
