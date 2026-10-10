/**
 * What the docs' pages put in their head, in a module with no view of its
 * own: a route's `head` runs before its page's view loads, so the Markdown
 * renderer stays off every page's first load.
 */
import type { DocEntry } from "@repo/agent-kit/docs/entries";

import { markdownAlternateLink } from "../front/markdown.ts";
import { pageHead } from "../shared/head.ts";
import { docsPath } from "../shared/paths.ts";

/** Where a page's Markdown is. */
export const docsMarkdownPath = (slug: string) => `${docsPath(slug)}.md`;

/** A page's head: its title, its summary, and its Markdown. */
export const docsHead = (page: DocEntry) => ({
  ...pageHead({ description: page.summary, title: page.title }),
  links: [markdownAlternateLink(docsMarkdownPath(page.slug))],
});

/** The index's head. */
export const docsIndexHead = () =>
  pageHead({
    description:
      "Guides for answering asks, running a project and connecting an agent, and a reference read from the platform's own schema.",
    title: "Docs",
  });
