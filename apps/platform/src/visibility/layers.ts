/**
 * The visibility cartridge's gateway side (W6 606; OSR §5.1–5.2, ADR 0007),
 * as the `LayerGate` port: which repo names are a project's declared
 * layers, how far a person reaches into one, and the private namespace's
 * git server behind them.
 *
 * - A name is a layer's repo when it reads `<project>--<layer>` and the
 *   project declares that layer. The project's DO answers both (spec §4.5),
 *   from the policy at its landed SHA (ADR 0005): any other such name stays
 *   an unknown repo, and claim forks and working forks never get here
 *   (their names have three parts).
 * - Access is the DO's too (`ProjectApi.layerAccess`): the layer's readers
 *   clone it, its writers push to it, and nobody else reaches it.
 * - The upstream is git's `UpstreamRepoHost` over the private namespace's
 *   repos (`LayerRepos`): its tokens are minted, cached once per isolate
 *   (S7 #2) and sent only to the store, so none leaves the platform.
 */
import type { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Upstream } from "@repo/git/upstream";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { Projects } from "@repo/project/projects";
import { LayerName, ProjectName } from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import type { Principal } from "@repo/protocol/principal";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Effect, Layer, Option, Schema } from "effect";

import { LayerGate } from "../layer-gate.ts";
import type { LayerTarget } from "../layer-gate.ts";
import type { PlatformConfig } from "../platform.ts";
import { layerRepos } from "./layer-repos.ts";

const asProject = Schema.decodeOption(ProjectName);

const asLayer = Schema.decodeOption(LayerName);

/** The project and layer a name `<project>--<layer>` spells, if it spells one. */
const spelled = (repo: string): Option.Option<LayerTarget> => {
  const [first = "", second = "", ...rest] = repo.split("--");

  return rest.length > 0
    ? Option.none()
    : Option.all({ layer: asLayer(second), project: asProject(first) });
};

/** git's upstream over the private namespace, its tokens minted and cached there. */
const privateUpstream: Layer.Layer<Upstream, never, LayerRepos | Fetch> =
  UpstreamRepoHost.pipe(
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

    /** How far `who` reaches into the layer; none when its project declares no such layer, or does not exist. */
    const reach = (who: Principal, target: LayerTarget) =>
      projects.get(target.project).pipe(
        Effect.flatMap((api) => api.layerAccess(who, target.layer)),
        Effect.catchTag("UnknownProject", () => Effect.succeedNone)
      );

    return LayerGate.of({
      access: (who, target) =>
        Effect.map(
          reach(who, target),
          Option.getOrElse(() => "none" as const)
        ),
      // Someone not signed in reaches into no layer, so the answer says
      // only whether the project declares it.
      classify: (repo) =>
        Option.match(spelled(repo), {
          onNone: () => Effect.succeedNone,
          onSome: (target) =>
            Effect.map(reach(Anonymous.make({}), target), (declared) =>
              Option.as(declared, target)
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
