/**
 * `vite.config.ts` writes this into the client output as `manifest.webmanifest`
 * at each build, so no file spells the name.
 */
import { Brand } from "@repo/brand";

import { themeColors } from "../shared/theme.ts";

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

export const MANIFEST_PATH = "/manifest.webmanifest";

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

export const webManifestText = () =>
  `${JSON.stringify(webManifest(), null, 2)}\n`;
