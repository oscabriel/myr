/**
 * The plugin chain that turns a project's Markdown into a safe tree, in
 * the one order that makes it safe (ADR 0019). It is the security property
 * of the README renderer, so it lives here alone and is tested whole
 * (`test/markdown.test.tsx`):
 *
 * 1. `remarkGfm`: tables, task lists, strikethrough, autolinks, footnotes;
 * 2. `rehypeRaw`: the README's own HTML (`<p align="center"><img …>`)
 *    becomes elements, so everything after sees it;
 * 3. `rehypeRepoUrls`: relative links and media point into the project at
 *    the SHA (`resolve.ts`), before the sanitizer judges them;
 * 4. `rehypeFootnoteIds`: the footnotes' ids and links lose the
 *    `user-content-` remark-rehype gave them, since the sanitizer gives
 *    every id that prefix next, and twice made `user-content-user-content-
 *    fn-1` while the links named `user-content-fn-1`;
 * 5. `rehypeSanitize` with `schema`: GitHub's allow-list, the last gate on
 *    what comes in (no script, no handler, no `javascript:` or `data:`
 *    URL, no iframe, style or form; every `id` and `name` prefixed
 *    `user-content-`, so a README cannot clobber the page's own globals);
 * 6. `rehypeSlug`: heading ids, after the sanitizer, so `#usage` finds
 *    `## Usage` unprefixed;
 * 7. `rehypeFragmentLinks`: last, once every id is final, a `#x` link with
 *    no `x` in the file points at `user-content-x` when that is there (a
 *    footnote, a README's own `<a id>`), as GitHub's page script does. It
 *    only changes where a link inside the file points, never an id.
 *
 * react-markdown's `defaultUrlTransform` stays on as a second net.
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

/** A list of unified plugins, each with its options, as react-markdown takes them. */
export type PluggableList = NonNullable<Options["rehypePlugins"]>;

/** Where a Markdown file was read: the project, the commit, and the file's directory (`""` is the root). */
export type MarkdownAt = Omit<RepoUrlContext, "kind">;

/**
 * GitHub's allow-list (`hast-util-sanitize`'s `defaultSchema`), with a
 * code block's `language-…` class kept on `code`, and a `style` element
 * dropped with its CSS (the default drops only a `script` whole, so a
 * style's rules would show as text).
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

/** Elements whose URL loads bytes into the page: they read the raw file. */
const media = new Set(["img", "source", "video"]);

/** One `srcset` candidate (`url [descriptor]`), its URL resolved. */
const candidate = (value: string, at: RepoUrlContext) => {
  const [url = "", ...descriptor] = value.trim().split(/\s+/u);

  return [resolveRepoUrl(url, at), ...descriptor].join(" ");
};

/** Rewrite one URL property, when the element carries it as a string. */
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
  // rehype-raw keeps `srcset` as written: one string, candidates split by commas.
  rewrite(node.properties, "srcSet", (srcSet) =>
    srcSet
      .split(",")
      .map((value) => candidate(value, here))
      .join(", ")
  );
};

/**
 * A rehype plugin: every `a[href]` and every `img`, `video` and `source`
 * `src` (and `srcset`) resolved into the project at the SHA.
 */
export const rehypeRepoUrls = (at: MarkdownAt) => (tree: Root) => {
  visit(tree, "element", (node) => {
    resolveElement(node, at);
  });
};

/** The prefix the sanitizer puts on every `id` and `name` (`hast-util-sanitize`'s default). */
const CLOBBER = defaultSchema.clobberPrefix ?? "user-content-";

const unprefixed = (value: string, lead = "") =>
  value.startsWith(`${lead}${CLOBBER}`)
    ? `${lead}${value.slice(lead.length + CLOBBER.length)}`
    : value;

/** Drop the prefix from one property, when the element carries it as a string. */
const unprefix = (properties: Properties, key: "href" | "id", lead = "") => {
  const value = properties[key];

  if (Predicate.isString(value)) {
    properties[key] = unprefixed(value, lead);
  }
};

/**
 * A rehype plugin: the footnotes remark-rehype made (a reference, a
 * footnote's item, a back-reference) lose the prefix it gave their ids and
 * links, so the sanitizer's prefix is their only one.
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
 * A rehype plugin, run last: a link to `#x` where the file has no `x` but
 * has `user-content-x` (the sanitizer's prefix) points there, so a
 * footnote and a README's own anchor jump.
 */
export const rehypeFragmentLinks = () => (tree: Root) => {
  const ids = new Set<string>();

  visit(tree, "element", (node) => {
    const { id } = node.properties;

    if (Predicate.isString(id)) {
      ids.add(id);
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

export const remarkPlugins: PluggableList = [remarkGfm];

/** The rehype half of the chain for one file, in its fixed order. */
export const rehypePluginsFor = (at: MarkdownAt): PluggableList => [
  rehypeRaw,
  [rehypeRepoUrls, at],
  rehypeFootnoteIds,
  [rehypeSanitize, schema],
  rehypeSlug,
  rehypeFragmentLinks,
];
