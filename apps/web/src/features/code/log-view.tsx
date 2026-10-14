/**
 * The history of a revision: git's first-parent log, newest first, with the
 * platform's landing record on each commit that has one. On main the landings
 * run unbroken from the top down to the adoption, so the commits below the
 * first one without a record came with the import, and one marker row says so
 * in their place.
 */
import type { CommitView } from "@repo/protocol/domain/code";
import type { ProjectName, RepoPath } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";
import { LockKeyhole } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { CompactCredit } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { defaultShowOf, LOG_PAGE } from "./log-page.ts";
import type { LogShow } from "./log-page.ts";
import { Pager } from "./pager.tsx";
import { blobHref, commitHref, commitsHref, shortSha } from "./paths.ts";
import { isForkRev, pinnedRev, revLabel } from "./rev.ts";

export type { LogShow } from "./log-page.ts";

const dayWords = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

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

const linkedOf = (commit: CommitView) =>
  commit.landing === undefined
    ? undefined
    : Option.getOrUndefined(askOf(commit.landing));

const isLanding = (commit: CommitView) => commit.landing !== undefined;

export const shows = (show: LogShow, commit: CommitView) => {
  if (show === "all") {
    return true;
  }

  if (show === "landings") {
    return isLanding(commit);
  }

  const linked = linkedOf(commit);

  return show === "openings"
    ? linked?.kind === "opened"
    : linked?.kind === "answers";
};

/**
 * The commit the adoption's marker stands over: the first on the page with no
 * landing record that follows one with. Landings run unbroken from main's top
 * down to the adoption, and a fork's own commits sit above them, so the first
 * break after a landing is where the import's history begins.
 */
export const adoptedAt = (
  commits: readonly CommitView[]
): CommitView | undefined =>
  commits.find(
    (commit, at) =>
      !isLanding(commit) && at > 0 && isLanding(commits[at - 1] ?? commit)
  );

const LINK = "decoration-rule underline hover:decoration-current";

const Raised = ({ children }: { readonly children: ReactNode }) => (
  <span className="relative z-[1]">{children}</span>
);

const AdoptedHere = ({ sha }: { readonly sha: string }) => (
  <li
    className="border-rule text-ui text-muted-foreground -mx-2 border-b px-2 py-2"
    data-adopted={sha}
  >
    Adopted here. The commits below came with the import; no landing records
    them.
  </li>
);

const CommitRow = ({
  commit,
  now,
  project,
  rev,
}: {
  readonly commit: CommitView;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly rev: string;
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
      href={commitHref(project, pinnedRev(rev, commit.sha))}
      id={commit.sha}
      meta={
        landing === undefined ? (
          <MetaLine parts={[commit.author.name]} />
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
 * A path's history counts the commits the platform scanned, not those shown, so
 * where the page before began is not known: Newer goes back to the newest.
 */
const newerPage = (from: number, path: RepoPath | undefined) =>
  path === undefined ? { from: Math.max(0, from - LOG_PAGE) } : { path };

const FILTERS = [
  { label: "Landings", show: "landings" },
  { label: "Answers", show: "answers" },
  { label: "Ask openings", show: "openings" },
  { label: "Every commit", show: "all" },
] as const satisfies readonly {
  readonly label: string;
  readonly show: LogShow;
}[];

const FILTER =
  "text-ui text-muted-foreground hover:text-foreground aria-[current]:text-foreground flex h-10 items-center border-b-2 border-transparent px-1 no-underline aria-[current]:border-current aria-[current]:font-semibold";

/** "History of" a path, main or a fork, whose history moves; "History at" a tag or a commit, which stands still. */
export const titleOf = (path: RepoPath | undefined, rev: string) => {
  if (path !== undefined) {
    return `History of ${path}`;
  }

  return rev === "main" || isForkRev(rev)
    ? `History of ${revLabel(rev)}`
    : `History at ${revLabel(rev)}`;
};

const searchFor = (query: string, show: LogShow, fallback: LogShow) => {
  const search: Record<string, string> = Object.fromEntries(
    new URLSearchParams(query)
  );

  if (show !== fallback) {
    search.show = show;
  }

  return search;
};

const countsOf = (ofDay: readonly CommitView[]) => {
  const noun = ofDay.every(isLanding) ? "landing" : "commit";

  return `${ofDay.length} ${ofDay.length === 1 ? noun : `${noun}s`}`;
};

export interface LogViewProps {
  readonly commits: readonly CommitView[];
  readonly from: number;
  readonly next?: number | undefined;
  readonly now: DateTime.Utc;
  readonly path?: RepoPath | undefined;
  readonly project: ProjectName;
  readonly rev: string;
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
  show = defaultShowOf(rev, path),
}: LogViewProps) => {
  const fallback = defaultShowOf(rev, path);
  const filter = path === undefined ? {} : { path };
  const kind = show === fallback ? {} : { show };
  const shown = commits.filter((commit) => shows(show, commit));
  const adopted = show === "all" ? adoptedAt(commits) : undefined;
  const base = commitsHref(project, rev, filter);
  const [to, query = ""] = base.split("?");

  // The landings end at the adoption: once a page holds a commit no landing
  // records, no older page holds one either.
  const older =
    next === undefined || (show === "landings" && !commits.every(isLanding))
      ? undefined
      : commitsHref(project, rev, { ...filter, ...kind, from: next });

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
              search={searchFor(query, each, fallback)}
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
                counts={countsOf(ofDay)}
                label={day}
                name={dayWords.format(
                  DateTime.toDateUtc(ofDay[0]?.committer.at ?? now)
                )}
              >
                {ofDay.map((commit) => (
                  <Fragment key={commit.sha}>
                    {adopted?.sha === commit.sha ? (
                      <AdoptedHere sha={commit.sha} />
                    ) : null}
                    <CommitRow
                      commit={commit}
                      now={now}
                      project={project}
                      rev={rev}
                    />
                  </Fragment>
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
        older={older}
      />
    </Workspace>
  );
};
