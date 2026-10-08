/**
 * The visibility cartridge's project state (W6; 612 builds it): layers
 * provisioned in the private namespace, posture changes, commitments, the
 * suite pinned at claim, attempt caps and the public ledger, as the
 * `ProjectVisibility` port.
 *
 * A stub until 612: it answers the port's neutral defaults (Open, no
 * layers, nothing held back, an empty ledger), over the private
 * namespace's repos it will read, so the platform composes it as it will
 * compose the real one.
 */
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Layer } from "effect";

import { noVisibility, ProjectVisibility } from "../visibility-port.ts";

export const ProjectVisibilityLive: Layer.Layer<never, never, LayerRepos> =
  Layer.effect(
    ProjectVisibility,
    LayerRepos.useSync(() => noVisibility)
  );
