// The site has no logomark: wherever a file must stand for it (the tab's icon, a home screen's, the manifest's),
// it draws the repeat button emoji as text on the paper, and each raster is that drawing at its size.
import { describe, expect, it } from "@effect/vitest";

import svg from "../public/icons/icon.svg?raw";
import { themeColors } from "../src/features/shared/theme.ts";

const rasters: Readonly<Record<string, string>> = import.meta.glob(
  "../public/**/*.{png,ico}",
  { eager: true, import: "default", query: "?inline" }
);

const REPEAT_BUTTON = "\u{1F501}";

const bytesOf = (path: string) => {
  const url = rasters[path] ?? "";

  return Uint8Array.from(
    atob(url.slice(url.indexOf(",") + 1)),
    (char) => char.codePointAt(0) ?? 0
  );
};

// A PNG's IHDR holds its width and height as big-endian words at bytes 16 and 20.
const pngSize = (path: string) => {
  const view = new DataView(bytesOf(path).buffer);

  return [view.getUint32(16), view.getUint32(20)];
};

// An ICO lists one 16-byte entry per image after its 6-byte header; a 0 byte means 256.
const icoSizes = (path: string) => {
  const bytes = bytesOf(path);
  const count = bytes[4] ?? 0;

  return Array.from(
    { length: count },
    (_, index) => bytes[6 + index * 16] ?? 0
  );
};

describe("the site's icon", () => {
  it("draws the repeat button emoji as text, and no shape of its own", () => {
    expect(svg).toMatch(
      new RegExp(`<text\\b[^>]*>${REPEAT_BUTTON}</text>`, "u")
    );
    expect(svg).not.toMatch(
      /<(?:path|polygon|polyline|circle|ellipse|line)\b/u
    );
  });

  it("lays the emoji on the light paper", () => {
    expect(svg).toContain(`fill="${themeColors.light}"`);
  });

  it("keeps each raster at the size its place asks for", () => {
    expect(pngSize("../public/apple-touch-icon.png")).toStrictEqual([180, 180]);
    expect(pngSize("../public/icons/icon-192.png")).toStrictEqual([192, 192]);
    expect(pngSize("../public/icons/icon-512.png")).toStrictEqual([512, 512]);
    expect(icoSizes("../public/favicon.ico")).toStrictEqual([16, 32, 48]);
  });
});
