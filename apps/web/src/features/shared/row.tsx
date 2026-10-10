/**
 * One row for every list: asks, decisions, landings, commits, refs, forks,
 * credits, rounds, history. Two lines, the thing first and its state at
 * the right:
 *
 *   [mark] the want or subject, the link          [state word]  [copy]
 *          kind · territory · id (metadata)       [time]
 *
 * - Line 1 is the thing in its own words, one line, ellipsised, the whole
 *   text its `title`; it is the link, never the id.
 * - Line 2 is metadata, parted by ` · `; a value that means nothing (the
 *   whole repo's territory, ".") is left out (`MetaLine`).
 * - The state's mark sits in its own column and its word at the right, in
 *   its role; the mark is hidden from screen readers, the word is not.
 * - A row with a command has one copy action, the command as text inside it.
 *
 * From the shell's width a click anywhere off the link selects the row
 * (its facts fill the inspector); below it the whole row is the link's to
 * press. `j` and `k` reach each row's link (`data-list-key`). Every
 * `data-*` a list carries sits on the row's `<li>`.
 */
import type { AskListing } from "@repo/protocol/domain/ask";
import type { ClaimState } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { ProjectName } from "@repo/protocol/ids";
import type { MouseEvent, ReactNode } from "react";
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

/** A row's state: its mark, its word, and when (a `When`, or words). */
export interface RowState {
  readonly mark: StateMark;
  readonly word: string;
  readonly time?: ReactNode;
  /** Settle the mark once: it landed while the page was open. */
  readonly stamp?: boolean;
}

export interface RowProps {
  /** The thing's id: what selection and `j`/`k` name it by. */
  readonly id: string;
  /** Its page. */
  readonly href: string;
  /** The page's search, when the row names one state of it (`?head=`). */
  readonly search?: Readonly<Record<string, string>> | undefined;
  /** Line 1: the want, the subject, the commit's first line. */
  readonly title: string;
  /** Line 2 (or, one-line, after the title): metadata (`MetaLine`). */
  readonly meta?: ReactNode;
  readonly state?: RowState | undefined;
  /** A `CopyAction`, at the row's end. */
  readonly action?: ReactNode;
  /** A third line under the two: a family's fan. */
  readonly strip?: ReactNode;
  /**
   * What the row stands for, on its `<li>` (`data-ask`, `data-takeable`, …);
   * an attribute left undefined is left out.
   */
  readonly data?: Readonly<
    Record<`data-${string}`, string | boolean | undefined>
  >;
  readonly size?: "two-line" | "one-line";
  /** The row whose facts the inspector shows. */
  readonly selected?: boolean | undefined;
  /** Select the row, from the shell's width (`useRowSelection`). */
  readonly onSelect?: ((id: string) => void) | undefined;
  /** Line 1 is code (a ref, a fork's name): set it in mono. */
  readonly mono?: boolean;
}

/** The shell's width, from which a row selects rather than opens. */
const SHELL_WIDTH = "(min-width: 70rem)";

/**
 * The word's colour: the state's role; ink for open and claimed, which have
 * none. A refusal that can be retried keeps its ochre mark, but its word is
 * a refusal's, as the status line says it.
 */
const wordTone = (mark: StateMark) => {
  if (mark === "open" || mark === "claimed") {
    return "text-foreground";
  }

  return mark === "retry" ? "text-refused" : STATE_MARKS[mark].tone;
};

/** Whether a press on `target` was meant for a link or a control in the row. */
const onControl = (target: EventTarget) =>
  target instanceof Element &&
  target.closest("a, button, summary, input, select, textarea") !== null;

/** Metadata parted by ` · `, with every empty part left out. */
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

/** Code in a row's metadata: an id, a territory, a SHA. */
export const MetaCode = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono">{children}</code>
);

/** A territory as a row shows it: nothing for the whole repo. */
export const territoryPart = (territory: string) =>
  territory === "." || territory === "" ? undefined : (
    <MetaCode>{territory}</MetaCode>
  );

const LINK =
  "text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid";

/** From the shell's width a row that selects lets a press off its link through to the row. */
const SELECTS = "shell:after:pointer-events-none";

/** A press on the row, off its link and its controls, selects it from the shell's width. */
const selectOnPress =
  (id: string, onSelect: ((id: string) => void) | undefined) =>
  (event: MouseEvent<HTMLLIElement>) => {
    if (
      onSelect !== undefined &&
      !onControl(event.target) &&
      globalThis.matchMedia(SHELL_WIDTH).matches
    ) {
      onSelect(id);
    }
  };

/** The row's state at its end: the word in its role, over (or beside) its time. */
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
  onSelect,
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
      className={onSelect === undefined ? LINK : `${LINK} ${SELECTS}`}
      data-list-key={id}
      // The thing in its own words: a want, a subject, a commit's line.
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

  // `isolate` keeps the row's raised controls (its copy button, a fan's
  // nodes) inside the row, so a sticky header passes over them.
  const rowClass = `group/row border-rule relative isolate -mx-2 border-b px-2 transition-colors duration-[120ms] ${
    selected ? "bg-surface" : "hover:bg-surface/50"
  }`;

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- selecting by a click off the link is the pointer's twin of j and k
    <li
      className={rowClass}
      data-selected={selected}
      onClick={selectOnPress(id, onSelect)}
      {...data}
    >
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
            <p className={`text-want truncate ${weight} ${face}`}>{link}</p>
            {meta === undefined && state === undefined ? null : (
              <p className="text-ui text-muted-foreground truncate leading-5">
                {state === undefined ? null : (
                  // On a phone the want takes the width; its state leads line 2.
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

/** Where a group's header sticks: under the toolbar, or under the context bar when the list has none. */
const STICK = {
  bar: "top-[2.6875rem] tablet:top-[2.9375rem] shell:top-[2.6875rem]",
  toolbar: "top-[5.1875rem] tablet:top-[5.4375rem] shell:top-[5.1875rem]",
} as const;

/** A list's group: a sticky header (its name as a link, its facts, its counts), then its rows. */
export const RowGroup = ({
  children,
  counts,
  facts,
  label,
  name,
  under = "toolbar",
}: {
  readonly name: ReactNode;
  /** The group's facts after its name: a project's posture. */
  readonly facts?: ReactNode;
  /** Its counts at the end, in words: "7 open · 6 to take". */
  readonly counts?: string | undefined;
  /** The group's name in words, for its list (the name may be a link). */
  readonly label?: string;
  /** What the header sticks under. */
  readonly under?: keyof typeof STICK;
  readonly children: ReactNode;
}) => (
  <section aria-label={label} className="flex min-w-0 flex-col">
    <div
      // On a phone a long posture wraps under the name rather than losing
      // its last word; from a tablet the header is one 32 px line.
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

/** A list of rows with no groups. */
export const RowList = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  // The top hairline runs as wide as the rows' own (each row reaches 8 px
  // past the list on either side, for its fill).
  <ul
    aria-label={label}
    className="border-rule -mx-2 flex flex-col border-t px-2"
  >
    {children}
  </ul>
);

/**
 * A list's selection and keys together: the row selected (from the
 * address), the one `j`/`k` rest on, and the select to hand each row.
 */
export const useRowSelection = (
  ids: readonly string[],
  param: SelectionParam
) => {
  const { clear, select, selected } = useSelection(param);
  const { focused } = useListKeys(ids, select);

  return { clear, focused, select, selected };
};

/** An answer's latest outcome as a row's state: a retryable refusal turns back. */
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

/** Each claim state as a row says it: its mark and its word. */
export const CLAIM_STATES = {
  answered: { mark: "landed", word: "Answered" },
  lapsed: { mark: "notNeeded", word: "Lapsed" },
  live: { mark: "claimed", word: "Claimed" },
  released: { mark: "notNeeded", word: "Given up" },
  warned: { mark: "waiting", word: "Warned, no push lately" },
} as const satisfies Record<ClaimState, RowState>;

/** Where an open ask stands for its reader, as a row's state. */
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

  if (takeable === false) {
    return { mark: "notYet", word: "Not open to you" };
  }

  if (takeable === undefined && listing.reserve !== undefined) {
    return {
      mark: "open",
      word:
        listing.reserve === "newcomers"
          ? "Held for newcomers"
          : "Held for people",
    };
  }

  return { mark: "open", word: "Open to take" };
};

/** Who an ask is held for, in a row's metadata. */
const reserveWords = {
  newcomers: "held for newcomers",
  people: "held for people, not agents",
} as const;

/**
 * An open ask as a row: its want, its kind, territory and id, where it
 * stands (from the listing, and the event fold when the page has it), and
 * the claim command when the reader may take it.
 */
export const AskRow = ({
  listing,
  onSelect,
  progress,
  project,
  selected,
  showProject = false,
  strip,
  takeable,
}: {
  readonly listing: AskListing;
  readonly project: ProjectName;
  /** Whether the viewer may take it (the front page knows); a project's page does not say. */
  readonly takeable?: boolean | undefined;
  /** The ask's progress from the project's events, when the page folds them. */
  readonly progress?: AskProgress | undefined;
  readonly selected?: boolean | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  /** Name the project in the metadata: a list across projects with no groups. */
  readonly showProject?: boolean;
  /** A family's fan, when the ask is a parent. */
  readonly strip?: ReactNode;
}) => {
  const state = askState(listing, takeable, progress);
  const claimant = progress?.claimant;
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
            listing.reserve === undefined || takeable === undefined
              ? undefined
              : reserveWords[listing.reserve],
          ]}
        />
      }
      onSelect={onSelect}
      selected={selected}
      state={state}
      strip={strip}
      title={listing.want}
    />
  );
};
