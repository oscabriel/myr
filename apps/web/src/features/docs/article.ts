/**
 * A doc's article and its headings. The ids repeat what `rehype-slug` gives
 * the rendered headings (GitHub's slugs, numbered on a repeat), so "On this
 * page" links each one; `test/docs.test.tsx` holds the two equal on every page.
 */
import type { DocPage } from "@repo/agent-kit/docs/index";

export interface DocHeading {
  readonly id: string;
  readonly text: string;
}

/** The Markdown under the page's title and summary, which the page draws itself. */
export const docBody = ({ markdown, summary, title }: DocPage) =>
  markdown.slice(`# ${title}\n\n${summary}\n\n`.length);

const HEADING = /^(?<marks>#{1,6}) (?<source>.+)$/u;

const FENCE = /^(?:```|~~~)/u;

/** A heading's text as it reads on the page: no code ticks, emphasis or link targets. */
const plain = (source: string) =>
  source
    .replaceAll(/\[(?<label>[^\]]*)\]\([^)]*\)/gu, "$<label>")
    .replaceAll(/[`*]/gu, "")
    .trim();

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");

interface Walk {
  readonly fenced: boolean;
  readonly seen: ReadonlyMap<string, number>;
  readonly headings: readonly DocHeading[];
}

const unique = (seen: ReadonlyMap<string, number>, slug: string) => {
  let count = seen.get(slug);
  let id = slug;

  while (seen.has(id)) {
    count = (count ?? 0) + 1;
    id = `${slug}-${count}`;
  }

  return { count: count ?? 0, id };
};

const step = (walk: Walk, line: string): Walk => {
  if (FENCE.test(line)) {
    return { ...walk, fenced: !walk.fenced };
  }

  const found = walk.fenced ? null : HEADING.exec(line);

  if (found?.groups === undefined) {
    return walk;
  }

  const text = plain(found.groups.source ?? "");
  const slug = slugOf(text);
  const { count, id } = unique(walk.seen, slug);
  const seen = new Map(walk.seen).set(slug, count).set(id, 0);

  return {
    fenced: false,
    headings:
      found.groups.marks === "##"
        ? [...walk.headings, { id, text }]
        : walk.headings,
    seen,
  };
};

/** The article's `h2`s, in order, each with the id its rendered heading carries. */
export const docHeadings = (page: DocPage): readonly DocHeading[] =>
  docBody(page)
    .split("\n")
    .reduce<Walk>(step, { fenced: false, headings: [], seen: new Map() })
    .headings;
