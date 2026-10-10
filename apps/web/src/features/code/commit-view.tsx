/**
 * One commit, read as a landing first and a diff second. The head: the
 * subject, the landing's status line ("Landed as 9b1c3e5 · answered
 * format-ordinal", the SHA and the ask linked), the body as prose, and
 * git's own metadata on one muted line. The inspector holds the typed
 * facts: this landing's state, its credit (the trailers, once), the diff's
 * stats split by path, and its provenance. Then the diff, file by file, in
 * a pane of its own: the server's plain text (`PlainDiff`), which the
 * browser's drawing (`drawing`, from `client-code.tsx`) replaces in place.
 *
 * A commit the platform did not land came in with the history the project
 * adopted, and says so; its trailers are listed as written, linking no one.
 */
import type {
  CommitDiff,
  CommitView as Commit,
} from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";
import { Columns2, FoldVertical, Rows3, UnfoldVertical } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { CreditFacts, FactBlock, ProvenanceFacts } from "../shared/facts.tsx";
import type { ProvenanceEntry } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { GUTTER, MEASURE, Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { drawnFiles, statsOf } from "./diff-model.ts";
import type { DiffStats } from "./diff-model.ts";
import { DiffPane, PANE_SCROLLER } from "./diff-pane.tsx";
import { commitHref, shortSha, treeHref } from "./paths.ts";
import { ChangeCounts, PlainDiff } from "./plain-diff.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

/** A trailer line: `Key: value`, the key one word of letters and dashes. */
const TRAILER = /^[A-Za-z][\w-]*:\s/u;

/**
 * The body without its trailers, which the Credit block shows: git's
 * trailer block is the last paragraph when every line of it is a
 * `Key: value`.
 */
export const bodyWithoutTrailers = (commit: Commit) => {
  const paragraphs = commit.body.trim().split(/\n\s*\n/u);
  const last = paragraphs.at(-1) ?? "";

  const trailers =
    commit.trailers.length > 0 &&
    last.split("\n").every((line) => TRAILER.test(line.trim()));

  return (trailers ? paragraphs.slice(0, -1) : paragraphs).join("\n\n").trim();
};

/** Where the commit stands, in one line: landed as its SHA, and the ask it answered or opened. */
export const LandingStatus = ({
  commit,
  project,
}: {
  readonly commit: Commit;
  readonly project: ProjectName;
}) => {
  const { landing } = commit;

  if (landing === undefined) {
    return (
      <p className="text-want text-muted-foreground flex items-start gap-2">
        <StateMarkIcon className="mt-1" mark="notNeeded" />
        <span>
          Before adoption: this commit came in with the history the project
          adopted, so no landing records it.
        </span>
      </p>
    );
  }

  const linked = Option.getOrUndefined(askOf(landing));

  return (
    <p className="text-want flex items-start gap-2" data-outcome="Landed">
      <StateMarkIcon className="mt-1" mark="landed" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <strong className="text-landed font-semibold">Landed</strong> as{" "}
        <AppLink
          className={`text-mono font-mono ${LINK}`}
          to={commitHref(project, commit.sha)}
        >
          {shortSha(commit.sha)}
        </AppLink>
        {linked === undefined ? null : (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {" · "}
            </span>
            {linked.kind === "opened" ? "opened " : "answered "}
            <AppLink
              className={`text-mono font-mono ${LINK}`}
              to={askPath(project, linked.ask)}
            >
              {linked.ask}
            </AppLink>
          </>
        )}
      </span>
    </p>
  );
};

/** Git's own metadata, on one line: who wrote it, who committed it, its parents. */
const GitLine = ({
  commit,
  now,
  project,
}: {
  readonly commit: Commit;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}) => (
  <span className="[overflow-wrap:anywhere]">
    authored by {commit.author.name} <When at={commit.author.at} now={now} />
    {" · "}
    committed by{" "}
    {commit.landing === undefined ? commit.committer.name : "the platform"}
    {" · "}
    {commit.parents.length === 0 ? (
      "the first commit"
    ) : (
      <>
        {commit.parents.length === 1 ? "parent" : "parents"}{" "}
        {commit.parents.map((parent, index) => (
          <span key={parent}>
            {index === 0 ? null : ", "}
            <AppLink
              className={`text-mono font-mono ${LINK}`}
              to={commitHref(project, parent)}
            >
              {shortSha(parent)}
            </AppLink>
          </span>
        ))}
      </>
    )}
    {" · "}
    <AppLink className={LINK} to={treeHref(project, commit.sha)}>
      Browse files
    </AppLink>
  </span>
);

const PART_WORDS = {
  other: "other",
  territory: "territory",
  tests: "tests",
} as const;

/** The diff in numbers: files, lines added and removed, then split by path. */
export const DiffStatsFacts = ({ stats }: { readonly stats: DiffStats }) => (
  <FactBlock label="Diff stats">
    <p
      className="text-ui flex flex-wrap items-center gap-x-3 gap-y-1"
      data-stats=""
    >
      <span>
        {stats.files} {stats.files === 1 ? "file" : "files"}
      </span>
      <ChangeCounts additions={stats.additions} deletions={stats.deletions} />
    </p>
    {stats.parts.length === 0 ? null : (
      <ul className="text-ui flex flex-col gap-1">
        {stats.parts.map((part) => (
          <li
            className="flex items-center justify-between gap-3"
            data-part={part.label}
            key={part.label}
          >
            <span className="text-muted-foreground">
              {PART_WORDS[part.label]}
              <span className="sr-only">:</span>
            </span>
            <ChangeCounts
              additions={part.additions}
              deletions={part.deletions}
            />
          </li>
        ))}
      </ul>
    )}
  </FactBlock>
);

/** The trailers of a commit the platform did not land, as written, linking no one. */
const WrittenTrailers = ({ commit }: { readonly commit: Commit }) =>
  commit.trailers.length === 0 ? null : (
    <FactBlock label="Trailers">
      <ul className="text-mono leading-terminal flex flex-col gap-1 font-mono">
        {commit.trailers.map(({ key, value }) => (
          <li className="[overflow-wrap:anywhere]" key={`${key}:${value}`}>
            <span className="text-muted-foreground">{key}:</span> {value}
          </li>
        ))}
      </ul>
    </FactBlock>
  );

/** A landing's credit from the record; a commit the platform did not land, its trailers as written. */
const LandingCredit = ({ commit }: { readonly commit: Commit }) =>
  commit.landing === undefined ? (
    <WrittenTrailers commit={commit} />
  ) : (
    <CreditFacts
      assisted={commit.landing.assisted}
      credits={commit.landing.credits}
      heldBack={commit.landing.heldBackTrailer}
    />
  );

/** Where the commit comes from: its id, its tree, its people and parents, and the landing's request. */
const provenanceOf = (commit: Commit): readonly ProvenanceEntry[] => [
  { label: "Commit", value: commit.sha },
  { label: "Tree", value: commit.tree },
  { label: "Author", value: `${commit.author.name} <${commit.author.email}>` },
  {
    label: "Committer",
    value: `${commit.committer.name} <${commit.committer.email}>`,
  },
  ...commit.parents.map((parent, index) => ({
    label: commit.parents.length === 1 ? "Parent" : `Parent ${index + 1}`,
    value: parent,
  })),
  ...(commit.landing?.verdict === undefined
    ? []
    : [{ label: "Patch id", value: commit.landing.verdict.patchId }]),
  ...(commit.landing?.requestId === undefined
    ? []
    : [{ label: "Request-Id", value: commit.landing.requestId }]),
];

/** The inspector's facts for a commit. */
const CommitFacts = ({
  commit,
  project,
  stats,
}: {
  readonly commit: Commit;
  readonly project: ProjectName;
  readonly stats: DiffStats;
}) => {
  const linked =
    commit.landing === undefined
      ? undefined
      : Option.getOrUndefined(askOf(commit.landing));

  return (
    <>
      <FactBlock label="State">
        <LandingStatus commit={commit} project={project} />
        {commit.landing === undefined ? null : (
          <p className="text-ui text-muted-foreground">
            By <HandleLink handle={commit.landing.author} />
            {linked === undefined || linked.kind === "opened" ? null : (
              <>
                {" · "}
                <AppLink className={LINK} to={answerPath(project, linked.ask)}>
                  the answer and its checks
                </AppLink>
              </>
            )}
          </p>
        )}
      </FactBlock>
      <LandingCredit commit={commit} />
      <DiffStatsFacts stats={stats} />
      <ProvenanceFacts entries={provenanceOf(commit)} />
    </>
  );
};

/** A segmented pair of buttons, the pressed one in ink. */
const SEGMENT =
  "text-ui hover:bg-surface aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground flex h-7 cursor-pointer items-center gap-1.5 px-2.5 font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5";

/** The diff's toolbar: unified or split, fold or unfold every file, and the counts. */
export const DiffToolbar = ({
  allFolded,
  files,
  onFoldAll,
  onSplit,
  split,
  stats,
}: {
  readonly split: boolean;
  readonly onSplit?: ((split: boolean) => void) | undefined;
  /** Whether every file is folded now. */
  readonly allFolded: boolean;
  readonly onFoldAll?: ((folded: boolean) => void) | undefined;
  readonly stats: DiffStats;
  /** The Files button, below the shell's width. */
  readonly files?: ReactNode;
}) => (
  <>
    {files === undefined ? null : (
      <div className="shell:hidden flex shrink-0">{files}</div>
    )}
    <fieldset className="border-input diffsplit:flex m-0 hidden min-w-0 border p-0">
      <legend className="sr-only">Diff layout</legend>
      <button
        aria-pressed={!split}
        className={SEGMENT}
        onClick={() => onSplit?.(false)}
        type="button"
      >
        <Rows3 aria-hidden="true" strokeWidth={1.75} />
        Unified
      </button>
      <button
        aria-pressed={split}
        className={SEGMENT}
        onClick={() => onSplit?.(true)}
        type="button"
      >
        <Columns2 aria-hidden="true" strokeWidth={1.75} />
        Split
      </button>
    </fieldset>
    <span className="text-muted-foreground">
      <Button onClick={() => onFoldAll?.(!allFolded)} size="sm" variant="ghost">
        {allFolded ? (
          <UnfoldVertical aria-hidden="true" strokeWidth={1.75} />
        ) : (
          <FoldVertical aria-hidden="true" strokeWidth={1.75} />
        )}
        {allFolded ? "Unfold all" : "Collapse all"}
      </Button>
    </span>
    <p className="text-ui text-muted-foreground ml-auto flex items-center gap-3 tabular-nums">
      <span>
        {stats.files} {stats.files === 1 ? "file" : "files"}
        <span className="tablet:inline hidden"> changed</span>
      </span>
      <ChangeCounts additions={stats.additions} deletions={stats.deletions} />
    </p>
  </>
);

export interface CommitViewProps {
  readonly diff: CommitDiff;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  /** The ask's territory, when the commit landed an answer: the stats split by it. */
  readonly territory?: readonly string[] | undefined;
  /** Old and new side by side. */
  readonly split?: boolean;
  readonly onSplit?: ((split: boolean) => void) | undefined;
  /** The files folded now; each file's default when absent. */
  readonly folded?: ReadonlySet<string> | undefined;
  readonly onFold?: ((path: string, folded: boolean) => void) | undefined;
  readonly onFoldAll?: ((folded: boolean) => void) | undefined;
  /** The browser's drawing of the diff, holding `PlainDiff` as its fallback. */
  readonly drawing?: ReactNode;
  /** The Files button, below the shell's width. */
  readonly files?: ReactNode;
}

export const CommitView = ({
  diff,
  drawing,
  files: filesButton,
  folded,
  now,
  onFold,
  onFoldAll,
  onSplit,
  project,
  split = false,
  territory,
}: CommitViewProps) => {
  const { commit, files, truncated } = diff;
  const body = bodyWithoutTrailers(commit);
  const drawn = drawnFiles(files);
  const stats = statsOf(drawn, territory);

  const allFolded = drawn.every((file) =>
    folded === undefined ? file.folded : folded.has(file.file.path)
  );

  return (
    <Workspace
      facts={<CommitFacts commit={commit} project={project} stats={stats} />}
      factsHeading={
        commit.landing === undefined ? "This commit" : "This landing"
      }
      meta={<GitLine commit={commit} now={now} project={project} />}
      state={
        commit.landing === undefined ? undefined : (
          <span className="flex items-center gap-1.5">
            <StateMarkIcon mark="landed" />
            <strong className="text-landed font-semibold">Landed</strong>
          </span>
        )
      }
      status={
        <div className="flex flex-col gap-4">
          <LandingStatus commit={commit} project={project} />
          {body === "" ? null : (
            <p
              className="text-body max-w-[70ch] [overflow-wrap:anywhere] whitespace-pre-wrap"
              data-body=""
            >
              {body}
            </p>
          )}
        </div>
      }
      title={
        commit.subject === ""
          ? `Commit ${shortSha(commit.sha)}`
          : commit.subject
      }
      toolbar={
        <DiffToolbar
          allFolded={allFolded}
          files={filesButton}
          onFoldAll={onFoldAll}
          onSplit={onSplit}
          split={split}
          stats={stats}
        />
      }
      variant="code"
    >
      {truncated ? (
        <div className={`${GUTTER} ${MEASURE}`}>
          <p className="border-rule text-ui border border-dashed px-4 py-3">
            This commit is too large to show whole: its files are listed by
            path, without their changes.
          </p>
        </div>
      ) : null}
      <DiffPane>
        {drawing ?? (
          <div className={PANE_SCROLLER}>
            <PlainDiff
              files={files}
              folded={folded}
              onFold={onFold}
              split={split}
            />
          </div>
        )}
      </DiffPane>
    </Workspace>
  );
};
