/**
 * The landings: the log from a revision along first parents, newest first,
 * a page at a time, under a sticky header per day (UTC). One row per
 * commit: its subject, then what it did (the ask it answered or opened),
 * its credit in one line, and "held back" with its lock when sealed checks
 * judged it; at the right its short id over its age. A commit the platform
 * did not land came in with the history the project adopted, and says so.
 *
 * The toolbar filters the page: every commit, the answers, or the asks'
 * openings. A landing reads as the platform recorded it
 * (`CommitView.landing`), never from a trailer.
 */
import type { CommitView } from "@repo/protocol/domain/code";
import type { ProjectName, RepoPath } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { CompactCredit } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { LOG_PAGE } from "./log-page.ts";
import { Pager } from "./pager.tsx";
import { blobHref, commitHref, commitsHref, shortSha } from "./paths.ts";
import { revLabel } from "./rev.ts";

/** Which commits the page shows: all of them, the answers, or the asks' openings. */
export type LogShow = "all" | "answers" | "openings";

/** A day as its header says it: "October 6, 2026". */
const dayWords = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** The commits of each day, in the order given, each day once. */
export const byDay = (commits: readonly CommitView[]) => {
  const days: { readonly day: string; readonly commits: CommitView[] }[] = [];

  for (const commit of commits) {
    const day = DateTime.formatIsoDateUtc(commit.committer.at);
    const last = days.at(-1);

    if (last?.day === day) {
      last.commits.push(commit);
    } else {
      days.push({ commits: [commit], day });
    }
  }

  return days;
};

/** What a commit did: the ask it answered or opened, when it is a landing that did. */
const linkedOf = (commit: CommitView) =>
  commit.landing === undefined
    ? undefined
    : Option.getOrUndefined(askOf(commit.landing));

/** Whether `commit` belongs on the page `show` asks for. */
export const shows = (show: LogShow, commit: CommitView) => {
  if (show === "all") {
    return true;
  }

  const linked = linkedOf(commit);

  return show === "openings"
    ? linked?.kind === "opened"
    : linked?.kind === "answers";
};

const LINK = "decoration-rule underline hover:decoration-current";

/** A part of a row's second line that holds links: above the row's own link, so it can be pressed. */
const Raised = ({ children }: { readonly children: ReactNode }) => (
  <span className="relative z-[1]">{children}</span>
);

/** One commit's row. */
const CommitRow = ({
  commit,
  now,
  project,
}: {
  readonly commit: CommitView;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}) => {
  const { landing } = commit;
  const linked = linkedOf(commit);

  return (
    <Row
      action={
        <span className="flex w-20 flex-col items-end leading-5">
          <MetaCode>{shortSha(commit.sha)}</MetaCode>
          <span className="text-label text-muted-foreground tabular-nums">
            <When at={commit.committer.at} now={now} />
          </span>
        </span>
      }
      data={{ "data-commit": commit.sha }}
      href={commitHref(project, commit.sha)}
      id={commit.sha}
      meta={
        landing === undefined ? (
          <MetaLine parts={[commit.author.name, "before adoption"]} />
        ) : (
          <MetaLine
            parts={[
              linked === undefined ? undefined : (
                <Raised key="ask">
                  {linked.kind === "opened" ? "Opened " : null}
                  <AppLink
                    className={`text-mono font-mono ${LINK}`}
                    to={askPath(project, linked.ask)}
                  >
                    {linked.ask}
                  </AppLink>
                </Raised>
              ),
              <Raised key="credit">
                <CompactCredit credits={landing.credits} />
              </Raised>,
              landing.heldBackTrailer === undefined ? undefined : (
                <span
                  className="text-sealed inline-flex items-center gap-1"
                  key="held"
                  title={landing.heldBackTrailer}
                >
                  <LockKeyhole
                    aria-hidden="true"
                    className="size-3.5"
                    strokeWidth={1.75}
                  />
                  held back
                </span>
              ),
            ]}
          />
        )
      }
      title={commit.subject === "" ? "(no subject)" : commit.subject}
    />
  );
};

/**
 * Where the page before the one at `from` starts. A whole log's `from`
 * counts commits, so that page is one `LOG_PAGE` back. A path's history
 * counts the commits the platform scanned (up to 200 a call, most of
 * which may not touch the path), so where the page before began is not
 * known: Newer goes back to the newest.
 */
const newerPage = (from: number, path: RepoPath | undefined) =>
  path === undefined ? { from: Math.max(0, from - LOG_PAGE) } : { path };

const FILTERS = [
  { label: "All", show: "all" },
  { label: "Answers", show: "answers" },
  { label: "Ask openings", show: "openings" },
] as const satisfies readonly {
  readonly label: string;
  readonly show: LogShow;
}[];

const FILTER =
  "text-ui text-muted-foreground hover:text-foreground aria-[current]:text-foreground flex h-10 items-center border-b-2 border-transparent px-1 no-underline aria-[current]:border-current aria-[current]:font-semibold";

/** The page's title: the landings at the revision, or one path's history. */
const titleOf = (path: RepoPath | undefined, rev: string) => {
  if (path !== undefined) {
    return `History of ${path}`;
  }

  return rev === "main" ? "Landings" : `Landings on ${revLabel(rev)}`;
};

/** The page's search with `show`: none for every commit. */
const searchFor = (query: string, show: LogShow) => {
  const search: Record<string, string> = Object.fromEntries(
    new URLSearchParams(query)
  );

  if (show !== "all") {
    search.show = show;
  }

  return search;
};

export interface LogViewProps {
  readonly commits: readonly CommitView[];
  /** Where this page starts. */
  readonly from: number;
  /** Where the next (older) page starts; absent on the last. */
  readonly next?: number | undefined;
  readonly now: DateTime.Utc;
  /** Only the commits that changed this path. */
  readonly path?: RepoPath | undefined;
  readonly project: ProjectName;
  readonly rev: string;
  /** Which commits of the page to show. */
  readonly show?: LogShow;
}

export const LogView = ({
  commits,
  from,
  next,
  now,
  path,
  project,
  rev,
  show = "all",
}: LogViewProps) => {
  const filter = path === undefined ? {} : { path };
  // The pager keeps the kind the page shows.
  const kind = show === "all" ? {} : { show };
  const shown = commits.filter((commit) => shows(show, commit));
  const base = commitsHref(project, rev, filter);
  const [to, query = ""] = base.split("?");

  return (
    <Workspace
      title={titleOf(path, rev)}
      toolbar={
        <nav aria-label="Show" className="flex h-full items-center gap-4">
          {FILTERS.map(({ label, show: each }) => (
            <AppLink
              aria-current={show === each ? "page" : undefined}
              className={FILTER}
              key={each}
              search={searchFor(query, each)}
              to={to ?? base}
            >
              {label}
            </AppLink>
          ))}
        </nav>
      }
      variant="list"
    >
      {path === undefined ? null : (
        <p className="text-ui">
          <AppLink className={LINK} to={blobHref(project, rev, path)}>
            Back to {path}
          </AppLink>
        </p>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={
            commits.length === 0
              ? "No commits on this page."
              : "None of this page's commits are of this kind."
          }
        />
      ) : (
        <div className="flex flex-col">
          {byDay(shown).map(({ commits: ofDay, day }) => (
            <div data-day={day} key={day}>
              <RowGroup
                counts={`${ofDay.length} ${ofDay.length === 1 ? "commit" : "commits"}`}
                label={day}
                name={dayWords.format(
                  DateTime.toDateUtc(ofDay[0]?.committer.at ?? now)
                )}
              >
                {ofDay.map((commit) => (
                  <CommitRow
                    commit={commit}
                    key={commit.sha}
                    now={now}
                    project={project}
                  />
                ))}
              </RowGroup>
            </div>
          ))}
        </div>
      )}
      <Pager
        newer={
          from > 0
            ? commitsHref(project, rev, { ...newerPage(from, path), ...kind })
            : undefined
        }
        older={
          next === undefined
            ? undefined
            : commitsHref(project, rev, { ...filter, ...kind, from: next })
        }
      />
    </Workspace>
  );
};
