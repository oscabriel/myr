// A page's facts sit in the page above its content, so a test reads them apart from the rest of the main region.

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

export const elementWith = (markup: string, attribute: string) => {
  const found = new RegExp(`<[a-z0-9]+\\b[^>]*${attribute}[^>]*>`, "u").exec(
    markup
  );

  return found === null ? "" : balancedAt(markup, found.index);
};

export const elementsWith = (markup: string, attribute: string) =>
  [
    ...markup.matchAll(
      new RegExp(`<[a-z0-9]+\\b[^>]*${attribute}[^>]*>`, "gu")
    ),
  ].map((found) => balancedAt(markup, found.index));

export const mainOf = (markup: string) => {
  const main = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));
  const inline = elementWith(main, 'data-facts="inline"');

  return inline === "" ? main : main.replace(inline, "");
};

export const factsOf = (markup: string) =>
  elementWith(markup, 'data-facts="inline"');
