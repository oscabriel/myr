/**
 * `vite.config.ts` writes this into the client output as `manifest.webmanifest`
 * at each build, so no file spells the name.
 */
import { Brand } from "@repo/brand";

import { INBOX_PATH } from "../shared/paths.ts";
import { themeColors } from "../shared/theme.ts";

const rasters = [192, 512] as const;

// The emoji fills its square, so no raster is offered as maskable: a launcher's mask would cut its corners.
const icons = [
  ...rasters.map((size) => ({
    purpose: "any",
    sizes: `${size}x${size}`,
    src: `/icons/icon-${size}.png`,
    type: "image/png",
  })),
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
  description: `Open asks, answers and your inbox on ${Brand.name}.`,
  display: "standalone",
  icons,
  // The installed app's identity, kept from when it opened Today: a new id would install it again.
  id: "/today",
  lang: "en",
  name: Brand.name,
  scope: "/",
  short_name: Brand.name,
  start_url: INBOX_PATH,
  theme_color: themeColors.light,
});

export const webManifestText = () =>
  `${JSON.stringify(webManifest(), null, 2)}\n`;
