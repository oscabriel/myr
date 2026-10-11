/**
 * The visibility cartridge's gateway side (ADR 0007),
 * as the `LayerGate` port: which repo names are a project's declared
 * layers, how far a person reaches into one, and the private namespace's
 * git server behind them.
 *
 * - A name is a layer's repo when it reads `<project>--<layer>`
 *   and the project declares that layer, from the policy at its landed SHA
 *   (ADR 0005): any other such name stays an unknown repo, and claim forks
 *   and working forks never get here (their names have three parts).
 * - Access comes in the same answer (`ProjectApi.layerAccess`, one DO call
 *   per request): the layer's readers clone it, its writers push to it, and
 *   nobody else reaches it.
 * - The upstream is git's `UpstreamRepoHost` over the private namespace's
 *   repos (`LayerRepos`): its tokens are minted, cached once per isolate
 *   and sent only to the store, so none leaves the platform.
 */
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

// A layer repo's first part is its project's key (ADR 0032).
const asProject = (first: string) => Option.flatMap(asKey(first), nameOfKey);

const asLayer = Schema.decodeOption(LayerName);

/** The project and layer a name `<project>--<layer>` spells, if it spells one. */
const spelled = (repo: string): Option.Option<LayerTarget> => {
  const [first = "", second = "", ...rest] = repo.split("--");

  return rest.length > 0
    ? Option.none()
    : Option.all({ layer: asLayer(second), project: asProject(first) });
};

/**
 * git's upstream over the private namespace, its tokens minted and cached
 * there. Fresh: the core ports build `UpstreamRepoHost` over the public
 * namespace, and a layer built twice in one memo map is shared, so without
 * it the gate would ask the public namespace for every layer repo (found
 * live by 699: every layer clone on a stage answered "no repo").
 */
const privateUpstream: Layer.Layer<Upstream, never, LayerRepos | Fetch> =
  Layer.fresh(UpstreamRepoHost).pipe(
    Layer.provide(Layer.effect(RepoHost, LayerRepos.useSync(RepoHost.of)))
  );

/**
 * The live gate: layers as each project's DO declares them, and the
 * private namespace's upstream, built once with the layer.
 */
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
      // The DO answers none for a layer its project does not declare, and
      // `none` access to someone not signed in.
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

/** The live gate for one stage: the private namespace through `ARTIFACTS_PRIVATE`. */
export const layersLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Projects | Fetch> =>
  LayerGateLive.pipe(Layer.provide(layerRepos(config)));
