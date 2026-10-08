/**
 * The visibility cartridge's gateway side (W6; 606 builds it): which repo
 * names are a project's declared layers, who may clone or push them (the
 * layer's readers and writers, through the project's DO), and the private
 * namespace's upstream, as the `LayerGate` port.
 *
 * A stub until 606: no name is a layer's, so a layer's URL stays an
 * unknown repo.
 */
import { Layer } from "effect";

import { LayerGate, noLayers } from "../layer-gate.ts";
import type { PlatformConfig } from "../platform.ts";

export const layersLive = (_config: PlatformConfig): Layer.Layer<never> =>
  Layer.succeed(LayerGate, noLayers);
