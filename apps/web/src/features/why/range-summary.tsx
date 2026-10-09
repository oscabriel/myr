/**
 * One range's line of "why", shared by the server's table and the
 * browser's annotation rows: for a landing, "<subject> · <ask> answer ·
 * <author> · <n> credits · <verdict>", linking the commit, the ask, its
 * answer and the author (an ask's opening reads "Open ask <ask>" instead,
 * linking the ask alone: it answers nothing); for a commit the project
 * adopted, "<subject> · <author> · before adoption". Then where to go from here: the file before this commit, and
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
import {
  askOf,
  creditWords,
  priorHref,
  proposeHref,
  verdictWords,
} from "./rows.ts";
import type { LandingAsk, WhyRow } from "./rows.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const ID = "font-mono text-[0.8125rem]";

const DOT = (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
);

/** The ask a landing links, as its id linking the ask's page. */
const AskLink = ({
  linked,
  project,
}: {
  readonly linked: LandingAsk;
  readonly project: ProjectName;
}) => (
  <a className={`${ID} ${LINK}`} href={askPath(project, linked.ask)}>
    {linked.ask}
  </a>
);

/** The words an opening's own commit subject says, which its row need not say again. */
const openingWords = (ask: string) => `Open ask ${ask}`;

/**
 * The ask a landing links: "<ask> answer" for the one it answers, with its
 * answer's page; "Open ask <ask>" for the one it opened, which has none, or
 * the ask alone when the commit's subject (`subject`) already says so.
 */
const AskLinks = ({
  linked,
  project,
  subject,
}: {
  readonly linked: LandingAsk;
  readonly project: ProjectName;
  readonly subject?: string;
}) => {
  const ask = <AskLink linked={linked} project={project} />;

  if (linked.kind === "opened") {
    return subject === openingWords(linked.ask) ? (
      ask
    ) : (
      <span>Open ask {ask}</span>
    );
  }

  return (
    <>
      {ask}
      <a className={LINK} href={answerPath(project, linked.ask)}>
        answer
      </a>
    </>
  );
};

/** "· <author> · before adoption", for a commit the project adopted. */
const Adopted = ({ author }: { readonly author: string }) => (
  <>
    {DOT}
    <span>{author}</span>
    {DOT}
    <span className="text-muted-foreground">before adoption</span>
  </>
);

/**
 * "· <ask> answer · <author> · <n> credits · <verdict>" for a landing, or
 * "· Open ask <ask> · …" for an ask's opening.
 */
const Landed = ({
  landing,
  project,
  subject,
}: {
  readonly landing: LandingView;
  readonly project: ProjectName;
  readonly subject: string;
}) => {
  const verdict = Option.getOrUndefined(verdictWords(landing));
  const linked = Option.getOrUndefined(askOf(landing));

  return (
    <>
      {linked === undefined ? null : (
        <>
          {DOT}
          <AskLinks linked={linked} project={project} subject={subject} />
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
        <Landed landing={landing} project={project} subject={subject} />
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
  const linked = Option.getOrUndefined(askOf(landing));

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {linked === undefined ? null : (
          <>
            <dt className={LABEL}>
              {linked.kind === "opened" ? "Opened ask" : "Ask"}
            </dt>
            <dd className="flex gap-2">
              {linked.kind === "opened" ? (
                <AskLink linked={linked} project={project} />
              ) : (
                <AskLinks linked={linked} project={project} />
              )}
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
