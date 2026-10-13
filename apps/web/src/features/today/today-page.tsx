import { Brand } from "@repo/brand";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Array as Arr, Option, Order } from "effect";
import type { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { signInHref } from "../auth/session-slot.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import { stuckAboveBar } from "../decision/choices.tsx";
import { DecisionCard } from "../decision/decision-card.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import {
  consequenceOf,
  decisionHref,
  decisionKey,
  describeDefault,
  describeSubject,
  subjectKind,
  takenWords,
  tookEffect,
} from "../decision/subject.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { useListKeys } from "../shared/keys.tsx";
import { AppLink } from "../shared/link.tsx";
import { personPath } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { RefusalView } from "../shared/refusal.tsx";
import { MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import { distanceInWords, When } from "../shared/time.tsx";
import { expiringSoon, expiryOrder, readOfCause, TodayRead } from "./read.ts";

export {
  findDecision,
  orderDecisions,
  readOfCause,
  TodayPageData,
  TodayRead,
} from "./read.ts";

const counted = (count: number) => (count === 0 ? "none" : String(count));

export const budgetSentence = (budget: Today["budget"]) =>
  `Decisions: ${budget.used} taken, ${counted(Math.max(0, budget.total - budget.used))} left today. Finishes are counted apart: ${counted(budget.finishes)} taken.`;

const budgetShort = (budget: Today["budget"]) =>
  `${counted(Math.max(0, budget.total - budget.used))} left today`;

const WHAT_TODAY_IS =
  "Today is a maintainer's page: the decisions you owe your projects each day, each with its evidence and a safe default if you leave it.";

interface Listed {
  readonly decision: Decision;
  readonly soon: boolean;
}

const choiceOf = (decision: Decision) => decision.decided?.choice;

const openState = (listed: Listed, now: DateTime.Utc) => ({
  mark: listed.soon ? ("waiting" as const) : ("notYet" as const),
  time: `default: ${listed.decision.default}`,
  word: distanceInWords(listed.decision.expiresAt, now),
});

const OpenHere = ({
  decision,
  onToggle,
  open,
}: {
  readonly decision: Decision;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => (
  <button
    aria-controls={`here-${decisionKey(decision).replace("/", "-")}`}
    aria-expanded={open}
    aria-label={`${open ? "Close" : "Decide"} here: ${describeSubject(decision.subject)}`}
    className="text-muted-foreground hover:text-foreground hover:bg-surface relative z-10 inline-flex size-11 shrink-0 items-center justify-center transition-colors duration-[120ms]"
    onClick={onToggle}
    type="button"
  >
    <ChevronDown
      aria-hidden="true"
      className={`size-5 transition-transform duration-[180ms] ${open ? "rotate-180" : ""}`}
      strokeWidth={1.75}
    />
  </button>
);

interface RowsProps {
  readonly busy: boolean;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly open: string | undefined;
  readonly onOpen: (key: string | undefined) => void;
  readonly selected: string | undefined;
  readonly stamped: ReadonlySet<string>;
}

const DecisionRow = ({
  listed,
  props,
}: {
  readonly listed: Listed;
  readonly props: RowsProps;
}) => {
  const { decision } = listed;
  const key = decisionKey(decision);
  const choice = choiceOf(decision);
  const isOpen = props.open === key && choice === undefined;

  const state =
    choice === undefined
      ? openState(listed, props.now)
      : {
          mark: tookEffect(decision, choice)
            ? ("landed" as const)
            : ("notNeeded" as const),
          stamp: props.stamped.has(key),
          word: takenWords[choice],
        };

  return (
    <Row
      action={
        choice === undefined ? (
          <OpenHere
            decision={decision}
            onToggle={() => {
              props.onOpen(isOpen ? undefined : key);
            }}
            open={isOpen}
          />
        ) : undefined
      }
      data={{
        "data-decided": choice,
        "data-decision": decision.id,
        "data-project": decision.project,
        "data-soon": listed.soon,
      }}
      href={decisionHref(decision)}
      id={key}
      meta={
        choice === undefined ? (
          <MetaLine
            parts={[
              decision.project,
              subjectKind(decision.subject),
              <MetaCode key="id">{decision.id}</MetaCode>,
            ]}
          />
        ) : (
          consequenceOf(decision.subject, choice)
        )
      }
      selected={props.selected === key}
      state={state}
      strip={
        choice === undefined ? (
          <div
            className={`pr-2 ${isOpen ? "animate-in fade-in-0 slide-in-from-top-1 pb-1 duration-[180ms]" : "hidden"}`}
            id={`here-${key.replace("/", "-")}`}
          >
            <DecisionCard
              busy={props.busy}
              choices={stuckAboveBar}
              decision={decision}
              now={props.now}
              onDecide={props.onDecide}
              soon={listed.soon}
            />
          </div>
        ) : undefined
      }
      title={describeSubject(decision.subject)}
    />
  );
};

const Section = ({
  children,
  count,
  name,
}: {
  readonly children: ReactNode;
  readonly name: string;
  readonly count?: string;
}) => (
  <RowGroup
    {...(count === undefined ? {} : { counts: count })}
    label={name}
    name={name}
    under="bar"
  >
    {children}
  </RowGroup>
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const DecisionSections = ({
  listed,
  props,
}: {
  readonly listed: readonly Listed[];
  readonly props: RowsProps;
}) => {
  const dueToday = listed.filter(({ soon }) => soon);
  const later = listed.filter(({ soon }) => !soon);

  return (
    <>
      {dueToday.length === 0 ? null : (
        <Section
          count={plural(dueToday.length, "decision", "decisions")}
          name="Due today"
        >
          {dueToday.map((each) => (
            <DecisionRow
              key={decisionKey(each.decision)}
              listed={each}
              props={props}
            />
          ))}
        </Section>
      )}
      {later.length === 0 ? null : (
        <Section
          count={plural(later.length, "decision", "decisions")}
          name="Within your budget"
        >
          {later.map((each) => (
            <DecisionRow
              key={decisionKey(each.decision)}
              listed={each}
              props={props}
            />
          ))}
        </Section>
      )}
    </>
  );
};

const Tomorrow = ({ overflow }: { readonly overflow: number }) =>
  overflow === 0 ? null : (
    <Section name="Waits for tomorrow">
      <li
        className="border-rule text-ui flex min-h-10 items-center border-b py-2"
        data-overflow={overflow}
      >
        {overflow} more {overflow === 1 ? "waits" : "wait"} for tomorrow; each
        expires to its default if nobody decides first.
      </li>
    </Section>
  );

const Newcomers = ({
  newcomers,
}: {
  readonly newcomers: Today["newcomers"];
}) =>
  newcomers.length === 0 ? null : (
    <Section name="Newcomers to welcome">
      {newcomers.map((handle) => (
        <Row
          href={personPath(handle)}
          id={handle}
          key={handle}
          meta="made a first claim this week"
          size="one-line"
          title={handle}
        />
      ))}
    </Section>
  );

const Unattended = ({
  landings,
  now,
}: {
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
}) =>
  landings.length === 0 ? null : (
    <Section name="Landed without a decision">
      {landings.map((landing) => (
        <Row
          href={commitHref(landing.project, landing.sha)}
          id={landing.sha}
          key={`${landing.project}/${landing.sha}`}
          meta={
            <MetaLine
              parts={[
                landing.project,
                <MetaCode key="sha">{shortSha(landing.sha)}</MetaCode>,
              ]}
            />
          }
          state={{
            mark: "landed",
            time: <When at={landing.landedAt} now={now} />,
            word: "Landed",
          }}
          title={
            landing.ask === undefined
              ? `Landed by ${landing.author}`
              : `${landing.ask}, answered by ${landing.author}`
          }
        />
      ))}
    </Section>
  );

const SelectedFacts = ({
  busy,
  listed,
  now,
  onDecide,
  stamped,
}: {
  readonly busy: boolean;
  readonly listed: Listed;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly stamped: boolean;
}) => (
  <>
    <FactBlock label="State">
      <AppLink
        className="text-want decoration-rule font-semibold text-balance [overflow-wrap:anywhere] underline-offset-4 hover:underline"
        to={decisionHref(listed.decision)}
      >
        {describeSubject(listed.decision.subject)}
      </AppLink>
      <StatusLine
        subject={{
          decision: listed.decision,
          kind: "decision",
          now,
          viewerDecides: true,
        }}
      />
      <p className="text-label text-muted-foreground font-normal">
        {describeDefault(listed.decision)}
      </p>
    </FactBlock>
    <FactBlock label="Evidence and choices">
      <DecisionCard
        busy={busy}
        decision={listed.decision}
        expiry={false}
        layout="stack"
        now={now}
        onDecide={onDecide}
        soon={listed.soon}
        stamp={stamped}
      />
    </FactBlock>
  </>
);

const SignedOutNotice = ({ here }: { readonly here: string }) => (
  <div className="flex max-w-[70ch] flex-col items-start gap-3">
    <p className="text-body">{WHAT_TODAY_IS}</p>
    <p className="text-ui">
      <a
        className="decoration-rule font-medium underline hover:decoration-current"
        href={signInHref(here)}
      >
        Sign in
      </a>{" "}
      to see yours, or read it from a terminal:
    </p>
    <CommandLine command={`${Brand.cli} today`} />
  </div>
);

const DecidedFailure = ({
  decided,
}: {
  readonly decided: AsyncResult.AsyncResult<unknown, unknown>;
}) => {
  if (!AsyncResult.isFailure(decided)) {
    return null;
  }

  const read = readOfCause(decided.cause);

  return TodayRead.match(read, {
    Read: () => null,
    Refused: ({ refusal }) => <RefusalView refusals={[refusal]} />,
    SignedOut: () => <SignedOutNotice here="/today" />,
    Unreachable: () => <UnreachableNotice />,
  });
};

const Unlisted = ({ children }: { readonly children: ReactNode }) => (
  <Workspace crumbs={[{ label: "Today" }]} title="Today" variant="list">
    {children}
  </Workspace>
);

const listedOf = (
  today: Today,
  taken: ReadonlyMap<string, Listed>
): readonly Listed[] => {
  const soon = expiringSoon(today);

  const current = today.decisions.map((decision) => {
    const key = decisionKey(decision);

    return taken.get(key) ?? { decision, soon: soon.has(key) };
  });

  const gone = [...taken.values()].filter(
    ({ decision }) =>
      !today.decisions.some(
        (each) => decisionKey(each) === decisionKey(decision)
      )
  );

  return Arr.sort(
    [...current, ...gone],
    Order.combine(
      Order.mapInput(Order.Boolean, ({ soon: due }: Listed) => !due),
      Order.mapInput(expiryOrder, ({ decision }: Listed) => decision)
    )
  );
};

const withTaken = (
  kept: ReadonlyMap<string, Listed>,
  decision: Decision,
  soon: ReadonlySet<string>
): ReadonlyMap<string, Listed> => {
  const key = decisionKey(decision);

  return new Map([
    ...kept,
    [key, { decision, soon: kept.get(key)?.soon ?? soon.has(key) }],
  ]);
};

const takenNow = (
  decided: AsyncResult.AsyncResult<{ readonly decision: Decision }, unknown>
): Option.Option<Decision> =>
  Option.filter(
    Option.map(AsyncResult.value(decided), ({ decision }) => decision),
    ({ decided: record }) => record !== undefined
  );

const ListedToday = ({
  decided,
  now,
  onDecide,
  selected,
  today,
}: {
  readonly today: Today;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly decided: AsyncResult.AsyncResult<
    { readonly decision: Decision },
    unknown
  >;
  readonly selected: string | undefined;
}) => {
  const [kept, setKept] = useState<ReadonlyMap<string, Listed>>(new Map());
  const [open, setOpen] = useState<string>();
  const soon = expiringSoon(today);
  const fresh = takenNow(decided);

  // A choice taken stays on the page after the next read leaves it out.
  if (
    Option.isSome(fresh) &&
    kept.get(decisionKey(fresh.value))?.decision.decided === undefined
  ) {
    setKept(withTaken(kept, fresh.value, soon));
  }

  const taken = Option.match(fresh, {
    onNone: () => kept,
    onSome: (decision) => withTaken(kept, decision, soon),
  });

  const listed = listedOf(today, taken);
  const keys = listed.map(({ decision }) => decisionKey(decision));
  useListKeys(keys);

  const shown =
    listed.find(({ decision }) => decisionKey(decision) === selected) ??
    listed[0];

  const stamped = new Set(
    [...kept.keys()].filter((key) => {
      const decision = kept.get(key)?.decision;
      const choice = decision?.decided?.choice;

      return (
        decision !== undefined &&
        choice !== undefined &&
        choice !== "decline" &&
        tookEffect(decision, choice)
      );
    })
  );

  const props: RowsProps = {
    busy: decided.waiting,
    now,
    onDecide,
    onOpen: setOpen,
    open,
    selected,
    stamped,
  };

  return (
    <div className="contents [&_[data-facts=inline]]:hidden">
      <Workspace
        count={budgetShort(today.budget)}
        crumbs={[{ label: "Today" }]}
        facts={
          shown === undefined ? undefined : (
            <SelectedFacts
              busy={decided.waiting}
              listed={shown}
              now={now}
              onDecide={onDecide}
              stamped={stamped.has(decisionKey(shown.decision))}
            />
          )
        }
        factsHeading="Selected decision"
        {...(shown === undefined
          ? {}
          : { factsKey: decisionKey(shown.decision) })}
        status={
          <p
            className="text-want max-w-[70ch]"
            data-budget={`${today.budget.used}/${today.budget.total}`}
          >
            {budgetSentence(today.budget)}
          </p>
        }
        title="Today"
        variant="list"
      >
        <div aria-live="polite" className="empty:hidden">
          <DecidedFailure decided={decided} />
        </div>
        {listed.length === 0 ? (
          <EmptyState
            command={`${Brand.cli} today`}
            title="Nothing to decide today. Undecided decisions expire to their safe default."
          />
        ) : (
          <DecisionSections listed={listed} props={props} />
        )}
        <Tomorrow overflow={today.overflow} />
        <Newcomers newcomers={today.newcomers} />
        <Unattended landings={today.unattended} now={now} />
      </Workspace>
    </div>
  );
};

export const TodayView = ({
  decided = AsyncResult.initial(),
  now,
  onDecide,
  read,
  selected,
}: {
  readonly read: TodayRead;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly decided?: AsyncResult.AsyncResult<
    { readonly decision: Decision },
    unknown
  >;
  readonly selected?: string | undefined;
}) =>
  TodayRead.match(read, {
    Read: ({ today }) => (
      <ListedToday
        decided={decided}
        now={now}
        onDecide={onDecide}
        selected={selected}
        today={today}
      />
    ),
    Refused: ({ refusal }) => (
      <Unlisted>
        <p className="text-body max-w-[70ch]">{WHAT_TODAY_IS}</p>
        <RefusalView refusals={[refusal]} />
        <CommandLine command={`${Brand.cli} today`} />
      </Unlisted>
    ),
    SignedOut: () => (
      <Unlisted>
        <SignedOutNotice here="/today" />
      </Unlisted>
    ),
    Unreachable: () => (
      <Unlisted>
        <UnreachableNotice />
      </Unlisted>
    ),
  });
