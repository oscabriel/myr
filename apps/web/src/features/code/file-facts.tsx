import type { CommitView, FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";

import { FactBlock } from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { LandingWords } from "../why/band.tsx";
import { CopyButton } from "./copy.tsx";
import { fileWords } from "./file-header.tsx";
import { blobHref, commitsHref, rawHref, whyHref } from "./paths.ts";
import { pinnedRev } from "./rev.ts";

const LINK = "decoration-rule underline hover:decoration-current";

export const FileFacts = ({
  file,
  last,
  mode = "code",
  now,
  project,
  rev,
}: {
  readonly file: FileView;
  readonly mode?: "code" | "why";
  readonly last?: CommitView | undefined;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <>
    <FactBlock label="Path">
      <p className="text-mono font-mono [overflow-wrap:anywhere]">
        {file.path}
      </p>
      <p className="text-ui text-muted-foreground">
        {fileWords(file).join(" · ")}
      </p>
    </FactBlock>
    <FactBlock label="Last changed by">
      {last === undefined ? (
        <p className="text-ui text-muted-foreground">Not known.</p>
      ) : (
        <p className="text-ui [overflow-wrap:anywhere]" data-last={last.sha}>
          <LandingWords
            commit={Option.some(last)}
            landing={Option.fromUndefinedOr(last.landing)}
            now={now}
            project={project}
            rev={rev}
            sha={last.sha}
          />
        </p>
      )}
      <AppLink
        className={`text-ui ${LINK}`}
        search={{ path: file.path }}
        to={commitsHref(project, rev)}
      >
        History of this file
      </AppLink>
    </FactBlock>
    <FactBlock label="Take it">
      <nav
        aria-label="Take the file"
        className="text-ui flex flex-wrap items-center gap-x-4 gap-y-1"
      >
        <a
          className={LINK}
          href={rawHref(project, pinnedRev(rev, file.at), file.path)}
        >
          Raw
        </a>
        <AppLink
          className={LINK}
          to={(mode === "why" ? whyHref : blobHref)(
            project,
            pinnedRev(rev, file.at),
            file.path
          )}
        >
          Permalink
        </AppLink>
        {file.text === undefined ? null : (
          <CopyButton label="Copy the file" text={file.text} />
        )}
      </nav>
    </FactBlock>
  </>
);
