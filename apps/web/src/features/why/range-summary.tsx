import type { WhyView } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";

import { commitHref, shortSha } from "../code/paths.ts";
import { CreditTrailers } from "../shared/credits.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { LandingWords } from "./band.tsx";
import {
  askOf,
  linesWords,
  priorHref,
  proposeHref,
  verdictWords,
} from "./rows.ts";
import type { WhyRow } from "./rows.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const LABEL = "text-label text-muted-foreground";

export const BandLinks = ({
  project,
  row,
  view,
}: {
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
    <span className="text-label text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 font-normal">
      <a className={LINK} href={`#L${row.range.start}`}>
        {linesWords(row.range)}
      </a>
      {prior === undefined ? null : (
        <AppLink className={LINK} to={prior}>
          why, one step back
        </AppLink>
      )}
      <a
        className={LINK}
        href={proposeHref(project, {
          at: view.at,
          line: row.range.start,
          path: view.path,
        })}
      >
        Propose an ask about this line
      </a>
    </span>
  );
};

export const WhyBand = ({
  now,
  project,
  row,
  view,
}: {
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly row: WhyRow;
  readonly view: WhyView;
}) => (
  <div
    className="border-rule bg-surface text-ui flex min-h-14 flex-col justify-center gap-0.5 border-y px-3 py-1.5 font-sans"
    data-range={`${row.range.start}-${row.range.end}`}
  >
    <p className="min-w-0 [overflow-wrap:anywhere]">
      <LandingWords
        commit={row.commit}
        landing={row.landing}
        now={now}
        project={project}
        sha={row.range.sha}
      />
    </p>
    <BandLinks project={project} row={row} view={view} />
  </div>
);

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
    <div className="text-ui flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {linked === undefined ? null : (
          <>
            <dt className={LABEL}>
              {linked.kind === "opened" ? "Opened ask" : "Ask"}
            </dt>
            <dd className="flex gap-2">
              <AppLink
                className={`text-mono font-mono ${LINK}`}
                to={askPath(project, linked.ask)}
              >
                {linked.ask}
              </AppLink>
              {linked.kind === "opened" ? null : (
                <AppLink className={LINK} to={answerPath(project, linked.ask)}>
                  answer
                </AppLink>
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
          <AppLink
            className={`text-mono font-mono ${LINK}`}
            to={commitHref(project, landing.sha)}
          >
            {shortSha(landing.sha)}
          </AppLink>{" "}
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
