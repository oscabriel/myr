/**
 * A signed-in reader's own page: their claims, each with where its answer
 * stands; the decisions waiting for them when they decide somewhere; the
 * open asks they may take; and the way to their record. No score and no
 * count of credit (DESIGN.md). Signed out, it says what the page is and how
 * to sign in. A view: what the server read, and the instant, in; markup out.
 */
import { Brand } from "@repo/brand";
import type { AnswerView } from "@repo/protocol/domain/answer";
import type { ClaimState, ClaimView } from "@repo/protocol/domain/claim";
import type { Today } from "@repo/protocol/domain/decision";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { Handle } from "@repo/protocol/ids";
import { Array as Arr, DateTime } from "effect";

import { signInHref } from "../auth/session-slot.tsx";
import {
  decisionHref,
  describeSubject,
  subjectKind,
} from "../decision/subject.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import {
  answerPath,
  ASKS_PATH,
  askPath,
  HOME_PATH,
  personPath,
} from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { AskRow, MetaCode, MetaLine, Row, RowGroup } from "../shared/row.tsx";
import type { RowState } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { orderDecisions } from "../today/read.ts";
import { HomeRead } from "./read.ts";

/** What the page is, said to a reader who is not signed in. */
const WHAT_HOME_IS =
  "Home is your own page: the asks you hold and where each answer stands, the decisions waiting for you, and the asks you may take next.";

/** The decisions the page lists; the rest are on Today. */
const DECISIONS_SHOWN = 5;

const LINK =
  "decoration-rule hover:decoration-foreground font-medium underline underline-offset-4";

/** A claim still running: its holder's to push to. */
const running = (claim: ClaimView) =>
  claim.state === "live" || claim.state === "warned";

/** An answer's latest outcome as a row's state. */
const outcomeState = (answer: AnswerView): RowState =>
  Outcome.match(answer.outcome, {
    AwaitingDecision: (): RowState => ({ mark: "waiting", word: "Waiting" }),
    AwaitingFinish: (): RowState => ({ mark: "waiting", word: "Waiting" }),
    Checking: (): RowState => ({ mark: "checking", word: "Checking" }),
    Landed: (): RowState => ({ mark: "landed", word: "Landed" }),
    Refused: (): RowState => ({ mark: "refused", word: "Refused" }),
    WaitingOnParent: (): RowState => ({ mark: "waiting", word: "Waiting" }),
  });

/** A claim with no answer yet, as a row's state. */
const CLAIM_STATES = {
  answered: { mark: "passed", word: "Answered" },
  lapsed: { mark: "notNeeded", word: "Lapsed" },
  live: { mark: "claimed", word: "Claimed" },
  released: { mark: "notNeeded", word: "Released" },
  warned: { mark: "waiting", word: "Push soon" },
} as const satisfies Record<ClaimState, RowState>;

/**
 * Each claim's latest answer. An answer names its ask but not its project,
 * so it is matched only where one claim of the reader's holds that ask.
 */
const latestAnswers = (
  claims: readonly ClaimView[],
  answers: readonly AnswerView[]
): ReadonlyMap<ClaimView, AnswerView> => {
  const byAsk = Arr.groupBy(claims, ({ ask }) => ask);

  return new Map(
    claims.flatMap((claim) => {
      if ((byAsk[claim.ask]?.length ?? 0) !== 1) {
        return [];
      }

      const [latest] = answers
        .filter(({ ask }) => ask === claim.ask)
        .toSorted(
          (a, b) => DateTime.toEpochMillis(b.at) - DateTime.toEpochMillis(a.at)
        );

      return latest === undefined ? [] : [[claim, latest] as const];
    })
  );
};

/** Running claims first, then the newest. */
const claimOrder = (a: ClaimView, b: ClaimView) =>
  Number(running(b)) - Number(running(a)) ||
  DateTime.toEpochMillis(b.openedAt) - DateTime.toEpochMillis(a.openedAt);

const ClaimRows = ({
  answers,
  claims,
  now,
}: {
  readonly answers: readonly AnswerView[];
  readonly claims: readonly ClaimView[];
  readonly now: DateTime.Utc;
}) => {
  const latest = latestAnswers(claims, answers);

  return (
    <RowGroup
      counts={`${claims.filter(running).length} running`}
      label="Your claims"
      name="Your claims"
      under="bar"
    >
      {claims.toSorted(claimOrder).map((claim) => {
        const answer = latest.get(claim);

        return (
          <Row
            data={{
              "data-claim": claim.ask,
              "data-project": claim.project,
              "data-state": claim.state,
            }}
            href={
              answer === undefined
                ? askPath(claim.project, claim.ask)
                : answerPath(claim.project, claim.ask)
            }
            id={`${claim.project}/${claim.ask}`}
            key={`${claim.project}/${claim.ask}`}
            meta={
              <MetaLine
                parts={[
                  claim.project,
                  <MetaCode key="fork">{claim.fork}</MetaCode>,
                  running(claim) ? (
                    <span key="lapses">
                      lapses <When at={claim.lapsesAt} now={now} />
                    </span>
                  ) : undefined,
                ]}
              />
            }
            mono
            state={
              answer === undefined
                ? CLAIM_STATES[claim.state]
                : outcomeState(answer)
            }
            title={claim.ask}
          />
        );
      })}
    </RowGroup>
  );
};

const DecisionRows = ({ today }: { readonly today: Today }) => {
  const waiting = today.decisions.length + today.overflow;

  return (
    <RowGroup
      counts={`${waiting} waiting`}
      label="Decisions waiting"
      name={<AppLink to="/today">Decisions waiting</AppLink>}
      under="bar"
    >
      {orderDecisions(today)
        .slice(0, DECISIONS_SHOWN)
        .map((decision) => (
          <Row
            data={{
              "data-decision": decision.id,
              "data-project": decision.project,
            }}
            href={decisionHref(decision)}
            id={`${decision.project}/${decision.id}`}
            key={`${decision.project}/${decision.id}`}
            meta={
              <MetaLine
                parts={[
                  decision.project,
                  subjectKind(decision.subject),
                  <MetaCode key="id">{decision.id}</MetaCode>,
                ]}
              />
            }
            state={{ mark: "now", word: "Yours to decide" }}
            title={describeSubject(decision.subject)}
          />
        ))}
    </RowGroup>
  );
};

const AskRows = ({ asks }: { readonly asks: readonly FrontPageEntry[] }) => (
  <RowGroup
    label="Asks you may take"
    name={<AppLink to={ASKS_PATH}>Asks you may take</AppLink>}
    under="bar"
  >
    {asks.map(({ ask, project }) => (
      <AskRow
        key={`${project}/${ask.ask}`}
        listing={ask}
        project={project}
        showProject
        takeable
      />
    ))}
  </RowGroup>
);

/** The way to the reader's record. */
const Record = ({ handle }: { readonly handle: Handle }) => (
  <>
    Signed in as {handle}.{" "}
    <AppLink className={LINK} to={personPath(handle)}>
      Your record
    </AppLink>
  </>
);

const Signed = ({
  read,
  now,
}: {
  readonly read: typeof HomeRead.cases.Read.Type;
  readonly now: DateTime.Utc;
}) => (
  <Workspace
    crumbs={[{ label: "Home" }]}
    meta={<Record handle={read.handle} />}
    title="Home"
    variant="list"
  >
    <div className="flex flex-col gap-8">
      {read.claims.length === 0 ? (
        <EmptyState
          command={`${Brand.cli} front`}
          onward={
            <AppLink className={LINK} to={ASKS_PATH}>
              The open asks
            </AppLink>
          }
          title="You hold no claim. Find an ask to take, then claim it."
        />
      ) : (
        <ClaimRows answers={read.answers} claims={read.claims} now={now} />
      )}
      {read.today === undefined ? null : <DecisionRows today={read.today} />}
      {read.asks.length === 0 ? (
        <EmptyState
          onward={
            <AppLink className={LINK} to={ASKS_PATH}>
              Every open ask
            </AppLink>
          }
          title="No open ask is yours to take right now."
        />
      ) : (
        <AskRows asks={read.asks} />
      )}
    </div>
  </Workspace>
);

/** Signed out: what the page is, the way in, and the command. */
const SignedOut = () => (
  <Workspace crumbs={[{ label: "Home" }]} title="Home">
    <div className="flex max-w-[70ch] flex-col items-start gap-3">
      <p className="text-body">{WHAT_HOME_IS}</p>
      <p className="text-ui">
        <a className={LINK} href={signInHref(HOME_PATH)}>
          Sign in
        </a>{" "}
        to see yours, or read it from a terminal:
      </p>
      <CommandLine command={`${Brand.cli} status`} />
    </div>
  </Workspace>
);

export const HomeView = ({
  now,
  read,
}: {
  readonly now: DateTime.Utc;
  readonly read: HomeRead;
}) =>
  HomeRead.match(read, {
    Read: (signed) => <Signed now={now} read={signed} />,
    SignedOut: () => <SignedOut />,
    Unreachable: () => (
      <Workspace crumbs={[{ label: "Home" }]} title="Home">
        <UnreachableNotice />
      </Workspace>
    ),
  });
