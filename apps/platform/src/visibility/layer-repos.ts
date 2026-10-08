/**
 * The private namespace's repos (OSR §5.1): every project's layer repos,
 * through the platform's second Artifacts binding, `ARTIFACTS_PRIVATE`, as
 * `LayerRepos` (a `RepoHost` under its own tag, so nothing that asks for the
 * public one is handed it). Only this Worker binds the namespace; the
 * Workers that serve public pages bind none (principle 7).
 */
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
