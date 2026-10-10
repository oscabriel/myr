/**
 * How the project records' tests (the ledger, the env shape, the policy and
 * the refs) read a page's markup: its main pane alone, its inspector alone,
 * and one element whole. A page's facts render twice, once inline for
 * narrow screens and once in the inspector, so a test that counts or
 * orders what a page says reads one pane at a time.
 */

/** The element whose opening tag starts at `start`, whole, nested elements of its own name included. */
const balancedAt = (markup: string, start: number) => {
  const tag = /^<(?<name>[a-z0-9]+)/u.exec(markup.slice(start))?.groups?.name;

  if (tag === undefined) {
    return "";
  }

  const tags = new RegExp(`<(?<close>/?)${tag}\\b[^>]*>`, "gu");
  tags.lastIndex = start;
  let depth = 0;

  for (const found of markup.matchAll(tags)) {
    if (found.index < start) {
      continue;
    }

    depth += found.groups?.close === "/" ? -1 : 1;

    if (depth === 0) {
      return markup.slice(start, found.index + found[0].length);
    }
  }

  return markup.slice(start);
};

/** The first element whose opening tag carries `attribute` (`data-x`, or `aria-label="…"`), whole. */
export const elementWith = (markup: string, attribute: string) => {
  const found = new RegExp(`<[a-z0-9]+\\b[^>]*${attribute}[^>]*>`, "u").exec(
    markup
  );

  return found === null ? "" : balancedAt(markup, found.index);
};

/** Every element whose opening tag carries `attribute`, each whole, in order. */
export const elementsWith = (markup: string, attribute: string) =>
  [
    ...markup.matchAll(
      new RegExp(`<[a-z0-9]+\\b[^>]*${attribute}[^>]*>`, "gu")
    ),
  ].map((found) => balancedAt(markup, found.index));

/** The markup of `<main>` alone, without the facts it repeats inline below the shell's width. */
export const mainOf = (markup: string) => {
  const main = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));
  const inline = elementWith(main, 'data-facts="inline"');

  return inline === "" ? main : main.replace(inline, "");
};

/** The markup of the inspector alone. */
export const inspectorOf = (markup: string) =>
  elementWith(markup, 'data-facts="inspector"');
