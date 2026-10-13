import type { CommitView, FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { ReadmeSection } from "../project/readme-section.tsx";
import { AppLink } from "../shared/link.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { MEASURE, Workspace } from "../shared/shell/workspace.tsx";
import { FileFacts } from "./file-facts.tsx";
import { FileHeader, PermalinkKey } from "./file-header.tsx";
import { NumberedLines } from "./numbered-lines.tsx";
import {
  blobHref,
  isImage,
  isMarkdown,
  rawHref,
  sizeInWords,
} from "./paths.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const Bytes = ({
  file,
  project,
  words,
}: {
  readonly file: FileView;
  readonly project: ProjectName;
  readonly words: string;
}) => (
  <div className={`${GUTTER} ${MEASURE} pt-6`}>
    <p className="border-rule text-ui border border-dashed px-4 py-5">
      {words} ({sizeInWords(file.size)}).{" "}
      <a className={LINK} href={rawHref(project, file.at, file.path)}>
        View raw
      </a>
    </p>
  </div>
);

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
      <div className={`${GUTTER} pt-6`}>
        <img
          alt={file.path}
          className="border-rule max-w-full border"
          src={rawHref(project, file.at, file.path)}
        />
      </div>
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
      <div className={`${GUTTER} ${MEASURE} flex flex-col gap-4 pt-6`}>
        <p className="text-ui">
          {/* A plain link: the router would write the 1 as a quoted string. */}
          <a
            className={LINK}
            href={`${blobHref(project, rev, file.path)}?plain=1`}
          >
            Show the source
          </a>
        </p>
        <ReadmeSection file={file} project={project} />
      </div>
    );
  }

  return (
    <>
      {isMarkdown(file.path) ? (
        <p className={`${GUTTER} text-ui pt-4`}>
          <AppLink className={LINK} to={blobHref(project, rev, file.path)}>
            Show it rendered
          </AppLink>
        </p>
      ) : null}
      {code ?? <NumberedLines text={file.text} />}
    </>
  );
};

export interface BlobViewProps {
  readonly file: FileView;
  readonly project: ProjectName;
  readonly rev: string;
  readonly code?: ReactNode;
  readonly plain?: boolean;
  readonly last?: CommitView | undefined;
  readonly now: DateTime.Utc;
}

export const BlobView = ({
  code,
  file,
  last,
  now,
  plain = false,
  project,
  rev,
}: BlobViewProps) => (
  <Workspace
    crumbs={[
      { label: project, to: `/${project}` },
      { label: "Code", to: `/${project}/tree/main` },
      { label: file.path.split("/").at(-1) ?? file.path, mono: true },
    ]}
    facts={
      <FileFacts
        file={file}
        last={last}
        now={now}
        project={project}
        rev={rev}
      />
    }
    factsHeading="This file"
    title={file.path.split("/").at(-1) ?? file.path}
    toolbar={
      <FileHeader
        file={file}
        mode="code"
        path={file.path}
        project={project}
        rev={rev}
      />
    }
    quietHead
    variant="code"
  >
    <PermalinkKey href={blobHref(project, file.at, file.path)} />
    <Body code={code} file={file} plain={plain} project={project} rev={rev} />
  </Workspace>
);
