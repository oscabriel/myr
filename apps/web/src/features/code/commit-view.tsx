/**
 * One commit: its message, who wrote and committed it, its parents, the
 * people its trailers name (each a link to their page), and, when the
 * platform landed it, the landing's ask, answer and verdict. Below, the
 * files it changed against its first parent: a plain list from the
 * server, which the browser replaces with the file tree and the diffs
 * (`drawing`, from `client-code.tsx`). Unified by default; `?style=split`
 * sets the sides apart.
 */
import type {
  ChangedFile,
  CommitDiff,
  CommitView as Commit,
  Signature,
} from "@repo/protocol/domain/code";
import { CreditRole } from "@repo/protocol/domain/credit";
import { Handle } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Match, Option, Schema } from "effect";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { ProjectNav } from "../project/project-nav.tsx";
import { ID, LABEL, LINK } from "../shared/classes.ts";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { OutcomeView } from "../shared/outcome.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { blobHref, commitHref, shortSha, treeHref } from "./paths.ts";

const isRole = Schema.is(CreditRole);

const isHandle = Schema.is(Handle);

/** Each change as its mark says it. */
const statusWords = Match.type<ChangedFile["status"]>().pipe(
  Match.when("added", () => ({ mark: "A", words: "added" })),
  Match.when("modified", () => ({ mark: "M", words: "modified" })),
  Match.when("deleted", () => ({ mark: "D", words: "deleted" })),
  Match.exhaustive
);

/** The body without the trailer lines shown apart below it. */
const bodyWithoutTrailers = (commit: Commit) => {
  const trailers = new Set(
    commit.trailers.map(({ key, value }) => `${key}: ${value}`)
  );

  return commit.body
    .split("\n")
    .filter((line) => !trailers.has(line.trim()))
    .join("\n")
    .trim();
};

const Person = ({
  label,
  now,
  signature,
}: {
  readonly label: string;
  readonly now: DateTime.Utc;
  readonly signature: Signature;
}) => (
  <div className="flex min-w-0 flex-col">
    <dt className={LABEL}>{label}</dt>
    <dd className="[overflow-wrap:anywhere]">
      {signature.name}{" "}
      <span className="text-muted-foreground">
        <When at={signature.at} now={now} />
      </span>
    </dd>
  </div>
);

/**
 * The person a credit trailer names on a landing: its value's handle,
 * before any ` <email>` (`Asked-by: ines-v <ines-v@users.…>`). Only the
 * platform's own landings name its people; an imported commit's
 * `Signed-off-by:` names someone elsewhere, never a page here.
 */
const personIn = (landed: boolean, name: string, value: string) => {
  const handle = value.replace(/\s*<[^>]*>$/u, "");

  return landed && isRole(name) && isHandle(handle) ? handle : undefined;
};

/** A trailer: a landing's credit links the person; any other reads as written. */
const Trailer = ({
  landed,
  name,
  value,
}: {
  readonly landed: boolean;
  readonly name: string;
  readonly value: string;
}) => {
  const person = personIn(landed, name, value);

  return (
    <li className="[overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{name}:</span>{" "}
      {person === undefined ? value : <HandleLink handle={person} />}
    </li>
  );
};

/** The changed files by path, each linking its new version (or its old one, deleted). */
export const ChangedList = ({
  commit,
  files,
  project,
}: {
  readonly commit: Commit;
  readonly files: readonly ChangedFile[];
  readonly project: ProjectName;
}) => (
  <ul className={`flex flex-col gap-1 ${ID}`}>
    {files.map((file) => {
      const { mark, words } = statusWords(file.status);
      const at = file.status === "deleted" ? commit.parents[0] : commit.sha;

      return (
        <li
          className="flex min-w-0 items-baseline gap-2"
          data-file={file.path}
          key={file.path}
        >
          <span
            aria-label={words}
            className="text-muted-foreground w-3 shrink-0"
            title={words}
          >
            {mark}
          </span>
          {at === undefined ? (
            <span className="[overflow-wrap:anywhere]">{file.path}</span>
          ) : (
            <a
              className={`${LINK} [overflow-wrap:anywhere]`}
              href={blobHref(project, at, file.path)}
            >
              {file.path}
            </a>
          )}
        </li>
      );
    })}
  </ul>
);

export const CommitView = ({
  diff,
  drawing,
  now,
  project,
  split = false,
}: {
  readonly diff: CommitDiff;
  /**
   * The browser's file tree and diffs, holding `ChangedList` as their
   * fallback; the list alone when absent.
   */
  readonly drawing?: ReactNode;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  /** `?style=split`: old and new side by side. */
  readonly split?: boolean;
}) => {
  const { commit, files, truncated } = diff;
  const { landing } = commit;

  const linked =
    landing === undefined ? undefined : Option.getOrUndefined(askOf(landing));

  const body = bodyWithoutTrailers(commit);
  const here = commitHref(project, commit.sha);

  return (
    <PageShell
      title={
        commit.subject === ""
          ? `Commit ${shortSha(commit.sha)}`
          : commit.subject
      }
    >
      <ProjectNav current="landings" project={project} />
      <section aria-label="Commit" className="flex flex-col gap-4">
        <p className={`${ID} text-muted-foreground [overflow-wrap:anywhere]`}>
          commit {commit.sha} ·{" "}
          <a className={LINK} href={treeHref(project, commit.sha)}>
            Browse files
          </a>
        </p>
        {body === "" ? null : (
          <pre className="max-w-[80ch] font-mono text-[0.8125rem] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {body}
          </pre>
        )}
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <Person label="Author" now={now} signature={commit.author} />
          <Person label="Committer" now={now} signature={commit.committer} />
          <div className="flex min-w-0 flex-col">
            <dt className={LABEL}>
              {commit.parents.length === 1 ? "Parent" : "Parents"}
            </dt>
            <dd className={`flex flex-wrap gap-2 ${ID}`}>
              {commit.parents.length === 0
                ? "none: the first commit"
                : commit.parents.map((parent) => (
                    <a
                      className={LINK}
                      href={commitHref(project, parent)}
                      key={parent}
                    >
                      {shortSha(parent)}
                    </a>
                  ))}
            </dd>
          </div>
        </dl>
        {commit.trailers.length === 0 ? null : (
          <section aria-label="Trailers" className="flex flex-col gap-1.5">
            <h2 className={LABEL}>Trailers</h2>
            <ul className={`flex flex-col gap-1 ${ID}`}>
              {commit.trailers.map(({ key, value }) => (
                <Trailer
                  key={`${key}:${value}`}
                  landed={landing !== undefined}
                  name={key}
                  value={value}
                />
              ))}
            </ul>
          </section>
        )}
      </section>
      {landing === undefined ? (
        <p className="text-muted-foreground text-sm">
          The platform did not land this commit: it came in with the history the
          project adopted (before adoption).
        </p>
      ) : (
        <section
          aria-label="Landing"
          className="border-rule flex flex-col gap-3 border-t pt-4"
        >
          <h2 className="text-lg font-semibold">Landing</h2>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {linked === undefined ? null : (
              <>
                <div>
                  <dt className={LABEL}>
                    {linked.kind === "opened" ? "Opened" : "Ask"}
                  </dt>
                  <dd>
                    <a
                      className={`${ID} ${LINK}`}
                      href={askPath(project, linked.ask)}
                    >
                      {linked.ask}
                    </a>
                  </dd>
                </div>
                {linked.kind === "opened" ? null : (
                  <div>
                    <dt className={LABEL}>Answer</dt>
                    <dd>
                      <a
                        className={LINK}
                        href={answerPath(project, linked.ask)}
                      >
                        The answer and its checks
                      </a>
                    </dd>
                  </div>
                )}
              </>
            )}
            <div>
              <dt className={LABEL}>Author</dt>
              <dd>
                <HandleLink handle={landing.author} />
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Landed</dt>
              <dd>
                <When at={landing.landedAt} now={now} />
              </dd>
            </div>
          </dl>
          {landing.verdict === undefined ? null : (
            <OutcomeView outcome={landing.verdict.outcome} />
          )}
        </section>
      )}
      <section
        aria-label="Changes"
        className="flex min-w-0 flex-col gap-3"
        data-files=""
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {files.length} {files.length === 1 ? "file" : "files"} changed
          </h2>
          <p className="text-sm">
            {split ? (
              <a className={LINK} href={here}>
                Unified
              </a>
            ) : (
              <a className={LINK} href={`${here}?style=split`}>
                Split
              </a>
            )}
          </p>
        </div>
        {truncated ? (
          <p className="border-rule border border-dashed px-4 py-3 text-sm">
            This commit is too large to show whole: its files are listed by
            path, without their changes.
          </p>
        ) : null}
        {drawing === undefined || truncated ? (
          <ChangedList commit={commit} files={files} project={project} />
        ) : (
          drawing
        )}
      </section>
    </PageShell>
  );
};
