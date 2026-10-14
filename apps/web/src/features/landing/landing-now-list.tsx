import { RecentLanding } from "@repo/protocol/domain/recent-landing";
import type { ShownRefusal } from "@repo/protocol/domain/recent-landing";
import type { ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option } from "effect";
import type { ReactNode } from "react";

import { commitHref } from "../code/paths.ts";
import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import { askPath, projectPath } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { When } from "../shared/time.tsx";
import { LandingNow } from "./landing-now.ts";

const labelOf = ({ area, tag }: ShownRefusal) =>
  area === undefined ? tag : `${tag} · ${area}`;

/** A refusal as the list may show it: its tag, then its area. */
const RefusalLabel = ({ refusal }: { readonly refusal: ShownRefusal }) => (
  <span className="text-mono font-mono" data-refusal={refusal.tag}>
    {labelOf(refusal)}
  </span>
);

/** A row's title: the ask's want as sentence text, or, when the list does not know it, the ask's id in mono. */
const titleOf = (want: string | undefined, code: string): ReactNode =>
  want ?? <span className="text-mono font-mono">{code}</span>;

/** A landing that answered or opened no ask is the project's first: its adoption, which no ask records. */
const FIRST_LANDING = "First landing";

/**
 * One row: the mark, the project over what landed or was refused, why it was refused, and when. Below `tablet` why
 * and when sit under the title in its column, so every row keeps one shape whatever the want's length.
 */
const Row = ({
  children,
  outcome,
  project,
  title,
  to,
  when,
}: {
  readonly children?: ReactNode;
  readonly outcome: "landed" | "refused";
  readonly project: ProjectName;
  readonly title: ReactNode;
  readonly to: string;
  readonly when: ReactNode;
}) => (
  <li
    className="border-rule tablet:flex grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b py-2.5"
    data-outcome={outcome}
    data-project={project}
  >
    <StateMarkIcon mark={outcome} />
    <div className="flex min-w-48 flex-1 flex-col gap-0.5">
      <AppLink
        className="text-ui text-muted-foreground no-underline hover:underline"
        to={projectPath(project)}
      >
        {project}
      </AppLink>
      <AppLink
        className="text-want font-medium [overflow-wrap:anywhere] no-underline hover:underline"
        to={to}
      >
        {title}
      </AppLink>
    </div>
    {children}
    <p className="text-ui tablet:w-32 tablet:text-right col-start-2 shrink-0 tabular-nums">
      {when}
    </p>
  </li>
);

const keyOf = (landing: RecentLanding) =>
  [
    landing.project,
    DateTime.formatIso(landing.at),
    RecentLanding.guards.Landed(landing) ? landing.sha : landing.ask,
  ].join(":");

const rowOf = (landing: RecentLanding, now: DateTime.Utc) =>
  RecentLanding.match(landing, {
    Landed: ({ answered, at, opened, project, sha, want }) => (
      <Row
        key={keyOf(landing)}
        outcome="landed"
        project={project}
        title={Option.match(Option.fromUndefinedOr(answered ?? opened), {
          onNone: () => want ?? FIRST_LANDING,
          onSome: (ask) => titleOf(want, ask),
        })}
        to={commitHref(project, sha)}
        when={
          <>
            <span className="text-landed font-medium">Landed</span>{" "}
            <span className="text-muted-foreground">
              <When at={at} now={now} />
            </span>
          </>
        }
      />
    ),
    Refused: ({ ask, at, project, refusals, want }) => (
      <Row
        key={keyOf(landing)}
        outcome="refused"
        project={project}
        title={titleOf(want, ask)}
        to={askPath(project, ask)}
        when={
          <>
            <span className="text-refused font-medium">Refused</span>{" "}
            <span className="text-muted-foreground">
              <When at={at} now={now} />
            </span>
          </>
        }
      >
        <p className="text-ui tablet:max-w-64 tablet:text-right col-start-2 flex flex-wrap gap-x-3 gap-y-0.5">
          {/* Two lanes failing read as one tag: the list names no lane. */}
          {Arr.dedupeWith(
            refusals,
            (one, other) => labelOf(one) === labelOf(other)
          ).map((refusal) => (
            <RefusalLabel key={labelOf(refusal)} refusal={refusal} />
          ))}
        </p>
      </Row>
    ),
  });

/** The latest landings and refused answers, each its project, what landed or was refused, why, and when; or why there are none. */
export const LandingNowList = ({
  landings,
}: {
  readonly landings: LandingNow;
}) =>
  LandingNow.match(landings, {
    Listed: ({ landings: listed, now }) =>
      listed.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Nothing has landed on a public project yet.
        </p>
      ) : (
        <ul className="border-rule flex flex-col border-t">
          {listed.map((landing) => rowOf(landing, now))}
        </ul>
      ),
    Unreachable: () => <UnreachableNotice />,
  });
