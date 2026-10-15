// The router keeps one meta per name (or Open Graph property), the last a route gives, so a page's replace the root's.
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";

import { pageHead } from "../src/features/shared/head.ts";
import { OG_IMAGE_URL, rootHead } from "../src/routes/__root.tsx";

const keyOf = (meta: Readonly<Record<string, string>>) =>
  meta.name ?? meta.property ?? (meta.title === undefined ? "" : "title");

const metasOf = (head: {
  readonly meta: readonly Readonly<Record<string, string>>[];
}) =>
  Object.fromEntries(
    head.meta.map((meta) => [keyOf(meta), meta.content ?? meta.title])
  );

describe(pageHead, () => {
  it("titles the page, then the product, and gives one meta per name for the unfurl", () => {
    const head = pageHead({
      description: "Format a date as an ordinal, in English.",
      title: "format-ordinal · datekit",
    });

    expect(metasOf(head)).toStrictEqual({
      description: "Format a date as an ordinal, in English.",
      "og:description": "Format a date as an ordinal, in English.",
      "og:title": "format-ordinal · datekit",
      "og:type": "website",
      title: `format-ordinal · datekit · ${Brand.name}`,
    });
    expect(head.meta.map(keyOf)).toStrictEqual([
      ...new Set(head.meta.map(keyOf)),
    ]);
  });

  it("names an article as one, and leaves the root's description in place when it has none", () => {
    const head = pageHead({ title: "Ledger", type: "article" });

    expect(metasOf(head)).toStrictEqual({
      "og:title": "Ledger",
      "og:type": "article",
      title: `Ledger · ${Brand.name}`,
    });
  });
});

describe("the root's head", () => {
  it("carries a default description, so no page unfurls bare", () => {
    const metas = metasOf(rootHead());

    expect(metas.description).toMatch(/\S{3,}/u);
    expect(metas["og:description"]).toBe(metas.description);
    expect(metas["og:title"]).toBe(Brand.name);
    expect(metas["og:type"]).toBe("website");
  });

  it("gives every page the card as a large image, at its absolute URL", () => {
    const metas = metasOf(rootHead());

    expect(metas["og:image"]).toBe(OG_IMAGE_URL);
    expect(new URL(OG_IMAGE_URL).pathname).toBe("/og.png");
    expect(metas["twitter:card"]).toBe("summary_large_image");
  });
});
