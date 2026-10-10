/**
 * How the shared parts' tests read rendered markup: the markup itself, the
 * text a reader sees (tags dropped, entities decoded), and whether parts
 * of that text come in order.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

export const markupOf = (element: ReactElement) =>
  renderToStaticMarkup(element);

/** What a reader sees of `markup`: the text without its tags, entities decoded. */
export const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    );

/** What a reader sees of `element`, rendered. */
export const textOf = (element: ReactElement) => textIn(markupOf(element));

/** Where each of `parts` starts in `text`, each searched after the one before; -1 once one is missing. */
export const positionsInOrder = (text: string, parts: readonly string[]) => {
  const positions: number[] = [];
  let from = 0;

  for (const part of parts) {
    const at = from < 0 ? -1 : text.indexOf(part, from);

    positions.push(at);
    from = at < 0 ? -1 : at + part.length;
  }

  return positions;
};

/** Whether every one of `parts` is in `text`, each after the one before. */
export const allInOrder = (text: string, parts: readonly string[]) =>
  positionsInOrder(text, parts).every((at) => at >= 0);

/** Each opening tag in `markup` that carries `attribute`, as the tag's text. */
export const tagsWith = (markup: string, attribute: string) =>
  [...markup.matchAll(/<[a-z][^>]*>/gu)].flatMap(([tag]) =>
    tag.includes(`${attribute}=`) ? [tag] : []
  );

/** The value of `attribute` in one opening `tag`. */
export const attributeOf = (tag: string, attribute: string) =>
  new RegExp(`\\b${attribute}="(?<value>[^"]*)"`, "u").exec(tag)?.groups?.value;
