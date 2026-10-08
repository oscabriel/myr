/**
 * A project's recent landings, newest first: each one's subject line, its
 * commit, when it landed, its author, and its trailers exactly as the commit
 * carries them (`CreditTrailers`: credit, then `Held-back:`, then the agents
 * used, apart, since they are never credit).
 */
import type { LandingView } from "@repo/protocol/domain/landing";
import type { DateTime } from "effect";

import { CreditTrailers } from "../shared/credits.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { When } from "../shared/time.tsx";
import { ID, askPath } from "./asks.tsx";

/**
 * A landing's subject line. The platform writes `Answer <ask>` on a landing
 * that answers an ask; `LandingView` carries no subject for the rest (an
 * ask's opening, a decider's own landing, the first adoption), so those read
 * by what they are.
 */
export const landingSubject = (landing: LandingView) => {
  if (landing.ask !== undefined) {
    return `Answer ${landing.ask}`;
  }

  return landing.parent === undefined
    ? "First landing"
    : "Landed without an ask";
};

const short = (sha: string) => sha.slice(0, 7);

const Landing = ({
  landing,
  now,
}: {
  readonly landing: LandingView;
  readonly now: DateTime.Utc;
}) => (
  <li
    className="border-rule flex flex-col gap-3 border-t py-4"
    data-landing={landing.sha}
  >
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-base font-semibold [overflow-wrap:anywhere]">
        {landing.ask === undefined ? (
          landingSubject(landing)
        ) : (
          <a
            className="decoration-rule underline hover:decoration-current"
            href={askPath(landing.project, landing.ask)}
          >
            {landingSubject(landing)}
          </a>
        )}
      </h3>
      <p className="text-muted-foreground flex items-baseline gap-2 text-sm">
        <code className={ID} title={landing.sha}>
          {short(landing.sha)}
        </code>
        <span aria-hidden="true">·</span>
        <When at={landing.landedAt} now={now} />
      </p>
    </div>
    <p className="text-sm">
      <span className="text-muted-foreground text-xs font-medium">Author</span>{" "}
      <HandleLink handle={landing.author} />
    </p>
    <CreditTrailers
      assisted={landing.assisted}
      credits={landing.credits}
      {...(landing.heldBackTrailer === undefined
        ? {}
        : { heldBack: landing.heldBackTrailer })}
    />
  </li>
);

export const LandingList = ({
  landings,
  now,
}: {
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
}) => (
  <ol className="border-rule flex flex-col border-b">
    {landings.map((landing) => (
      <Landing key={landing.sha} landing={landing} now={now} />
    ))}
  </ol>
);
