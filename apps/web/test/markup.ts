import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

export const markupOf = (element: ReactElement) =>
  renderToStaticMarkup(element);

export const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    );

export const textOf = (element: ReactElement) => textIn(markupOf(element));

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

export const allInOrder = (text: string, parts: readonly string[]) =>
  positionsInOrder(text, parts).every((at) => at >= 0);

export const tagsWith = (markup: string, attribute: string) =>
  [...markup.matchAll(/<[a-z][^>]*>/gu)].flatMap(([tag]) =>
    tag.includes(`${attribute}=`) ? [tag] : []
  );

export const attributeOf = (tag: string, attribute: string) =>
  new RegExp(`\\b${attribute}="(?<value>[^"]*)"`, "u").exec(tag)?.groups?.value;
