/**
 * Code the server highlighted: Pierre's own host element, `diffs-container`,
 * whose shadow root the server sends as a declarative shadow root (a
 * `<template shadowrootmode="open">`), so the browser paints the
 * highlighted code with the document, before any script.
 *
 * The parser turns the template into the element's shadow root, so the
 * browser's render holds the same element with nothing in it: React
 * adopts it as it is, shadow root and all, until the page's drawing takes
 * its place. A page drawn in the browser alone (one reached by a link,
 * not loaded) has no drawing there, and shows `plain` instead, before it
 * paints.
 */
import { createElement, use, useCallback, useState } from "react";
import type { ReactNode } from "react";

import { NumberedLines } from "./numbered-lines.tsx";
import { fileDrawing, prerendersFile } from "./prerender.ts";

/** Pierre's host element; its stylesheet and script come with the drawing. */
const HOST = "diffs-container";

/** The drawing's HTML, in its shadow root; an empty host when there is none. */
const Prerendered = ({ html }: { readonly html: string | undefined }) =>
  createElement(
    HOST,
    { "data-prerendered": "" },
    html === undefined
      ? null
      : createElement("template", {
          // oxlint-disable-next-line react/no-danger -- a declarative shadow root is HTML the parser must read; Pierre's own SSR sends it so (`templateRender`), and the HTML is Pierre's rendering of escaped code text
          dangerouslySetInnerHTML: { __html: html },
          shadowrootmode: "open",
        })
  );

/** The server's drawing, kept as the document holds it; `plain` when it holds none. */
const Adopted = ({ plain }: { readonly plain: ReactNode }) => {
  const [kept, setKept] = useState(true);

  // Read as the host mounts, before the page paints. The drawing's code,
  // not just a shadow root: once Pierre's element is defined (a page drawn
  // before), a new host gets an empty one at once.
  const adopt = useCallback((host: HTMLElement | null) => {
    if (
      host !== null &&
      (host.shadowRoot?.querySelector("pre") ?? null) === null
    ) {
      setKept(false);
    }
  }, []);

  return kept
    ? createElement(HOST, {
        "data-prerendered": "",
        ref: adopt,
        suppressHydrationWarning: true,
      })
    : plain;
};

export const ServerCode = ({
  drawing,
  plain,
}: {
  /** The server's drawing (`prerender.ts`), settled before the page renders. */
  readonly drawing: () => Promise<string | undefined>;
  /** What the browser shows when the document did not bring the drawing. */
  readonly plain: ReactNode;
}) =>
  import.meta.env.SSR ? (
    <Prerendered html={use(drawing())} />
  ) : (
    <Adopted plain={plain} />
  );

/**
 * A file as the server sends it, until the browser's drawing replaces it:
 * highlighted where the server highlights it (`prerendersFile`), else
 * numbered, anchored plain text.
 */
export const FileFallback = ({
  path,
  sha,
  text,
}: {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}) => {
  const plain = <NumberedLines text={text} />;

  return prerendersFile({ path, text }) ? (
    <div className="min-w-0" data-code="prerendered">
      <ServerCode
        drawing={() => fileDrawing({ path, sha, text })}
        plain={plain}
      />
    </div>
  ) : (
    plain
  );
};
