/**
 * Kept apart from the view: a route's `head` runs before its page's view loads,
 * so the Markdown renderer stays off every page's first load.
 */
import type { DocEntry } from "@repo/agent-kit/docs/entries";

import { markdownAlternateLink } from "../front/markdown.ts";
import { pageHead } from "../shared/head.ts";
import { docsPath } from "../shared/paths.ts";

export const docsMarkdownPath = (slug: string) => `${docsPath(slug)}.md`;

export const docsHead = (page: DocEntry) => ({
  ...pageHead({ description: page.summary, title: page.title }),
  links: [markdownAlternateLink(docsMarkdownPath(page.slug))],
});

export const docsIndexHead = () =>
  pageHead({
    description: "Guides, and a reference read from the platform's schema.",
    title: "Docs",
  });
