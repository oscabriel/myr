import type { CommitView, FileView, WhyView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { FileFacts } from "../code/file-facts.tsx";
import { FileHeader, PermalinkKey } from "../code/file-header.tsx";
import { NumberedLines } from "../code/numbered-lines.tsx";
import { blobHref, commitHref, shortSha, whyHref } from "../code/paths.ts";
import { AppLink } from "../shared/link.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { MEASURE, Workspace } from "../shared/shell/workspace.tsx";
import { WhyBand } from "./range-summary.tsx";
import { groupsOf } from "./rows.ts";

const LINK = "decoration-rule underline hover:decoration-current";

export const WhyFallback = ({
  now,
  project,
  text,
  view,
}: {
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly text: string;
  readonly view: WhyView;
}) => (
  <div data-why="ranges">
    <NumberedLines
      bands={
        new Map(
          groupsOf(view).map((row) => [
            row.range.start,
            <WhyBand
              key={row.range.start}
              now={now}
              project={project}
              row={row}
              view={view}
            />,
          ])
        )
      }
      text={text}
    />
  </div>
);

export interface WhyLinesProps {
  readonly project: ProjectName;
  readonly rev: string;
  readonly view: WhyView;
  readonly now: DateTime.Utc;
  readonly file?: FileView | undefined;
  readonly text?: string;
  readonly code?: ReactNode;
  readonly last?: CommitView | undefined;
  readonly files?: ReactNode;
}

export const WhyLines = ({
  code,
  file,
  files,
  last,
  now,
  project,
  rev,
  text,
  view,
}: WhyLinesProps) => {
  const name = view.path.split("/").at(-1) ?? view.path;

  return (
    <Workspace
      crumbs={[
        { label: project, to: `/${project}` },
        { label: "Code", to: `/${project}/tree/main` },
        { label: name, mono: true },
      ]}
      facts={
        file === undefined ? undefined : (
          <FileFacts
            mode="why"
            file={file}
            last={last}
            now={now}
            project={project}
            rev={rev}
          />
        )
      }
      factsHeading="This file"
      title={name}
      toolbar={
        <FileHeader
          files={files}
          mode="why"
          path={view.path}
          project={project}
          rev={rev}
          {...(file === undefined ? {} : { file })}
        />
      }
      variant="code"
    >
      <PermalinkKey href={whyHref(project, view.at, view.path)} />
      {view.stoppedAt === undefined ? null : (
        <p className={`${GUTTER} ${MEASURE} text-ui text-muted-foreground`}>
          The walk stopped after 200 commits: lines older than{" "}
          <AppLink
            className={`text-mono font-mono ${LINK}`}
            to={commitHref(project, view.stoppedAt)}
          >
            {shortSha(view.stoppedAt)}
          </AppLink>{" "}
          point at it.
        </p>
      )}
      {view.ranges.length === 0 || text === undefined ? (
        <div className={`${GUTTER} ${MEASURE}`}>
          <p className="border-rule text-ui border border-dashed px-4 py-5">
            {text === ""
              ? "This file is empty."
              : "This file is binary or too large to say why each line is there."}{" "}
            <AppLink
              className={LINK}
              to={blobHref(project, view.at, view.path)}
            >
              View the file
            </AppLink>
          </p>
        </div>
      ) : (
        (code ?? (
          <WhyFallback now={now} project={project} text={text} view={view} />
        ))
      )}
    </Workspace>
  );
};
