/**
 * The web app manifest (issue 505), so Today installs on a phone. No file
 * spells the name: `vite.config.ts` writes this into the client output as
 * `manifest.webmanifest` at each build, from `Brand.name`. The colours are
 * the paper's (`features/shared/theme.ts`); the icons are the files under
 * `public/icons/`, drawn from `icon.svg`, with the mark inside the maskable
 * safe zone, so one drawing serves both purposes.
 */
import { Brand } from "@repo/brand";

import { themeColors } from "../shared/theme.ts";

/** Each raster icon, by its size in pixels. */
const rasters = [192, 512] as const;

const icons = [
  ...rasters.flatMap((size) =>
    (["any", "maskable"] as const).map((purpose) => ({
      purpose,
      sizes: `${size}x${size}`,
      src: `/icons/icon-${size}.png`,
      type: "image/png",
    }))
  ),
  {
    purpose: "any",
    sizes: "any",
    src: "/icons/icon.svg",
    type: "image/svg+xml",
  },
];

/** Where the manifest is served, as the root route's `<link rel="manifest">` names it. */
export const MANIFEST_PATH = "/manifest.webmanifest";

/** The manifest, as JSON a browser reads. */
export const webManifest = () => ({
  background_color: themeColors.light,
  description: `Open asks, answers and a decider's Today on ${Brand.name}.`,
  display: "standalone",
  icons,
  id: "/today",
  lang: "en",
  name: Brand.name,
  scope: "/",
  short_name: Brand.name,
  start_url: "/today",
  theme_color: themeColors.light,
});

/** The manifest's text, as the build writes it. */
export const webManifestText = () =>
  `${JSON.stringify(webManifest(), null, 2)}\n`;
