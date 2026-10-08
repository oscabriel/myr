/**
 * The visibility cartridge's project state, as the platform provides it
 * (W6; 612 fills it in): the project service's `ProjectVisibility` over the
 * private namespace's repos, and the salt source its commitments take
 * (WebCrypto randomness, at the platform's edge).
 */
import type { Fetch } from "@repo/artifacts/fetch";
import { ProjectVisibilityLive } from "@repo/project/visibility/state";
import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";
import { layerRepos } from "./layer-repos.ts";

export const stateLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Fetch> =>
  ProjectVisibilityLive.pipe(Layer.provide(layerRepos(config)));
