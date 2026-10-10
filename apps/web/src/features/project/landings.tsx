/**
 * A project's recent landings as one-line credits: what the landing did (the
 * ask it answered or opened), who is credited, in one sentence of roles,
 * and when. The full trailers are the landing's own, on its commit's page.
 */
import type { LandingView } from "@repo/protocol/domain/landing";
import { Option } from "effect";
import type { DateTime } from "effect";

import { CompactCredit } from "../shared/credits.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";

/** How many landings the project's home shows. */
export const RECENT_SHOWN = 3;

/**
 * A landing's subject line. The platform writes `Answer <ask>` on a landing
 * that answers an ask; `LandingView` carries no subject for the rest, so
 * those read by what they are: an ask's opening as `Open ask <ask>`, then a
 * decider's own landing and the first adoption.
 */
export const landingSubject = (landing: LandingView) =>
  Option.match(askOf(landing), {
    onNone: () =>
      landing.parent === undefined ? "First landing" : "Landed without an ask",
    onSome: ({ ask, kind }) =>
      kind === "opened" ? `Open ask ${ask}` : `Answer ${ask}`,
  });

/**
 * The landings the project's home shows, newest first: the last three
 * answers once three have landed, so the landings that set the project up
 * (its first push, its openings) give way to the work people did; before
 * then, the last three of any kind.
 */
export const recentShown = (
  landings: readonly LandingView[]
): readonly LandingView[] => {
  const answers = landings.filter((landing) => landing.ask !== undefined);

  return (answers.length >= RECENT_SHOWN ? answers : landings).slice(
    0,
    RECENT_SHOWN
  );
};

const Landing = ({
  landing,
  now,
}: {
  readonly landing: LandingView;
  readonly now: DateTime.Utc;
}) => {
  const linked = Option.getOrUndefined(askOf(landing));
  const subject = landingSubject(landing);

  return (
    <li
      className="text-ui flex min-w-0 flex-col gap-0.5 py-1.5"
      data-landing={landing.sha}
    >
      <span className="flex min-w-0 items-baseline justify-between gap-3">
        {linked === undefined ? (
          <span className="truncate font-medium">{subject}</span>
        ) : (
          <AppLink
            className="decoration-rule truncate font-medium no-underline hover:underline"
            title={subject}
            to={askPath(landing.project, linked.ask)}
          >
            {subject}
          </AppLink>
        )}
        <span className="text-label text-muted-foreground shrink-0 tabular-nums">
          <When at={landing.landedAt} now={now} />
        </span>
      </span>
      <span className="text-muted-foreground min-w-0 truncate">
        <CompactCredit credits={landing.credits} />
      </span>
    </li>
  );
};

/** The landings given, each as one line of credit. */
export const LandingList = ({
  landings,
  now,
}: {
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
}) => (
  <ol className="flex flex-col">
    {landings.map((landing) => (
      <Landing key={landing.sha} landing={landing} now={now} />
    ))}
  </ol>
);
