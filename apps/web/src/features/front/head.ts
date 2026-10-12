/**
 * Kept apart from the views: a route's `head` runs before its page's view
 * loads, so the Markdown renderer stays out of every page's first load.
 */

export const EXPLAINER =
  "Each ask is one change a project wants, with a check that fails on its main today. Claim one, make the check pass, and push: the gate lands it.";

const NOT_PROSE = /^(?:#|>|\||[-*+]\s|\d+[.)]\s|```|~~~|<|!\[|\[!\[)/u;

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
