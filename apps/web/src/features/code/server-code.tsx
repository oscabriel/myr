/**
 * The server sends the drawing's shadow root as a declarative shadow root, so
 * the browser paints it with the document. React adopts the host as it is,
 * shadow root and all, until the page's drawing takes its place.
 */
import { createElement, use, useCallback, useState } from "react";
import type { ReactNode } from "react";

import { NumberedLines } from "./numbered-lines.tsx";
import { fileDrawing, prerendersFile } from "./prerender.ts";

const HOST = "diffs-container";

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

const Adopted = ({ plain }: { readonly plain: ReactNode }) => {
  const [kept, setKept] = useState(true);

  // Once Pierre's element is defined (a page drawn before), a new host gets an
  // empty shadow root at once, so check for the drawing's code.
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
  readonly drawing: () => Promise<string | undefined>;
  readonly plain: ReactNode;
}) =>
  import.meta.env.SSR ? (
    <Prerendered html={use(drawing())} />
  ) : (
    <Adopted plain={plain} />
  );

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
