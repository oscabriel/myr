/**
 * One file of a project at a revision. The server sends its text as a
 * `<pre>` with one numbered, anchored line each (`#L42` scrolls there with
 * no script), capped at `FALLBACK_LINES`; the browser then draws it with
 * `@pierre/diffs` (`code`, from `client-code.tsx`), keeping the `#L10-L20`
 * selection in the address. A Markdown file is rendered (its source on
 * `?plain=1`), an image is shown from raw, and a binary file or one past
 * the read cap says its size and links its raw bytes.
 *
 * The toolbar: Raw (at the commit the page resolved, so it caches for
 * good), Why and History (at the page's revision), Permalink (the page at
 * that commit; `y` rewrites the address to it) and Copy.
 */
import type { FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";

import { CopyButton } from "./copy.tsx";
import {
  blobHref,
  commitsHref,
  isImage,
  isMarkdown,
  rawHref,
  sizeInWords,
  whyHref,
} from "./paths.ts";
import {
  CodeBreadcrumb,
  CodeLayout,
  ReadmeSection,
  revLabel,
} from "./tree-view.tsx";

/** How many lines the server sends; the browser's drawing shows them all. */
export const FALLBACK_LINES = 2000;

const TOOL = buttonVariants({
  className: "no-underline",
  size: "sm",
  variant: "ghost",
});

const LINK = "decoration-rule underline hover:decoration-current";

/** A text's lines, without the empty one after its last newline. */
export const linesOf = (text: string): readonly string[] => {
  const lines = text.split("\n");

  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

/** The file as plain text: each line numbered and anchored `L<n>`. */
export const NumberedLines = ({ text }: { readonly text: string }) => {
  const lines = linesOf(text);
  const shown = lines.slice(0, FALLBACK_LINES);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <pre className="border-rule bg-surface overflow-x-auto border py-2 font-mono text-[0.8125rem] leading-5">
        <code className="grid grid-cols-[auto_1fr]">
          {shown.map((line, index) => {
            const number = index + 1;

            return (
              <span className="contents" id={`L${number}`} key={number}>
                <a
                  className="text-muted-foreground hover:text-foreground pr-4 pl-3 text-right no-underline select-none"
                  href={`#L${number}`}
                >
                  {number}
                </a>
                <span className="pr-3 whitespace-pre">{line}</span>
              </span>
            );
          })}
        </code>
      </pre>
      {lines.length > shown.length ? (
        <p className="text-muted-foreground text-sm">
          The first {FALLBACK_LINES.toLocaleString("en")} of{" "}
          {lines.length.toLocaleString("en")} lines.
        </p>
      ) : null}
    </div>
  );
};

/** `y` rewrites the address to the page at its commit, keeping the line anchor. */
const PermalinkKey = ({ href }: { readonly href: string }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName));

      if (
        event.key === "y" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        globalThis.history.replaceState(
          globalThis.history.state,
          "",
          `${href}${globalThis.location.search}${globalThis.location.hash}`
        );
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [href]);

  return null;
};

/** What the server shows of a file that has no text to number. */
const Bytes = ({
  file,
  project,
  words,
}: {
  readonly file: FileView;
  readonly project: ProjectName;
  readonly words: string;
}) => (
  <p className="border-rule border border-dashed px-4 py-5 text-sm">
    {words} ({sizeInWords(file.size)}).{" "}
    <a className={LINK} href={rawHref(project, file.at, file.path)}>
      View raw
    </a>
  </p>
);

/** The file's body: an image, Markdown, numbered text, or its size. */
const Body = ({
  code,
  file,
  plain,
  project,
  rev,
}: {
  readonly code?: ReactNode;
  readonly file: FileView;
  readonly plain: boolean;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  if (isImage(file.path) && !plain) {
    return (
      <img
        alt={file.path}
        className="border-rule max-w-full border"
        src={rawHref(project, file.at, file.path)}
      />
    );
  }

  if (file.binary) {
    return <Bytes file={file} project={project} words="A binary file" />;
  }

  if (file.text === undefined) {
    return (
      <Bytes
        file={file}
        project={project}
        words="This file is too large to show"
      />
    );
  }

  if (isMarkdown(file.path) && !plain) {
    return (
      <>
        <p className="text-sm">
          <a
            className={LINK}
            href={`${blobHref(project, rev, file.path)}?plain=1`}
          >
            Show the source
          </a>
        </p>
        <ReadmeSection file={file} project={project} />
      </>
    );
  }

  return (
    <>
      {isMarkdown(file.path) ? (
        <p className="text-sm">
          <a className={LINK} href={blobHref(project, rev, file.path)}>
            Show it rendered
          </a>
        </p>
      ) : null}
      {code ?? <NumberedLines text={file.text} />}
    </>
  );
};

export const BlobView = ({
  code,
  file,
  plain = false,
  project,
  rev,
  sidebar,
}: {
  /**
   * The browser's drawing of the text, holding `NumberedLines` as its
   * fallback; the numbered lines alone when absent.
   */
  readonly code?: ReactNode;
  readonly file: FileView;
  /** `?plain=1`: a Markdown file's source, not its rendering. */
  readonly plain?: boolean;
  readonly project: ProjectName;
  readonly rev: string;
  /** The file tree, drawn in the browser. */
  readonly sidebar?: ReactNode;
}) => {
  const permalink = blobHref(project, file.at, file.path);

  return (
    <CodeLayout
      project={project}
      sidebar={sidebar}
      title={`${file.path} at ${revLabel(rev)}`}
    >
      <PermalinkKey href={permalink} />
      <CodeBreadcrumb path={file.path} project={project} rev={rev} />
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>{sizeInWords(file.size)}</span>
        <nav
          aria-label="File"
          className="flex flex-wrap gap-1"
          data-toolbar="file"
        >
          <a className={TOOL} href={rawHref(project, file.at, file.path)}>
            Raw
          </a>
          <a className={TOOL} href={whyHref(project, rev, file.path)}>
            Why
          </a>
          <a
            className={TOOL}
            href={commitsHref(project, rev, { path: file.path })}
          >
            History
          </a>
          <a className={TOOL} href={permalink} title="Permalink (y)">
            Permalink
          </a>
        </nav>
        {file.text === undefined ? null : (
          <CopyButton label="Copy" text={file.text} />
        )}
      </div>
      <Body code={code} file={file} plain={plain} project={project} rev={rev} />
    </CodeLayout>
  );
};
