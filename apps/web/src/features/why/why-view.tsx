/**
 * Why each line of a file is there (spec W9-D9). The server sends a table
 * of ranges (lines a–b → the landing or the commit that brought them)
 * beside the file's numbered lines; the browser then draws the file with
 * one row above each range (`code`, from `client-why.tsx`), where clicking
 * a line number opens that line's landing. A file the walk cannot read as
 * text (binary, or past 1 MiB) has no ranges, and the page says so.
 */
import type { WhyView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";

import { NumberedLines } from "../code/blob-view.tsx";
import { blobHref, commitHref, commitsHref, shortSha } from "../code/paths.ts";
import { CodeBreadcrumb, CodeLayout, revLabel } from "../code/tree-view.tsx";
import { RangeLinks, RangeSummary } from "./range-summary.tsx";
import { linesWords, rowsOf } from "./rows.ts";

const TOOL = buttonVariants({
  className: "no-underline",
  size: "sm",
  variant: "ghost",
});

const LINK = "decoration-rule underline hover:decoration-current";

/** The ranges as a table: lines a–b, then who and why. */
export const WhyTable = ({
  project,
  view,
}: {
  readonly project: ProjectName;
  readonly view: WhyView;
}) => (
  <table className="w-full border-collapse text-sm" data-why="ranges">
    <thead className="sr-only">
      <tr>
        <th scope="col">Lines</th>
        <th scope="col">Brought by</th>
      </tr>
    </thead>
    <tbody>
      {rowsOf(view).map((row) => (
        <tr
          className="border-rule border-t align-top"
          data-range={`${row.range.start}-${row.range.end}`}
          key={row.range.start}
        >
          <td className="py-2 pr-4 whitespace-nowrap">
            <a className={LINK} href={`#L${row.range.start}`}>
              {linesWords(row.range)}
            </a>
          </td>
          <td className="flex flex-col gap-1 py-2">
            <RangeSummary project={project} row={row} />
            <RangeLinks
              line={row.range.start}
              project={project}
              row={row}
              view={view}
            />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** The page's fallback: the table of ranges beside the numbered lines. */
export const WhyFallback = ({
  project,
  text,
  view,
}: {
  readonly project: ProjectName;
  readonly text: string;
  readonly view: WhyView;
}) => (
  <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
    <WhyTable project={project} view={view} />
    <NumberedLines text={text} />
  </div>
);

export const WhyLines = ({
  code,
  project,
  rev,
  text,
  view,
}: {
  /** The browser's drawing, holding `WhyFallback` as its fallback. */
  readonly code?: ReactNode;
  readonly project: ProjectName;
  readonly rev: string;
  /** The file's text at `view.at`; absent for a binary or too large file. */
  readonly text?: string;
  readonly view: WhyView;
}) => (
  <CodeLayout project={project} title={`Why ${view.path} at ${revLabel(rev)}`}>
    <CodeBreadcrumb path={view.path} project={project} rev={rev} />
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span>
        Why each line is there, at{" "}
        <a
          className={`font-mono text-[0.8125rem] ${LINK}`}
          href={commitHref(project, view.at)}
        >
          {shortSha(view.at)}
        </a>
      </span>
      <nav aria-label="File" className="flex flex-wrap gap-1">
        <a className={TOOL} href={blobHref(project, rev, view.path)}>
          File
        </a>
        <a
          className={TOOL}
          href={commitsHref(project, rev, { path: view.path })}
        >
          History
        </a>
      </nav>
    </div>
    {view.stoppedAt === undefined ? null : (
      <p className="text-muted-foreground text-sm">
        The walk stopped after 200 commits: lines older than{" "}
        <a
          className={`font-mono text-[0.8125rem] ${LINK}`}
          href={commitHref(project, view.stoppedAt)}
        >
          {shortSha(view.stoppedAt)}
        </a>{" "}
        point at it.
      </p>
    )}
    {view.ranges.length === 0 || text === undefined ? (
      <p className="border-rule border border-dashed px-4 py-5 text-sm">
        {text === ""
          ? "This file is empty."
          : "This file is binary or too large to say why each line is there."}{" "}
        <a className={LINK} href={blobHref(project, view.at, view.path)}>
          View the file
        </a>
      </p>
    ) : (
      (code ?? <WhyFallback project={project} text={text} view={view} />)
    )}
  </CodeLayout>
);
