/**
 * Today: a decider's day of decisions, not diffs, held to a budget. The
 * budget's decisions and the finishes are counted apart (a finish costs more
 * than a decision); the decisions expiring soon come first, then the rest by
 * expiry; what the budget leaves out waits for tomorrow, and may expire to
 * its safe default. Below them: the newcomers to welcome, and a sample of
 * landings that needed nobody.
 *
 * A failure reads as what it is: a refusal (`NotDecider` for a person who
 * decides nothing) through `RefusalView`, a missing sign-in as the way to
 * sign in, and an unreachable platform as that, never as an empty day.
 */
import { Brand } from "@repo/brand";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Array as Arr, Cause, DateTime, Option, Order, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { CircleCheck, LogIn, Unplug } from "lucide-react";
import type { ReactNode } from "react";

import { DecisionCard } from "../decision/decision-card.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import { LABEL } from "../shared/classes.ts";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { RefusalView } from "../shared/refusal.tsx";
import { When } from "../shared/time.tsx";

const isRefusal = Schema.is(Refusal);

const isUnauthenticated = Schema.is(Unauthenticated);

/** A decision's place in a Today that may hold several projects. */
const keyOf = ({ id, project }: Decision) => `${project}/${id}`;

/** Soonest to expire first, then oldest, then by project and id: one order every time. */
const expiryOrder: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/**
 * The decisions `today.expiringSoon` names. Ids are minted per project, so a
 * Today across projects may hold two decisions with one id; where an id is
 * named `n` times, the `n` of its decisions that expire first are the ones
 * meant (a decision that expires within the day expires before any that
 * does not).
 */
const expiringSoon = (today: Today): ReadonlySet<string> => {
  const named = Arr.groupBy(today.expiringSoon, (id) => id);
  const byExpiry = Arr.sort(today.decisions, expiryOrder);

  return new Set(
    Object.entries(named).flatMap(([id, times]) =>
      byExpiry
        .filter((decision) => decision.id === id)
        .slice(0, times.length)
        .map(keyOf)
    )
  );
};

/** Today's decisions in the order a decider takes them: expiring soon first, then by expiry. */
export const orderDecisions = (today: Today): readonly Decision[] => {
  const soon = expiringSoon(today);

  return Arr.sort(
    today.decisions,
    Order.combine(
      Order.mapInput(
        Order.Boolean,
        (decision: Decision) => !soon.has(keyOf(decision))
      ),
      expiryOrder
    )
  );
};

/** Where one decision stands on Today: listed (and whether it expires soon), or not there. */
export const findDecision = (
  today: Today,
  project: ProjectName,
  id: DecisionId
): Option.Option<{ readonly decision: Decision; readonly soon: boolean }> => {
  const soon = expiringSoon(today);

  return Arr.findFirst(
    today.decisions,
    (decision) => decision.project === project && decision.id === id
  ).pipe(
    Option.map((decision) => ({ decision, soon: soon.has(keyOf(decision)) }))
  );
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const SECTION = "flex flex-col gap-3";

const TITLE = "text-lg font-semibold";

/** A one-line notice under a rule: an icon, then what to know. */
export const Notice = ({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon: ReactNode;
}) => (
  <output className="border-rule flex items-start gap-2 border-t border-b py-3 text-sm">
    {icon}
    <span>{children}</span>
  </output>
);

/** A call that failed: a refusal as the platform gave it, or why there is no answer. */
export const FailureView = ({
  cause,
}: {
  readonly cause: Cause.Cause<unknown>;
}) => {
  const error = Cause.findErrorOption(cause);

  if (Option.isSome(error) && isRefusal(error.value)) {
    return <RefusalView refusals={[error.value]} />;
  }

  if (Option.isSome(error) && isUnauthenticated(error.value)) {
    return (
      <Notice
        icon={<LogIn aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      >
        Today is a decider&apos;s page.{" "}
        <a
          className="decoration-rule font-medium underline hover:decoration-current"
          href="/auth/signin"
        >
          Sign in
        </a>{" "}
        to see yours.
      </Notice>
    );
  }

  return (
    <Notice
      icon={<Unplug aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
    >
      The platform did not answer. Reload the page, or run{" "}
      <code className="font-mono text-[0.8125rem]">{Brand.cli} today</code> in a
      terminal.
    </Notice>
  );
};

/** Today on its way from the platform. */
export const ReadingToday = () => (
  <output className="text-muted-foreground block text-sm">
    Reading your Today
  </output>
);

/** The day's budget, as two fields: decisions against the total, and finishes apart. */
const Budget = ({ budget }: { readonly budget: Today["budget"] }) => {
  const left = Math.max(0, budget.total - budget.used);

  return (
    <dl
      aria-label="Today's budget"
      className="border-rule grid grid-cols-2 border-t border-b"
    >
      <div className="border-rule flex flex-col gap-0.5 border-r py-2 pr-3">
        <dt className={LABEL}>Decisions</dt>
        <dd className="text-2xl font-semibold tabular-nums" data-budget="used">
          {budget.used} of {budget.total}
        </dd>
        <dd className="text-muted-foreground text-xs">
          {plural(left, "decision", "decisions")} left today
        </dd>
      </div>
      <div className="flex flex-col gap-0.5 py-2 pl-3">
        <dt className={LABEL}>Finishes</dt>
        <dd
          className="text-2xl font-semibold tabular-nums"
          data-budget="finishes"
        >
          {plural(budget.finishes, "finish", "finishes")}
        </dd>
        <dd className="text-muted-foreground text-xs">
          counted apart from decisions
        </dd>
      </div>
    </dl>
  );
};

/** What the decider's last choice came to: taken, refused, or on its way. */
export const DecidedNotice = ({
  decided,
}: {
  readonly decided: AsyncResult.AsyncResult<
    { readonly decision: Decision },
    unknown
  >;
}) => {
  if (AsyncResult.isFailure(decided)) {
    return <FailureView cause={decided.cause} />;
  }

  if (AsyncResult.isInitial(decided)) {
    return decided.waiting ? (
      <p className="text-checking text-sm" data-decided="waiting">
        Sending your choice
      </p>
    ) : null;
  }

  const { decision } = decided.value;

  return decision.decided === undefined ? null : (
    <p
      className="flex items-start gap-2 text-sm"
      data-decided={decision.decided.choice}
    >
      <CircleCheck
        aria-hidden="true"
        className="text-landed mt-0.5 size-4 shrink-0"
      />
      <span>
        <strong className="text-landed font-semibold">Decided:</strong>{" "}
        {decision.decided.choice} on{" "}
        <code className="font-mono text-[0.8125rem]">
          {decision.project}/{decision.id}
        </code>
      </span>
    </p>
  );
};

const Decisions = ({
  decided,
  now,
  onDecide,
  today,
}: {
  readonly decided: AsyncResult.AsyncResult<
    { readonly decision: Decision },
    unknown
  >;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly today: Today;
}) => {
  const soon = expiringSoon(today);
  const ordered = orderDecisions(today);

  return (
    <section aria-labelledby="today-decisions" className={SECTION}>
      <h2 className={TITLE} id="today-decisions">
        Decisions
      </h2>
      <div aria-live="polite">
        <DecidedNotice decided={decided} />
      </div>
      {ordered.length === 0 ? (
        <EmptyState
          command={`${Brand.cli} today`}
          title="Nothing to decide today. Undecided decisions expire to their safe default."
        />
      ) : (
        <ol className="border-rule flex flex-col border-t">
          {ordered.map((decision) => (
            <li className="border-rule border-b py-5" key={keyOf(decision)}>
              <DecisionCard
                busy={decided.waiting}
                decision={decision}
                now={now}
                onDecide={onDecide}
                soon={soon.has(keyOf(decision))}
              />
            </li>
          ))}
        </ol>
      )}
      {today.overflow === 0 ? null : (
        <p
          className="text-muted-foreground text-sm"
          data-overflow={today.overflow}
        >
          {today.overflow} more {today.overflow === 1 ? "waits" : "wait"} for
          tomorrow; each expires to its default if nobody decides first.
        </p>
      )}
    </section>
  );
};

const Newcomers = ({
  newcomers,
}: {
  readonly newcomers: Today["newcomers"];
}) =>
  newcomers.length === 0 ? null : (
    <section aria-labelledby="today-newcomers" className={SECTION}>
      <h2 className={TITLE} id="today-newcomers">
        Newcomers to welcome
      </h2>
      <p className="text-muted-foreground text-sm">
        Their first claim was this week.
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {newcomers.map((handle) => (
          <li key={handle}>
            <HandleLink handle={handle} />
          </li>
        ))}
      </ul>
    </section>
  );

const Unattended = ({
  landings,
  now,
}: {
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
}) =>
  landings.length === 0 ? null : (
    <section aria-labelledby="today-unattended" className={SECTION}>
      <h2 className={TITLE} id="today-unattended">
        Landed without a decision
      </h2>
      <p className="text-muted-foreground text-sm">
        A sample of answers that passed the gate and needed nobody.
      </p>
      <ul className="border-rule flex flex-col border-t">
        {landings.map((landing) => (
          <li
            className="border-rule flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-2 text-sm"
            key={`${landing.project}/${landing.sha}`}
          >
            <code className="font-mono text-[0.8125rem]">
              {landing.sha.slice(0, 7)}
            </code>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-mono text-[0.8125rem]">
                {landing.project}
              </span>
              {landing.ask === undefined ? null : (
                <>
                  {" "}
                  answers{" "}
                  <span className="font-mono text-[0.8125rem]">
                    {landing.ask}
                  </span>
                </>
              )}
              , by <HandleLink handle={landing.author} />
            </span>
            <span className="text-muted-foreground ml-auto text-xs">
              <When at={landing.landedAt} now={now} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

export const TodayView = ({
  decided = AsyncResult.initial(),
  now,
  onDecide,
  result,
}: {
  readonly result: AsyncResult.AsyncResult<Today, unknown>;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  /** The decider's last choice, as `decide` answered it. */
  readonly decided?: AsyncResult.AsyncResult<
    { readonly decision: Decision },
    unknown
  >;
}) => {
  if (AsyncResult.isFailure(result)) {
    return <FailureView cause={result.cause} />;
  }

  if (AsyncResult.isInitial(result)) {
    return <ReadingToday />;
  }

  const today = result.value;

  return (
    <>
      <Budget budget={today.budget} />
      <Decisions
        decided={decided}
        now={now}
        onDecide={onDecide}
        today={today}
      />
      <Newcomers newcomers={today.newcomers} />
      <Unattended landings={today.unattended} now={now} />
    </>
  );
};
