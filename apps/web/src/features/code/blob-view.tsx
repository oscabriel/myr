/**
 * One file of a project at a revision, in Code mode (its Why mode is
 * `why/why-view.tsx`, the same page). The file header stays under the
 * context bar: the path once, the file in words, Code | Why, Raw,
 * Permalink (`y`) and Copy. The code takes the pane's whole width and
 * scrolls sideways inside itself, never wrapping: the server sends it
 * highlighted where it highlights its language and size (`ServerCode`,
 * ADR 0027), else as numbered, anchored plain text (`NumberedLines`), and
 * the browser's drawing (`code`, from `client-code.tsx`) replaces it in
 * place.
 *
 * A Markdown file is rendered (its source on `?plain=1`), an image is shown
 * from raw, and a binary file or one past the read cap says its size and
 * links its bytes. The inspector holds "This file".
 */
import type { CommitView, FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { ReadmeSection } from "../project/readme-section.tsx";
import { AppLink } from "../shared/link.tsx";
import { GUTTER, MEASURE, Workspace } from "../shared/shell/workspace.tsx";
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
  <div className={`${GUTTER} ${MEASURE} pt-6`}>
    <p className="border-rule text-ui border border-dashed px-4 py-5">
      {words} ({sizeInWords(file.size)}).{" "}
      <a className={LINK} href={rawHref(project, file.at, file.path)}>
        View raw
      </a>
    </p>
  </div>
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
  /** The browser's drawing of the text, holding `NumberedLines` as its fallback. */
  readonly code?: ReactNode;
  /** `?plain=1`: a Markdown file's source, not its rendering. */
  readonly plain?: boolean;
  /** The commit that last changed the file. */
  readonly last?: CommitView | undefined;
  readonly now: DateTime.Utc;
  /** The Files button, below the shell's width. */
  readonly files?: ReactNode;
}

export const BlobView = ({
  code,
  file,
  files,
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
        files={files}
        mode="code"
        path={file.path}
        project={project}
        rev={rev}
      />
    }
    variant="code"
  >
    <PermalinkKey href={blobHref(project, file.at, file.path)} />
    <Body code={code} file={file} plain={plain} project={project} rev={rev} />
  </Workspace>
);
