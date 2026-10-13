import { Brand } from "@repo/brand";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Array as Arr, Option, Order } from "effect";
import type { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { commitHref, shortSha } from "../code/paths.ts";
import { stuckAboveBar } from "../decision/choices.tsx";
import { DecisionCard } from "../decision/decision-card.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import {
  consequenceOf,
  decisionHref,
  decisionKey,
  describeSubject,
  subjectKind,
  takenWords,
  tookEffect,
} from "../decision/subject.ts";
import { EmptyState } from "../shared/empty.tsx";
import { useListKeys } from "../shared/keys.tsx";
import { personPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import { distanceInWords, When } from "../shared/time.tsx";
import { expiringSoon, expiryOrder } from "./decisions.ts";

const counted = (count: number) => (count === 0 ? "none" : String(count));

export const budgetSentence = (budget: Today["budget"]) =>
  `Decisions: ${budget.used} taken, ${counted(Math.max(0, budget.total - budget.used))} left today. Finishes are counted apart: ${counted(budget.finishes)} taken.`;

export const budgetShort = (budget: Today["budget"]) =>
  `${counted(Math.max(0, budget.total - budget.used))} left today`;

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

export type Decided = AsyncResult.AsyncResult<
  { readonly decision: Decision },
  unknown
>;

/** The decisions waiting on the reader, each decided in its row; a choice taken stays in its row after the next read leaves it out. */
export const DecisionGroups = ({
  decided,
  now,
  onDecide,
  selected,
  today,
}: {
  readonly today: Today;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly decided: Decided;
  readonly selected: string | undefined;
}) => {
  const [kept, setKept] = useState<ReadonlyMap<string, Listed>>(new Map());
  const [open, setOpen] = useState<string>();
  const soon = expiringSoon(today);
  const fresh = takenNow(decided);

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
  useListKeys(listed.map(({ decision }) => decisionKey(decision)));

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
    <>
      {listed.length === 0 ? (
        <Section name="Decisions waiting">
          <li className="pt-3">
            <EmptyState
              command={`${Brand.cli} today`}
              title="Nothing to decide today. Undecided decisions expire to their safe default."
            />
          </li>
        </Section>
      ) : (
        <DecisionSections listed={listed} props={props} />
      )}
      <Tomorrow overflow={today.overflow} />
    </>
  );
};

/** What happened lately in the projects the reader decides for. */
export const RecentGroups = ({
  now,
  today,
}: {
  readonly now: DateTime.Utc;
  readonly today: Today;
}) => (
  <>
    <Newcomers newcomers={today.newcomers} />
    <Unattended landings={today.unattended} now={now} />
  </>
);
