/**
 * Every page of a project inside one frame: the project's header across the
 * top, then a page's side column (the file tree beside code, a finish's
 * files) and the page itself.
 */
import type { ReactNode } from "react";

import {
  SideColumnOutlet,
  useSideColumn,
} from "../shared/shell/side-column.tsx";

/**
 * The header and its tabs stick under the top bar together, so what sticks
 * inside the frame sits under both: `--stick-bar`, `--stick-toolbar` and
 * `--stick-column` move down by `--project-head`, the height the header is
 * drawn at. Until the browser has measured it (the server's HTML, before any
 * scroll), a header with a lede, a facts row and its tabs stands in.
 */
const UNDER_HEAD =
  "[--stick-bar:calc(var(--top-bar)_+_var(--project-head,11.25rem)_-_1px)] [--stick-toolbar:calc(var(--top-bar)_+_var(--project-head,11.25rem)_+_var(--toolbar)_-_1px)] [--stick-column:calc(var(--top-bar)_+_var(--project-head,11.25rem))]";

const UNDER_BAR = "[--stick-column:var(--top-bar)]";

const HEAD_HEIGHT = "--project-head";

/** The frame keeps its header's drawn height, so what sticks below clears it. */
const keepHeight = ([entry]: readonly ResizeObserverEntry[]) => {
  const frame = entry?.target.parentElement;
  const height = entry?.borderBoxSize[0]?.blockSize;

  if (frame !== null && frame !== undefined && height !== undefined) {
    frame.style.setProperty(HEAD_HEIGHT, `${height}px`);
  }
};

/**
 * The header's height is read, never assumed: it wraps on a narrow screen
 * and has no lede on a project with no README.
 */
const measureHead = (head: HTMLDivElement | null) => {
  const observer = new ResizeObserver(keepHeight);

  if (head !== null) {
    observer.observe(head);
  }

  return () => {
    observer.disconnect();
    head?.parentElement?.style.removeProperty(HEAD_HEIGHT);
  };
};

/**
 * From `columns` the side column stands beside the page. Below it the column
 * is hidden rather than stacked: the Files button's sheet is the file tree's
 * narrow form until issue 04 decides the Code tab.
 */
export const ProjectFrame = ({
  children,
  header,
}: {
  readonly header?: ReactNode;
  readonly children: ReactNode;
}) => {
  const column = useSideColumn() !== undefined;

  return (
    <div
      className={`flex w-full min-w-0 flex-1 flex-col ${header === undefined ? UNDER_BAR : UNDER_HEAD}`}
      data-project-frame=""
    >
      {header === undefined ? null : (
        <div
          className="bg-background sticky top-(--top-bar) z-20"
          data-project-head=""
          ref={measureHead}
        >
          {header}
        </div>
      )}
      <div className="flex w-full min-w-0 flex-1">
        {column ? (
          <div className="border-rule columns:flex sticky top-(--stick-column) hidden h-[calc(100dvh-var(--stick-column))] w-(--column-tree) shrink-0 flex-col border-r">
            <SideColumnOutlet />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
};
