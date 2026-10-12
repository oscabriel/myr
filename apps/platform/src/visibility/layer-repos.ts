import type { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostBinding } from "@repo/artifacts/repo-host/binding";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";

export const layerRepos = (
  config: PlatformConfig
): Layer.Layer<LayerRepos, never, Fetch> =>
  Layer.effect(
    LayerRepos,
    RepoHost.useSync((host) => LayerRepos.of(host))
  ).pipe(Layer.provide(RepoHostBinding.layer(config.ARTIFACTS_PRIVATE)));
