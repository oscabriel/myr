/**
 * The log from a revision along first parents, newest first, grouped by
 * the day each commit was committed (UTC), a page at a time. A landing
 * reads as the platform recorded it (`CommitView.landing`, never a
 * trailer): its ask, its author, its credit and its verdict. A commit with
 * no landing came in with the history the project adopted, and says so.
 */
import type { CommitView } from "@repo/protocol/domain/code";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { ProjectName, RepoPath } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";

import { ProjectNav } from "../project/project-nav.tsx";
import { ID, LINK } from "../shared/classes.ts";
import { CreditTrailers } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { askPath } from "../shared/paths.ts";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { LOG_PAGE } from "./log-page.ts";
import { Pager } from "./pager.tsx";
import { blobHref, commitHref, commitsHref, shortSha } from "./paths.ts";
import { revLabel } from "./rev.ts";

const isLanded = Outcome.isAnyOf(["Landed"]);

/** A day as its heading says it: "October 6, 2026". */
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

const Row = ({
  commit,
  now,
  project,
}: {
  readonly commit: CommitView;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}) => {
  const { landing } = commit;

  const linked =
    landing === undefined ? undefined : Option.getOrUndefined(askOf(landing));

  return (
    <li
      className="border-rule flex flex-col gap-2 border-t py-3"
      data-commit={commit.sha}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <a
          className={`${LINK} font-medium [overflow-wrap:anywhere]`}
          href={commitHref(project, commit.sha)}
        >
          {commit.subject === "" ? "(no subject)" : commit.subject}
        </a>
        <p className="text-muted-foreground flex items-baseline gap-2 text-sm">
          <a className={`${ID} ${LINK}`} href={commitHref(project, commit.sha)}>
            {shortSha(commit.sha)}
          </a>
          <span aria-hidden="true">·</span>
          <When at={commit.committer.at} now={now} />
        </p>
      </div>
      {landing === undefined ? (
        <p className="text-muted-foreground text-sm">
          {commit.author.name}, before adoption
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {linked === undefined ? null : (
              <span>
                <span className="text-muted-foreground text-xs font-medium">
                  {linked.kind === "opened" ? "Opened" : "Ask"}
                </span>{" "}
                <a
                  className={`${ID} ${LINK}`}
                  href={askPath(project, linked.ask)}
                >
                  {linked.ask}
                </a>
              </span>
            )}
            <span>
              <span className="text-muted-foreground text-xs font-medium">
                Author
              </span>{" "}
              <HandleLink handle={landing.author} />
            </span>
            {landing.verdict === undefined ? null : (
              <span data-outcome={landing.verdict.outcome._tag}>
                <span className="text-muted-foreground text-xs font-medium">
                  Verdict
                </span>{" "}
                {isLanded(landing.verdict.outcome)
                  ? "checked and landed"
                  : landing.verdict.outcome._tag}
              </span>
            )}
          </p>
          <CreditTrailers
            assisted={landing.assisted}
            credits={landing.credits}
            {...(landing.heldBackTrailer === undefined
              ? {}
              : { heldBack: landing.heldBackTrailer })}
          />
        </div>
      )}
    </li>
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

export const LogView = ({
  commits,
  from,
  next,
  now,
  path,
  project,
  rev,
}: {
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
}) => {
  const filter = path === undefined ? {} : { path };

  return (
    <PageShell
      title={
        path === undefined
          ? `Commits on ${revLabel(rev)}`
          : `History of ${path} on ${revLabel(rev)}`
      }
    >
      <ProjectNav current="landings" project={project} />
      {path === undefined ? null : (
        <p className="text-sm">
          <a className={LINK} href={blobHref(project, rev, path)}>
            Back to {path}
          </a>
        </p>
      )}
      {commits.length === 0 ? (
        <EmptyState title="No commits on this page." />
      ) : (
        byDay(commits).map(({ commits: ofDay, day }) => (
          <section
            aria-label={day}
            className="flex flex-col gap-1"
            data-day={day}
            key={day}
          >
            <h2 className="text-muted-foreground text-sm font-medium">
              Commits on{" "}
              {dayWords.format(
                DateTime.toDateUtc(ofDay[0]?.committer.at ?? now)
              )}
            </h2>
            <ol className="border-rule flex flex-col border-b">
              {ofDay.map((commit) => (
                <Row
                  commit={commit}
                  key={commit.sha}
                  now={now}
                  project={project}
                />
              ))}
            </ol>
          </section>
        ))
      )}
      <Pager
        newer={
          from > 0
            ? commitsHref(project, rev, newerPage(from, path))
            : undefined
        }
        older={
          next === undefined
            ? undefined
            : commitsHref(project, rev, { ...filter, from: next })
        }
      />
    </PageShell>
  );
};
