/**
 * A signed-in reader's own page: their work (each claim, its ask's want and
 * where its answer stands, with the command that runs next); the decisions
 * waiting for them when they decide somewhere; the open asks they may take;
 * and the way to their record. No score and no count of credit (DESIGN.md).
 * Signed out, it says what the page is and how to sign in. A view: what the
 * server read, and the instant, in; markup out.
 */
import { Brand } from "@repo/brand";
import type { Today } from "@repo/protocol/domain/decision";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { Handle } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { signInHref } from "../auth/session-slot.tsx";
import {
  decisionHref,
  decisionKey,
  describeSubject,
  subjectKind,
} from "../decision/subject.ts";
import { CommandLine } from "../shared/command.tsx";
import { CopyAction } from "../shared/copy-action.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import {
  answerPath,
  ASKS_PATH,
  askPath,
  HOME_PATH,
  IMPORT_PATH,
  personPath,
} from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import {
  AskRow,
  CLAIM_STATES,
  MetaCode,
  MetaLine,
  outcomeState,
  Row,
  RowGroup,
} from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { orderDecisions } from "../today/read.ts";
import {
  Decisions,
  HomeRead,
  isRunning,
  Takeable,
  WORK_SHOWN,
} from "./read.ts";
import type { Work } from "./read.ts";

/** What the page is, said to a reader who is not signed in. */
const WHAT_HOME_IS =
  "Home is your own page: the asks you hold and where each answer stands, the decisions waiting for you, and the asks you may take next.";

/** The decisions the page lists; the rest are on Today. */
const DECISIONS_SHOWN = 5;

const LINK =
  "decoration-rule hover:decoration-foreground font-medium underline underline-offset-4";

/** A block's empty state, under its header like its rows would be. */
const Empty = (props: Parameters<typeof EmptyState>[0]) => (
  <li className="pt-3">
    <EmptyState {...props} />
  </li>
);

/**
 * What runs next on a claim: a refusal's own `next`, or, while the claim
 * runs with nothing refused, its local check before a push.
 */
const nextOf = ({ answer, claim }: Work) => {
  if (answer !== undefined) {
    return Outcome.guards.Refused(answer.outcome)
      ? {
          command: answer.outcome.refusals[0].next,
          label: "Copy next command",
        }
      : undefined;
  }

  return isRunning(claim)
    ? { command: claim.checkCommand, label: "Copy check command" }
    : undefined;
};

const WorkRow = ({
  now,
  work,
}: {
  readonly now: DateTime.Utc;
  readonly work: Work;
}) => {
  const { answer, claim, want } = work;
  const next = nextOf(work);

  return (
    <Row
      action={next === undefined ? undefined : <CopyAction {...next} />}
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
      id={`${claim.project}/${claim.ask}/${claim.fork}`}
      meta={
        <MetaLine
          parts={[
            claim.project,
            want === undefined ? undefined : (
              <MetaCode key="ask">{claim.ask}</MetaCode>
            ),
            <MetaCode key="fork">{claim.fork}</MetaCode>,
            isRunning(claim) ? (
              <span key="lapses">
                lapses <When at={claim.lapsesAt} now={now} />
              </span>
            ) : undefined,
          ]}
        />
      }
      mono={want === undefined}
      state={
        answer === undefined
          ? CLAIM_STATES[claim.state]
          : outcomeState(answer.outcome)
      }
      title={want ?? claim.ask}
    />
  );
};

const WorkRows = ({
  asks,
  now,
  read,
}: {
  readonly asks: Takeable;
  readonly now: DateTime.Utc;
  readonly read: typeof HomeRead.cases.Read.Type;
}) => {
  const [first] = Takeable.match(asks, {
    Listed: ({ asks: listed }) => listed,
    Unreachable: () => [],
  });

  return (
    <div className="flex flex-col gap-3">
      <RowGroup
        counts={`${read.running} running`}
        label="Your work"
        name="Your work"
        under="bar"
      >
        {read.work.length === 0 ? (
          <Empty
            command={
              first === undefined
                ? `${Brand.cli} front`
                : `${Brand.cli} claim ${first.ask.ask} --project ${first.project}`
            }
            onward={
              <AppLink className={LINK} to={ASKS_PATH}>
                The open asks
              </AppLink>
            }
            title={
              first === undefined
                ? "You hold no claim. Find an ask to take, then claim it."
                : "You hold no claim. Claim the first ask you may take, or pick another below."
            }
          />
        ) : (
          read.work.map((work) => (
            <WorkRow
              key={`${work.claim.project}/${work.claim.ask}/${work.claim.fork}`}
              now={now}
              work={work}
            />
          ))
        )}
      </RowGroup>
      {read.held > WORK_SHOWN ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ui text-muted-foreground">
            The newest {WORK_SHOWN} of your {read.held} claims; every one:
          </p>
          <CommandLine command={`${Brand.cli} status`} />
        </div>
      ) : null}
    </div>
  );
};

const DecisionRows = ({ today }: { readonly today: Today }) => (
  <>
    {orderDecisions(today)
      .slice(0, DECISIONS_SHOWN)
      .map((decision) => (
        <Row
          data={{
            "data-decision": decision.id,
            "data-project": decision.project,
          }}
          href={decisionHref(decision)}
          id={decisionKey(decision)}
          key={decisionKey(decision)}
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
  </>
);

const TODAY_LINK = (
  <AppLink className={LINK} to="/today">
    Today
  </AppLink>
);

const DecisionsGroup = ({
  children,
  waiting,
}: {
  readonly children: ReactNode;
  readonly waiting?: number;
}) => (
  <RowGroup
    counts={waiting === undefined ? undefined : `${waiting} waiting`}
    label="Decisions waiting"
    name={<AppLink to="/today">Decisions waiting</AppLink>}
    under="bar"
  >
    {children}
  </RowGroup>
);

/** A decider's waiting decisions, or that none waits. */
const Waiting = ({ today }: { readonly today: Today }) => {
  const waiting = today.decisions.length + today.overflow;

  return (
    <DecisionsGroup waiting={waiting}>
      {waiting === 0 ? (
        <Empty
          onward={TODAY_LINK}
          title="Nothing waits for your decision. Today shows what landed without one."
        />
      ) : (
        <DecisionRows today={today} />
      )}
    </DecisionsGroup>
  );
};

/** The decisions block: a decider's waiting decisions; nothing for anyone else. */
const DecisionsBlock = ({ decisions }: { readonly decisions: Decisions }) =>
  Decisions.match(decisions, {
    Decides: ({ today }) => <Waiting today={today} />,
    NotDecider: () => null,
    Unreachable: () => (
      <DecisionsGroup>
        <Empty
          command={`${Brand.cli} today`}
          onward={TODAY_LINK}
          title="Your decisions did not come: the platform did not answer. Try Today, or read them from a terminal."
        />
      </DecisionsGroup>
    ),
  });

const AskRows = ({ asks }: { readonly asks: readonly FrontPageEntry[] }) =>
  asks.map(({ ask, project }) => (
    <AskRow
      key={`${project}/${ask.ask}`}
      listing={ask}
      project={project}
      showProject
      takeable
    />
  ));

const EVERY_ASK = (
  <AppLink className={LINK} to={ASKS_PATH}>
    Every open ask
  </AppLink>
);

/** The asks block's empty state: none to take, or none came. */
const NoAsks = ({ title }: { readonly title: string }) => (
  <Empty command={`${Brand.cli} front`} onward={EVERY_ASK} title={title} />
);

/** The asks the reader may take, or why none shows. */
const AskList = ({ asks }: { readonly asks: Takeable }) =>
  Takeable.match(asks, {
    Listed: ({ asks: listed }) =>
      listed.length === 0 ? (
        <NoAsks title="No open ask is yours to take right now." />
      ) : (
        <AskRows asks={listed} />
      ),
    Unreachable: () => (
      <NoAsks title="The asks did not come: the platform did not answer." />
    ),
  });

const AsksBlock = ({ asks }: { readonly asks: Takeable }) => (
  <RowGroup
    label="Asks you may take"
    name={<AppLink to={ASKS_PATH}>Asks you may take</AppLink>}
    under="bar"
  >
    <AskList asks={asks} />
  </RowGroup>
);

/** Who is signed in, the way to their record, and the way to import a repo. */
const Record = ({ handle }: { readonly handle: Handle }) => (
  <>
    Signed in as <HandleLink handle={handle} />.{" "}
    <AppLink className={LINK} to={personPath(handle)}>
      Your record
    </AppLink>
    {" · "}
    <AppLink className={LINK} to={IMPORT_PATH}>
      Import a repo
    </AppLink>
  </>
);

const SignedIn = ({
  now,
  read,
}: {
  readonly now: DateTime.Utc;
  readonly read: typeof HomeRead.cases.Read.Type;
}) => (
  <Workspace
    crumbs={[{ label: "Home" }]}
    meta={<Record handle={read.handle} />}
    title="Home"
    variant="list"
  >
    <div className="flex flex-col gap-8">
      <WorkRows asks={read.asks} now={now} read={read} />
      <DecisionsBlock decisions={read.decisions} />
      <AsksBlock asks={read.asks} />
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
    Read: (signed) => <SignedIn now={now} read={signed} />,
    SignedOut: () => <SignedOut />,
    Unreachable: () => (
      <Workspace crumbs={[{ label: "Home" }]} title="Home">
        <UnreachableNotice />
      </Workspace>
    ),
  });
