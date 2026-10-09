/**
 * One range's line of "why", shared by the server's table and the
 * browser's annotation rows: for a landing, "<subject> · <author> · <n>
 * credits · <verdict>", linking the commit, the ask, its answer and the
 * author; for a commit the project adopted, "<subject> · <author> · before
 * adoption". Then where to go from here: the file before this commit, and
 * the propose form about the range's first line. `LandingDetails` is the
 * whole landing, for the line dialog.
 */
import type { WhyView } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";

import { answerPath, askPath } from "../ask/ask-page.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import { CreditTrailers } from "../shared/credits.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { creditWords, priorHref, proposeHref, verdictWords } from "./rows.ts";
import type { WhyRow } from "./rows.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const ID = "font-mono text-[0.8125rem]";

const DOT = (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
);

/** The ask a landing answers, with its answer's page. */
const AskLinks = ({
  landing,
  project,
}: {
  readonly landing: LandingView;
  readonly project: ProjectName;
}) =>
  landing.ask === undefined ? null : (
    <>
      <a className={`${ID} ${LINK}`} href={askPath(project, landing.ask)}>
        {landing.ask}
      </a>
      <a className={LINK} href={answerPath(project, landing.ask)}>
        answer
      </a>
    </>
  );

/** "· <author> · before adoption", for a commit the project adopted. */
const Adopted = ({ author }: { readonly author: string }) => (
  <>
    {DOT}
    <span>{author}</span>
    {DOT}
    <span className="text-muted-foreground">before adoption</span>
  </>
);

/** "· <ask> answer · <author> · <n> credits · <verdict>", for a landing. */
const Landed = ({
  landing,
  project,
}: {
  readonly landing: LandingView;
  readonly project: ProjectName;
}) => {
  const verdict = Option.getOrUndefined(verdictWords(landing));

  return (
    <>
      {landing.ask === undefined ? null : (
        <>
          {DOT}
          <AskLinks landing={landing} project={project} />
        </>
      )}
      {DOT}
      <HandleLink handle={landing.author} />
      {DOT}
      <span>{creditWords(landing.credits.length)}</span>
      {verdict === undefined ? null : (
        <>
          {DOT}
          <span data-outcome={landing.verdict?.outcome._tag}>{verdict}</span>
        </>
      )}
    </>
  );
};

/** "<subject> · <author> · …" for one range. */
export const RangeSummary = ({
  project,
  row,
}: {
  readonly project: ProjectName;
  readonly row: WhyRow;
}) => {
  const commit = Option.getOrUndefined(row.commit);
  const landing = Option.getOrUndefined(row.landing);
  const subject = commit?.subject ?? shortSha(row.range.sha);

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <a
        className={`${LINK} font-medium [overflow-wrap:anywhere]`}
        href={commitHref(project, row.range.sha)}
      >
        {subject === "" ? "(no subject)" : subject}
      </a>
      {landing === undefined ? (
        <Adopted author={commit?.author.name ?? "unknown"} />
      ) : (
        <Landed landing={landing} project={project} />
      )}
    </span>
  );
};

/** Where to go from a range: the file before its commit, and a proposal about its first line. */
export const RangeLinks = ({
  line,
  project,
  row,
  view,
}: {
  readonly line: number;
  readonly project: ProjectName;
  readonly row: WhyRow;
  readonly view: WhyView;
}) => {
  const prior = Option.getOrUndefined(
    Option.flatMap(row.commit, (commit) =>
      priorHref(project, commit, view.path)
    )
  );

  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {prior === undefined ? null : (
        <a className={LINK} href={prior}>
          {Option.isSome(row.landing)
            ? "Prior to this landing"
            : "Prior to this commit"}
        </a>
      )}
      <a
        className={LINK}
        href={proposeHref(project, { at: view.at, line, path: view.path })}
      >
        Propose an ask about this line
      </a>
    </span>
  );
};

const LABEL = "text-xs font-medium text-muted-foreground";

/** A landing whole: its ask, author, verdict, when it landed, its credit and agents. */
export const LandingDetails = ({
  landing,
  project,
}: {
  readonly landing: LandingView;
  readonly project: ProjectName;
}) => {
  const verdict = verdictWords(landing);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {landing.ask === undefined ? null : (
          <>
            <dt className={LABEL}>Ask</dt>
            <dd className="flex gap-2">
              <AskLinks landing={landing} project={project} />
            </dd>
          </>
        )}
        <dt className={LABEL}>Author</dt>
        <dd>
          <HandleLink handle={landing.author} />
        </dd>
        {Option.isNone(verdict) ? null : (
          <>
            <dt className={LABEL}>Verdict</dt>
            <dd>{verdict.value}</dd>
          </>
        )}
        <dt className={LABEL}>Landed</dt>
        <dd>
          <a
            className={`${ID} ${LINK}`}
            href={commitHref(project, landing.sha)}
          >
            {shortSha(landing.sha)}
          </a>{" "}
          on {DateTime.formatIsoDateUtc(landing.landedAt)}
        </dd>
      </dl>
      <CreditTrailers
        assisted={landing.assisted}
        credits={landing.credits}
        {...(landing.heldBackTrailer === undefined
          ? {}
          : { heldBack: landing.heldBackTrailer })}
      />
    </div>
  );
};
