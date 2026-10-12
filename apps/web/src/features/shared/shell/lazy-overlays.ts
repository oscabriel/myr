/**
 * Fetched once the page is up: the Worker never renders one, and no page's
 * first load carries their dialog, sheet and combobox code.
 */
import { lazy } from "react";

export const LazyOverlays = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./overlays.tsx"));

export const LazyFactsSheet = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./facts-sheet.tsx"));
