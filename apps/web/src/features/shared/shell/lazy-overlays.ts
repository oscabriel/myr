/**
 * The shell's overlays (`overlays.tsx`) and a code page's facts sheet
 * (`facts-sheet.tsx`), fetched once the page is up: the Worker never
 * renders one (an overlay opens on a press), and no page's first load
 * carries their dialog, sheet and combobox code.
 */
import { lazy } from "react";

export const LazyOverlays = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./overlays.tsx"));

export const LazyFactsSheet = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./facts-sheet.tsx"));
