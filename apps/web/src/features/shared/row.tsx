import type { AskListing } from "@repo/protocol/domain/ask";
import type { ClaimState } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";
import { Fragment } from "react";

import type { AskProgress } from "./ask-progress.ts";
import { ClaimAction } from "./copy-action.tsx";
import { useListKeys } from "./keys.tsx";
import { AppLink } from "./link.tsx";
import { STATE_MARKS, StateMarkIcon } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";
import { askPath } from "./paths.ts";
import { useSelection } from "./shell/selection.ts";
import type { SelectionParam } from "./shell/selection.ts";
import { When } from "./time.tsx";

export interface RowState {
  readonly mark: StateMark;
  readonly word: string;
  readonly time?: ReactNode;
  readonly stamp?: boolean;
}

export interface RowProps {
  readonly id: string;
  readonly href: string;
  readonly search?: Readonly<Record<string, string>> | undefined;
  readonly title: string;
  readonly meta?: ReactNode;
  readonly state?: RowState | undefined;
  readonly action?: ReactNode;
  readonly strip?: ReactNode;
  readonly data?: Readonly<
    Record<`data-${string}`, string | boolean | undefined>
  >;
  readonly size?: "two-line" | "one-line";
  readonly selected?: boolean | undefined;
  readonly mono?: boolean;
}

/**
 * Ink, the role's colour left to the mark, so a list of waiting asks is not an
 * olive stripe; a refusal keeps red and a landing green.
 */
export const wordTone = (mark: StateMark) => {
  if (mark === "refused" || mark === "retry") {
    return STATE_MARKS.refused.tone;
  }

  return mark === "landed" ? STATE_MARKS.landed.tone : "text-foreground";
};

export const MetaLine = ({
  parts,
}: {
  readonly parts: readonly (ReactNode | false | null | undefined)[];
}) => {
  const shown = parts.filter(
    (part) =>
      part !== undefined && part !== null && part !== false && part !== ""
  );

  return shown.map((part, index) => (
    <Fragment key={index}>
      {index === 0 ? null : " · "}
      {part}
    </Fragment>
  ));
};

export const MetaCode = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono">{children}</code>
);

export const territoryPart = (territory: string) =>
  territory === "." || territory === "" ? undefined : (
    <MetaCode>{territory}</MetaCode>
  );

const LINK =
  "text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid";

const StateEnd = ({
  state,
  stacked,
}: {
  readonly state: RowState | undefined;
  readonly stacked: boolean;
}) =>
  state === undefined ? null : (
    <div
      className={
        stacked
          ? "tablet:flex hidden w-40 shrink-0 flex-col items-end text-right leading-5"
          : "flex shrink-0 items-baseline gap-3"
      }
    >
      <span
        className={`text-ui font-medium ${stacked ? "leading-6" : ""} ${wordTone(state.mark)}`}
      >
        {state.word}
      </span>
      {state.time === undefined ? null : (
        <span className="text-label text-muted-foreground tabular-nums">
          {state.time}
        </span>
      )}
    </div>
  );

export const Row = ({
  action,
  data,
  href,
  id,
  meta,
  mono = false,
  search,
  selected = false,
  size = "two-line",
  state,
  strip,
  title,
}: RowProps) => {
  const weight = selected ? "font-semibold" : "font-medium";
  const face = mono ? "text-mono font-mono" : "";

  const link = (
    <AppLink
      aria-current={selected ? "true" : undefined}
      className={LINK}
      data-list-key={id}
      data-said=""
      search={search}
      title={title}
      to={href}
    >
      {title}
    </AppLink>
  );

  const mark =
    state === undefined ? null : (
      <StateMarkIcon mark={state.mark} stamp={state.stamp === true} />
    );

  // `isolate` keeps the row's raised controls inside the row, so a sticky
  // header passes over them.
  const rowClass = `group/row border-rule relative isolate -mx-2 border-b px-2 transition-colors duration-[120ms] ${
    selected ? "bg-surface hover:bg-surface-2" : "hover:bg-surface/50"
  }`;

  return (
    <li className={rowClass} data-selected={selected} {...data}>
      {size === "one-line" ? (
        <div className="flex h-10 min-w-0 items-center gap-3">
          <span className="flex w-5 shrink-0 justify-center">{mark}</span>
          <p className={`text-ui min-w-0 flex-1 truncate ${weight} ${face}`}>
            {link}
            {meta === undefined ? null : (
              <span className="text-muted-foreground ml-2 font-sans font-normal">
                {meta}
              </span>
            )}
          </p>
          <StateEnd stacked={false} state={state} />
          {action}
        </div>
      ) : (
        <div className="flex min-h-16 min-w-0 items-start gap-3 py-2.5">
          <span className="flex h-6 w-5 shrink-0 items-center justify-center">
            {mark}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Below a tablet the want, the one line that says what done
                means, may take two lines. */}
            <p
              className={`text-want tablet:line-clamp-1 line-clamp-2 break-words ${weight} ${face}`}
            >
              {link}
            </p>
            {meta === undefined && state === undefined ? null : (
              <p className="text-ui text-muted-foreground truncate leading-5">
                {state === undefined ? null : (
                  <span
                    className={`tablet:hidden font-medium ${wordTone(state.mark)}`}
                  >
                    {state.word}
                    {meta === undefined ? null : " · "}
                  </span>
                )}
                {meta}
              </p>
            )}
          </div>
          <StateEnd stacked state={state} />
          {action === undefined ? null : (
            <div className="flex h-11 shrink-0 items-center">{action}</div>
          )}
        </div>
      )}
      {strip === undefined ? null : (
        <div className={size === "one-line" ? "pb-2 pl-8" : "pb-2.5 pl-8"}>
          {strip}
        </div>
      )}
    </li>
  );
};

// Under the top bar, or under it and a page's toolbar (styles.css's `--stick-*`).
const STICK = {
  bar: "top-(--stick-bar)",
  toolbar: "top-(--stick-toolbar)",
} as const;

export const RowGroup = ({
  children,
  counts,
  facts,
  label,
  name,
  under = "toolbar",
}: {
  readonly name: ReactNode;
  readonly facts?: ReactNode;
  readonly counts?: string | undefined;
  readonly label?: string;
  readonly under?: keyof typeof STICK;
  readonly children: ReactNode;
}) => (
  <section aria-label={label} className="flex min-w-0 flex-col">
    <div
      className={`border-rule bg-background tablet:h-8 tablet:flex-nowrap tablet:py-0 sticky z-[5] -mx-2 flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-2 py-1 ${STICK[under]}`}
    >
      <h2 className="text-ui shrink-0 font-semibold [&_a]:no-underline [&_a:hover]:underline">
        {name}
      </h2>
      {facts === undefined ? null : (
        <div className="text-ui text-muted-foreground tablet:truncate flex min-w-0 items-center">
          {facts}
        </div>
      )}
      {counts === undefined ? null : (
        <p className="text-label text-muted-foreground ml-auto shrink-0 tabular-nums">
          {counts}
        </p>
      )}
    </div>
    <ul className="flex flex-col">{children}</ul>
  </section>
);

export const RowList = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <ul
    aria-label={label}
    className="border-rule -mx-2 flex flex-col border-t px-2"
  >
    {children}
  </ul>
);

export const useRowSelection = (
  ids: readonly string[],
  param: SelectionParam
) => {
  const { clear, selected } = useSelection(param);
  const { focused } = useListKeys(ids);

  return { clear, focused, selected };
};

export const outcomeState = (outcome: Outcome): RowState =>
  Outcome.match(outcome, {
    AwaitingDecision: (): RowState => ({ mark: "waiting", word: "Waiting" }),
    AwaitingFinish: (): RowState => ({ mark: "waiting", word: "Waiting" }),
    Checking: (): RowState => ({ mark: "checking", word: "Checking" }),
    Landed: (): RowState => ({ mark: "landed", word: "Landed" }),
    Refused: ({ refusals }): RowState => ({
      mark: refusals[0].retryable ? "retry" : "refused",
      word: "Refused",
    }),
    WaitingOnParent: (): RowState => ({ mark: "waiting", word: "Waiting" }),
  });

export const CLAIM_STATES = {
  answered: { mark: "landed", word: "Answered" },
  lapsed: { mark: "notNeeded", word: "Lapsed" },
  live: { mark: "claimed", word: "Claimed" },
  released: { mark: "notNeeded", word: "Given up" },
  warned: { mark: "waiting", word: "Warned, no push lately" },
} as const satisfies Record<ClaimState, RowState>;

const reserveWords = {
  newcomers: "Held for newcomers",
  people: "Held for people",
} as const;

const askState = (
  listing: AskListing,
  takeable: boolean | undefined,
  progress: AskProgress | undefined
): RowState => {
  if (progress?.landed !== undefined) {
    return { mark: "landed", word: "Landed" };
  }

  if (progress?.latest !== undefined) {
    return outcomeState(progress.latest);
  }

  if (listing.claimed || progress?.claimant !== undefined) {
    return { mark: "claimed", word: "Claimed" };
  }

  if (listing.blockedBy.length > 0) {
    return { mark: "waiting", word: "Waiting" };
  }

  if (listing.reserve !== undefined) {
    return { mark: "open", word: reserveWords[listing.reserve] };
  }

  return takeable === false
    ? { mark: "notYet", word: "Not open to you" }
    : { mark: "open", word: "Open to take" };
};

const askTime = (progress: AskProgress | undefined) =>
  progress?.lastPush?.at ?? progress?.rounds.at(-1)?.at ?? progress?.opened;

export const AskRow = ({
  listing,
  now,
  progress,
  project,
  selected,
  showProject = false,
  strip,
  takeable,
}: {
  readonly listing: AskListing;
  readonly project: ProjectName;
  readonly takeable?: boolean | undefined;
  readonly progress?: AskProgress | undefined;
  readonly selected?: boolean | undefined;
  readonly showProject?: boolean;
  readonly strip?: ReactNode;
  readonly now?: DateTime.Utc | undefined;
}) => {
  const at = askTime(progress);
  const standing = askState(listing, takeable, progress);

  const state =
    at === undefined || now === undefined
      ? standing
      : { ...standing, time: <When at={at} now={now} /> };

  const claimant = progress?.claimant;
  const rounds = progress?.rounds.length ?? 0;
  const open = state.mark === "open";

  return (
    <Row
      action={
        open && takeable !== false ? (
          <ClaimAction ask={listing.ask} project={project} />
        ) : undefined
      }
      data={{
        "data-ask": listing.ask,
        "data-project": project,
        "data-takeable": takeable,
      }}
      href={askPath(project, listing.ask)}
      id={listing.ask}
      meta={
        <MetaLine
          parts={[
            showProject ? project : undefined,
            listing.kind,
            territoryPart(listing.territory),
            <MetaCode key="id">{listing.ask}</MetaCode>,
            claimant === undefined ? undefined : `claimed by ${claimant}`,
            rounds === 0 ? undefined : `round ${rounds}`,
          ]}
        />
      }
      selected={selected}
      state={state}
      strip={strip}
      title={listing.want}
    />
  );
};
