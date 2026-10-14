import { Brand } from "@repo/brand";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { Handle } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";

import { signInHref } from "../auth/session-slot.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import { CommandLine } from "../shared/command.tsx";
import { CopyAction } from "../shared/copy-action.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { StageStrip } from "../shared/outcome.tsx";
import {
  answerPath,
  ASKS_PATH,
  askPath,
  IMPORT_PATH,
  INBOX_PATH,
  personPath,
} from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { RefusalView } from "../shared/refusal.tsx";
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
import {
  budgetSentence,
  budgetShort,
  DecisionGroups,
  RecentGroups,
} from "./decision-sections.tsx";
import type { Decided } from "./decision-sections.tsx";
import { readOfCause, TodayRead } from "./decisions.ts";
import {
  Decisions,
  InboxRead,
  isRunning,
  Takeable,
  todayOf,
  WORK_SHOWN,
} from "./read.ts";
import type { Work } from "./read.ts";

export { budgetSentence } from "./decision-sections.tsx";

const WHAT_THE_INBOX_IS =
  "The inbox is your own page: the decisions waiting for you, the asks you hold and where each answer stands in the gate, and the asks you may take next.";

const LINK =
  "decoration-rule hover:decoration-foreground font-medium underline underline-offset-4";

const TITLE = "Inbox";

const CRUMBS = [{ label: TITLE }];

type SignedIn = typeof InboxRead.cases.Read.Type;

const Empty = (props: Parameters<typeof EmptyState>[0]) => (
  <li className="pt-3">
    <EmptyState {...props} />
  </li>
);

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

const ClaimRow = ({
  now,
  work,
}: {
  readonly now: DateTime.Utc;
  readonly work: Work;
}) => {
  const { answer, claim, holds, stage, want } = work;
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
      strip={
        answer === undefined || stage === undefined ? undefined : (
          <div className="max-w-[44rem]">
            <StageStrip
              outcome={answer.outcome}
              stage={stage}
              {...(holds === undefined ? {} : { holds })}
            />
          </div>
        )
      }
      title={want ?? claim.ask}
    />
  );
};

const ClaimRows = ({
  now,
  read,
}: {
  readonly now: DateTime.Utc;
  readonly read: SignedIn;
}) => {
  const [first] = Takeable.match(read.asks, {
    Listed: ({ asks: listed }) => listed,
    Unreachable: () => [],
  });

  return (
    <div className="flex flex-col gap-3">
      <RowGroup
        counts={`${read.running} running`}
        label="Your claims"
        name="Your claims"
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
            <ClaimRow
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

const NoAsks = ({ title }: { readonly title: string }) => (
  <Empty command={`${Brand.cli} front`} onward={EVERY_ASK} title={title} />
);

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

const SignedOutNotice = () => (
  <div className="flex max-w-(--measure) flex-col items-start gap-3">
    <p className="text-body">{WHAT_THE_INBOX_IS}</p>
    <p className="text-ui">
      <a className={LINK} href={signInHref(INBOX_PATH)}>
        Sign in
      </a>{" "}
      to see yours, or read it from a terminal:
    </p>
    <CommandLine command={`${Brand.cli} status`} />
  </div>
);

const DecidedFailure = ({ decided }: { readonly decided: Decided }) => {
  if (!AsyncResult.isFailure(decided)) {
    return null;
  }

  return TodayRead.match(readOfCause(decided.cause), {
    Read: () => null,
    Refused: ({ refusal }) => <RefusalView refusals={[refusal]} />,
    SignedOut: () => <SignedOutNotice />,
    Unreachable: () => <UnreachableNotice />,
  });
};

const UnreachableDecisions = () => (
  <RowGroup label="Decisions waiting" name="Decisions waiting" under="bar">
    <Empty
      command={`${Brand.cli} today`}
      title="Your decisions did not come: the platform did not answer. Read them from a terminal."
    />
  </RowGroup>
);

interface Deciding {
  readonly decided: Decided;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly selected: string | undefined;
}

const DecisionsBlock = ({
  decisions,
  deciding,
}: {
  readonly decisions: Decisions;
  readonly deciding: Deciding;
}) =>
  Decisions.match(decisions, {
    Decides: ({ today }) => <DecisionGroups {...deciding} today={today} />,
    NotDecider: () => null,
    Unreachable: () => <UnreachableDecisions />,
  });

const RecentBlock = ({
  decisions,
  now,
}: {
  readonly decisions: Decisions;
  readonly now: DateTime.Utc;
}) =>
  Decisions.match(decisions, {
    Decides: ({ today }) => <RecentGroups now={now} today={today} />,
    NotDecider: () => null,
    Unreachable: () => null,
  });

const SignedInInbox = ({
  deciding,
  read,
}: {
  readonly deciding: Deciding;
  readonly read: SignedIn;
}) => {
  const budget = Option.getOrUndefined(
    Option.map(todayOf(read), ({ budget: held }) => held)
  );

  return (
    <Workspace
      {...(budget === undefined ? {} : { count: budgetShort(budget) })}
      crumbs={CRUMBS}
      meta={<Record handle={read.handle} />}
      status={
        budget === undefined ? undefined : (
          <p
            className="text-want max-w-(--measure)"
            data-budget={`${budget.used}/${budget.total}`}
          >
            {budgetSentence(budget)}
          </p>
        )
      }
      title={TITLE}
      variant="list"
    >
      <div aria-live="polite" className="empty:hidden">
        <DecidedFailure decided={deciding.decided} />
      </div>
      <DecisionsBlock decisions={read.decisions} deciding={deciding} />
      <ClaimRows now={deciding.now} read={read} />
      <AsksBlock asks={read.asks} />
      <RecentBlock decisions={read.decisions} now={deciding.now} />
    </Workspace>
  );
};

const Unlisted = ({ children }: { readonly children: ReactNode }) => (
  <Workspace crumbs={CRUMBS} title={TITLE}>
    {children}
  </Workspace>
);

export const InboxView = ({
  decided = AsyncResult.initial(),
  now,
  onDecide,
  read,
  selected,
}: {
  readonly read: InboxRead;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly decided?: Decided;
  readonly selected?: string | undefined;
}) =>
  InboxRead.match(read, {
    Read: (signed) => (
      <SignedInInbox
        deciding={{ decided, now, onDecide, selected }}
        read={signed}
      />
    ),
    Refused: ({ refusal }) => (
      <Unlisted>
        <p className="text-body max-w-(--measure)">{WHAT_THE_INBOX_IS}</p>
        <RefusalView refusals={[refusal]} />
        <CommandLine command={`${Brand.cli} status`} />
      </Unlisted>
    ),
    SignedOut: () => (
      <Unlisted>
        <SignedOutNotice />
      </Unlisted>
    ),
    Unreachable: () => (
      <Unlisted>
        <UnreachableNotice />
      </Unlisted>
    ),
  });
