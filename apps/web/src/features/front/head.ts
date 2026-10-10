/**
 * What the list pages put in their head and their first lines, in a module
 * with no view of its own: a route's `head` runs with the route, before its
 * page's view loads, so a view's imports (the Markdown renderer) stay out of
 * every page's first load.
 */

/** What an ask is, and how one lands: the page's one sentence. */
export const EXPLAINER =
  "Each ask is one change a project wants, with a check that fails on its main today. Claim one, make the check pass, and push: the gate lands it.";

/** A block that is no paragraph of prose: a heading, a quote, a table, a list, a fence, HTML, an image. */
const NOT_PROSE = /^(?:#|>|\||[-*+]\s|\d+[.)]\s|```|~~~|<|!\[|\[!\[)/u;

/** A paragraph's inline Markdown as plain words: links and code as their text, emphasis dropped. */
const plainWords = (text: string) =>
  text
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replaceAll(/\[(?<label>[^\]]*)\]\([^)]*\)/gu, "$<label>")
    .replaceAll(/`(?<code>[^`]*)`/gu, "$<code>")
    .replaceAll(
      /(?<mark>\*\*|__|\*|_)(?<words>\S(?:.*?\S)?)\k<mark>/gu,
      "$<words>"
    )
    .replaceAll(/\s+/gu, " ")
    .trim();

/**
 * A README's first sentence, as plain words: the first paragraph of prose
 * (past its title, badges, quotes, tables and lists), to its first full
 * stop. None when the README opens with no paragraph of prose.
 */
export const ledeOf = (text: string): string | undefined => {
  const paragraph = text
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .find((block) => block !== "" && !NOT_PROSE.test(block));

  if (paragraph === undefined) {
    return undefined;
  }

  const words = plainWords(paragraph);
  const end = /[.!?](?=\s|$)/u.exec(words);
  const sentence = end === null ? words : words.slice(0, end.index + 1);

  return sentence === "" ? undefined : sentence;
};
