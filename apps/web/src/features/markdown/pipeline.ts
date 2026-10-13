/**
 * The order is the security property: 1. `remarkGfm`; 2. `rehypeRaw`, so
 * everything after sees the README's own HTML; 3. `rehypeRepoUrls`, before the
 * sanitizer judges the URLs; 4. `rehypeFootnoteIds`, dropping remark-rehype's
 * `user-content-` prefix, which the sanitizer adds next; 5. `rehypeSanitize`
 * with `schema`, the last gate (no script, handler, `javascript:` or `data:`
 * URL, iframe, style or form; every `id` and `name` prefixed, so a README
 * cannot clobber the page's globals); 6. `rehypeSlug`, after the sanitizer, so
 * `#usage` finds `## Usage` unprefixed; 7. `rehypeFragmentLinks`, once
 * every id is final; 8. `rehypeShiftHeadings`, a README's only, which moves no
 * id or URL. react-markdown's `defaultUrlTransform` stays on as a second net.
 */
import { Predicate } from "effect";
import type { Element, Properties, Root } from "hast";
import type { Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as Schema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

import { resolveRepoUrl } from "./resolve.ts";
import type { RepoUrlContext } from "./resolve.ts";

export type PluggableList = NonNullable<Options["rehypePlugins"]>;

export type MarkdownAt = Omit<RepoUrlContext, "kind">;

/**
 * A code block's `language-…` class is kept, and a `style` element is dropped
 * with its CSS (the default drops only a `script` whole, so a style's rules
 * would show as text).
 */
export const schema: Schema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip ?? []), "style"],
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./u],
    ],
  },
};

const media = new Set(["img", "source", "video"]);

const candidate = (value: string, at: RepoUrlContext) => {
  const [url = "", ...descriptor] = value.trim().split(/\s+/u);

  return [resolveRepoUrl(url, at), ...descriptor].join(" ");
};

const rewrite = (
  properties: Properties,
  key: "href" | "src" | "srcSet",
  to: (value: string) => string
) => {
  const value = properties[key];

  if (Predicate.isString(value)) {
    properties[key] = to(value);
  }
};

const resolveElement = (node: Element, at: MarkdownAt) => {
  if (node.tagName === "a") {
    rewrite(node.properties, "href", (href) =>
      resolveRepoUrl(href, { ...at, kind: "link" })
    );
  }

  if (!media.has(node.tagName)) {
    return;
  }

  const here = { ...at, kind: "media" } as const;

  rewrite(node.properties, "src", (src) => resolveRepoUrl(src, here));
  // rehype-raw keeps `srcset` as written: one string, candidates split by
  // commas.
  rewrite(node.properties, "srcSet", (srcSet) =>
    srcSet
      .split(",")
      .map((value) => candidate(value, here))
      .join(", ")
  );
};

export const rehypeRepoUrls = (at: MarkdownAt) => (tree: Root) => {
  visit(tree, "element", (node) => {
    resolveElement(node, at);
  });
};

const CLOBBER = schema.clobberPrefix ?? "user-content-";

const unprefixed = (value: string, lead = "") =>
  value.startsWith(`${lead}${CLOBBER}`)
    ? `${lead}${value.slice(lead.length + CLOBBER.length)}`
    : value;

const unprefix = (properties: Properties, key: "href" | "id", lead = "") => {
  const value = properties[key];

  if (Predicate.isString(value)) {
    properties[key] = unprefixed(value, lead);
  }
};

/**
 * So the sanitizer's prefix is their only one; twice made
 * `user-content-user-content-fn-1`.
 */
export const rehypeFootnoteIds = () => (tree: Root) => {
  visit(tree, "element", (node, _index, parent) => {
    const { properties } = node;

    if (node.tagName === "a" && properties.dataFootnoteRef !== undefined) {
      unprefix(properties, "id");
      unprefix(properties, "href", "#");
    }

    if (node.tagName === "a" && properties.dataFootnoteBackref !== undefined) {
      unprefix(properties, "href", "#");
    }

    if (
      node.tagName === "ol" &&
      parent?.type === "element" &&
      parent.properties.dataFootnotes !== undefined
    ) {
      for (const item of node.children) {
        if (item.type === "element" && item.tagName === "li") {
          unprefix(item.properties, "id");
        }
      }
    }
  });
};

/**
 * As GitHub's page script does: a link to `#x` where the file has no `x` but
 * has `user-content-x` points there.
 */
export const rehypeFragmentLinks = () => (tree: Root) => {
  const ids = new Set<string>();

  visit(tree, "element", (node) => {
    const { id, name } = node.properties;

    if (Predicate.isString(id)) {
      ids.add(id);
    }

    if (node.tagName === "a" && Predicate.isString(name)) {
      ids.add(name);
    }
  });

  visit(tree, "element", (node) => {
    const { href } = node.properties;

    if (node.tagName !== "a" || !Predicate.isString(href)) {
      return;
    }

    if (!href.startsWith("#")) {
      return;
    }

    const target = href.slice(1);

    if (!ids.has(target) && ids.has(`${CLOBBER}${target}`)) {
      node.properties.href = `#${CLOBBER}${target}`;
    }
  });
};

const SHIFTED = new Map([
  ["h1", "h2"],
  ["h2", "h3"],
  ["h3", "h4"],
  ["h4", "h5"],
  ["h5", "h6"],
]);

/**
 * A README sits under the page's own h1 (the project's name), so its headings
 * go down a level: its `# name` reads as an h2, and an h6 stays an h6.
 */
export const rehypeShiftHeadings = () => (tree: Root) => {
  visit(tree, "element", (node) => {
    node.tagName = SHIFTED.get(node.tagName) ?? node.tagName;
  });
};

export const remarkPlugins: PluggableList = [remarkGfm];

export const rehypePluginsFor = (at: MarkdownAt): PluggableList => [
  rehypeRaw,
  [rehypeRepoUrls, at],
  rehypeFootnoteIds,
  [rehypeSanitize, schema],
  rehypeSlug,
  rehypeFragmentLinks,
  rehypeShiftHeadings,
];

export const sitePlugins: PluggableList = [
  [rehypeSanitize, schema],
  rehypeSlug,
  rehypeFragmentLinks,
];
