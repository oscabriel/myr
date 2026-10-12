import { Brand } from "@repo/brand";
import type {
  HeldBackResult,
  LaneOutcome,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, CommitSha, Handle, ProjectName } from "@repo/protocol/ids";
import { ChecksFailed } from "@repo/protocol/refusal";
import type { DateTime } from "effect";
import { ArrowRight, ChevronDown, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Region } from "../ask/fields.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import type { AskProgress, Round } from "../shared/ask-progress.ts";
import { CommandLine } from "../shared/command.tsx";
import { CompactCredit, CreditTrailers } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import {
  ClaimFacts,
  CodeValue,
  FamilyFacts,
  ProvenanceFacts,
  shortValue,
  StateFacts,
  TerritoryFacts,
  verdictProvenance,
} from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import type { StateMark } from "../shared/marks.tsx";
import { OutcomeView, StageStrip } from "../shared/outcome.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row, RowList } from "../shared/row.tsx";
import type { Crumb } from "../shared/shell/sections.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { readStatus, StatusLine } from "../shared/status-line.tsx";
import type { StatusSubject } from "../shared/status-line.tsx";
import { distanceInWords, When } from "../shared/time.tsx";
import {
  deleteChildOf,
  familyHead,
  holdsOf,
  roundOf,
  roundsAsTheyStand,
} from "./subject.ts";

export const durationText = (millis: number) => {
  if (millis < 1000) {
    return `${millis} ms`;
  }

  if (millis < 60_000) {
    return `${(millis / 1000).toFixed(1)} s`;
  }

  const seconds = Math.round(millis / 1000);

  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

const results = {
  blocked: { mark: "waiting", tone: "text-waiting", word: "blocked" },
  failed: { mark: "refused", tone: "text-refused", word: "failed" },
  flaked: { mark: "retry", tone: "text-waiting", word: "flaked" },
  loadError: { mark: "refused", tone: "text-refused", word: "load error" },
  passed: { mark: "passed", tone: "text-landed", word: "passed" },
} as const satisfies Record<
  LaneOutcome,
  { readonly mark: StateMark; readonly tone: string; readonly word: string }
>;

export const answerCrumbs = (ask: Ask): readonly Crumb[] => [
  { label: ask.project, to: `/${ask.project}` },
  { label: "Asks", to: `/${ask.project}` },
  { label: ask.id, mono: true, to: askPath(ask.project, ask.id) },
  { label: "Answer" },
];

const LaneLog = ({
  lane,
  project,
}: {
  readonly lane: LaneResult;
  readonly project: Ask["project"];
}) => {
  if (lane.logRef === undefined) {
    return null;
  }

  return lane.logRef === ChecksFailed.withheld ? (
    <p className="text-ui text-muted-foreground">
      Its log was not kept: it held a write-only value.
    </p>
  ) : (
    <CommandLine
      command={`${Brand.cli} evidence ${lane.logRef} --project ${project}`}
    />
  );
};

const LaneRow = ({
  lane,
  project,
}: {
  readonly lane: LaneResult;
  readonly project: Ask["project"];
}) => {
  const { mark, tone, word } = results[lane.result];

  return (
    <li
      className="border-rule flex min-w-0 flex-col gap-2 border-b py-2.5"
      data-lane={lane.lane}
      data-result={lane.result}
    >
      <div className="text-ui flex min-w-0 items-baseline gap-3">
        <StateMarkIcon className="translate-y-[3px]" mark={mark} />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-mono text-foreground font-mono font-medium">
            {lane.lane}
          </span>
          <code className="text-mono text-muted-foreground min-w-0 font-mono [overflow-wrap:anywhere]">
            {lane.command}
          </code>
        </span>
        <span className={`shrink-0 font-medium ${tone}`}>{word}</span>
        <span className="text-label text-muted-foreground w-16 shrink-0 text-right tabular-nums">
          {durationText(lane.durationMs)}
        </span>
      </div>
      {lane.result === "passed" ? null : (
        <div className="pl-7">
          <LaneLog lane={lane} project={project} />
        </div>
      )}
    </li>
  );
};

const passedLine = (lanes: readonly LaneResult[]) =>
  `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"} passed in ${durationText(
    lanes.reduce((total, { durationMs }) => total + durationMs, 0)
  )}`;

export const Lanes = ({
  checking = false,
  lanes,
  project,
}: {
  readonly lanes: readonly LaneResult[];
  readonly project: Ask["project"];
  readonly checking?: boolean;
}) => {
  if (lanes.length === 0) {
    return (
      <EmptyState
        title={
          checking ? "No lane has run yet." : "No lane ran on this answer."
        }
      />
    );
  }

  const open = lanes.filter(({ result }) => result !== "passed");
  const passed = lanes.filter(({ result }) => result === "passed");

  return (
    <div className="flex min-w-0 flex-col">
      {open.length === 0 ? null : (
        <ul
          aria-label="Lanes that did not pass"
          className="border-rule border-t"
        >
          {open.map((lane) => (
            <LaneRow key={lane.lane} lane={lane} project={project} />
          ))}
        </ul>
      )}
      {passed.length === 0 ? null : (
        <details
          className={`group border-rule border-b ${open.length === 0 ? "border-t" : ""}`}
        >
          <summary className="text-ui hover:bg-surface/50 flex min-h-10 cursor-pointer list-none items-center gap-3 transition-colors duration-[120ms] [&::-webkit-details-marker]:hidden">
            <StateMarkIcon mark="passed" />
            <span className="min-w-0 flex-1">{passedLine(passed)}</span>
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
              strokeWidth={1.75}
            />
          </summary>
          <ul aria-label="Lanes that passed" className="border-rule border-t">
            {passed.map((lane) => (
              <LaneRow key={lane.lane} lane={lane} project={project} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export const HeldBackBits = ({
  results: areas,
}: {
  readonly results: readonly HeldBackResult[];
}) => (
  <ul
    aria-label="Held-back checks by area"
    className="text-sealed text-mono leading-terminal flex flex-col gap-1 font-mono"
  >
    {areas.map(({ area, passed, suite, total }) => (
      <li
        className="flex items-start gap-2 [overflow-wrap:anywhere]"
        data-area={area}
        key={area}
      >
        <LockKeyhole
          aria-hidden="true"
          className="mt-1 size-3.5 shrink-0"
          strokeWidth={1.75}
        />
        <span className="min-w-0">
          {area} {passed}/{total} @{" "}
          <span title={suite}>{shortValue(suite)}</span>
        </span>
      </li>
    ))}
  </ul>
);

const Sha = ({ sha }: { readonly sha: string }) => (
  <code className="text-mono font-mono" title={sha}>
    {shortSha(sha)}
  </code>
);

export const InspectorOnly = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <div className="border-rule flex min-w-0 flex-col border-t pt-3 first:border-t-0 first:pt-0 [[data-facts=inline]_&]:hidden">
    {children}
  </div>
);

const RoundsRegion = ({
  ask,
  current,
  now,
  project,
  rounds,
}: {
  readonly ask: AskId;
  readonly project: ProjectName;
  readonly rounds: readonly Round[];
  readonly current: CommitSha | undefined;
  readonly now: DateTime.Utc;
}) => {
  const read =
    current === undefined
      ? 0
      : rounds.findLastIndex(({ head }) => head === current) + 1;

  return (
    <Region id="answer-rounds" title="Rounds">
      <RowList label="Rounds">
        {rounds
          .map((round, index) => ({ number: index + 1, round }))
          .toReversed()
          .map(({ number, round: { at, head, outcome } }) => {
            const { lead, mark } = readStatus({ kind: "answer", outcome });

            return (
              <Row
                href={answerPath(project, ask)}
                id={`${head}:${number}`}
                key={`${head}:${number}`}
                meta={<CodeValue value={head} />}
                search={{ head }}
                selected={number === read}
                size="one-line"
                state={{ mark, time: <When at={at} now={now} />, word: lead }}
                title={`Round ${number} of ${rounds.length}`}
              />
            );
          })}
      </RowList>
    </Region>
  );
};

const waitingSentence = (round: ReturnType<typeof roundOf>) =>
  round === undefined
    ? "Nothing for you to run."
    : `Nothing for you to run. Pushing again starts round ${round.of + 1}; this verdict stays as round ${round.number}.`;

const NoAnswerYet = ({
  ask,
  now,
  states,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}) => {
  const progress = states.get(ask.id);

  const toAsk = (
    <AppLink
      className="decoration-rule underline hover:decoration-current"
      to={askPath(ask.project, ask.id)}
    >
      The ask
    </AppLink>
  );

  const claimant = progress?.claimant;
  const pushed = progress?.lastPush;

  if (claimant !== undefined || ask.state === "claimed") {
    const holder =
      claimant === undefined ? "Claimed" : `Claimed by ${claimant}`;

    return (
      <EmptyState
        onward={toAsk}
        title={
          pushed === undefined
            ? `${holder}, no answer pushed yet.`
            : `${holder}; the answer pushed ${distanceInWords(pushed.at, now)} waits for the gate.`
        }
      />
    );
  }

  const waiting = ask.blockedBy.filter(
    (blocker) => states.get(blocker)?.landed === undefined
  ).length;

  if (ask.state === "open" && waiting > 0) {
    return (
      <EmptyState
        onward={toAsk}
        title={`Nobody has answered this ask yet; it waits for ${waiting} ${
          waiting === 1 ? "ask" : "asks"
        } to land first.`}
      />
    );
  }

  if (ask.state === "open") {
    return (
      <EmptyState
        command={`${Brand.cli} claim ${ask.id} --project ${ask.project}`}
        title="Nobody has answered this ask yet."
      />
    );
  }

  return (
    <EmptyState
      onward={toAsk}
      title="No answer to this ask has been checked yet."
    />
  );
};

const Hero = ({
  ask,
  now,
  stamp,
  states,
  verdict,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly stamp: boolean;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly verdict: Verdict | undefined;
}) => {
  const tag = verdict?.outcome._tag ?? "none";
  const [shown, setShown] = useState(tag);
  const [changed, setChanged] = useState(false);

  if (shown !== tag) {
    setShown(tag);
    setChanged(true);
  }

  const claimant = states.get(ask.id)?.claimant;

  return (
    <section aria-label="Outcome" className="flex min-w-0 flex-col gap-3">
      <h2 className="sr-only">Outcome</h2>
      <div
        className={
          changed ? "animate-in fade-in-0 min-w-0 duration-150" : "min-w-0"
        }
        key={tag}
      >
        {verdict === undefined ? (
          <NoAnswerYet ask={ask} now={now} states={states} />
        ) : (
          <OutcomeView
            outcome={verdict.outcome}
            project={ask.project}
            size="title"
            stage={verdict.stage}
            stamp={stamp}
            {...(claimant === undefined ? {} : { claimant })}
          />
        )}
      </div>
    </section>
  );
};

const Run = ({
  holds,
  landing,
  now,
  round,
  verdict,
}: {
  readonly holds: ReturnType<typeof holdsOf>;
  readonly landing: LandingView | undefined;
  readonly now: DateTime.Utc;
  readonly round: ReturnType<typeof roundOf>;
  readonly verdict: Verdict;
}) => (
  <>
    <Region id="answer-gate" title="Gate">
      <StageStrip
        holds={holds}
        outcome={verdict.outcome}
        stage={verdict.stage}
      />
      {Outcome.isAnyOf([
        "AwaitingDecision",
        "AwaitingFinish",
        "WaitingOnParent",
      ])(verdict.outcome) ? (
        <p className="text-body max-w-[70ch]" data-waiting="">
          {waitingSentence(round)}
        </p>
      ) : null}
      <p className="text-ui text-muted-foreground">
        Checked on the tree it would land as: <Sha sha={verdict.head} /> merged
        onto main at{" "}
        <AppLink
          className="decoration-rule underline hover:decoration-current"
          to={commitHref(verdict.project, verdict.base)}
        >
          <Sha sha={verdict.base} />
        </AppLink>
        .
      </p>
    </Region>

    <Region id="answer-lanes" title="Lanes">
      <Lanes
        checking={Outcome.isAnyOf(["Checking"])(verdict.outcome)}
        lanes={verdict.lanes}
        project={verdict.project}
      />
    </Region>

    {verdict.heldBack.length === 0 ? null : (
      <Region id="answer-held-back" title="Held back">
        <p className="text-ui text-muted-foreground max-w-[70ch]">
          Checks the answer could not see: how many passed in each area, and the
          root of the suite the project committed to before the claim.
        </p>
        <HeldBackBits results={verdict.heldBack} />
      </Region>
    )}

    {landing === undefined ? null : (
      <Region id="answer-landing" title="Landing">
        {/* The landing told as a sentence before it is shown as a hash. */}
        <p className="text-title flex min-w-0 flex-wrap items-baseline gap-x-2 font-normal">
          <span className="flex items-center gap-2 font-semibold">
            <StateMarkIcon mark="landed" />
            <span className="text-landed">Landed</span>
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {/* The space is the sentence's; the gap only draws it. */}
            {" as "}
            <AppLink
              className="decoration-rule underline hover:decoration-current"
              to={commitHref(landing.project, landing.sha)}
            >
              <code
                className="font-mono text-[length:inherit]"
                title={landing.sha}
              >
                {shortSha(landing.sha)}
              </code>
            </AppLink>
            {landing.credits.length === 0 ? null : (
              <>
                {" · "}
                <CompactCredit credits={landing.credits} within />
              </>
            )}
            {" · "}
            <span className="text-muted-foreground">
              <When at={landing.landedAt} now={now} />
            </span>
          </span>
        </p>
        {/* More room above Credit's head than under it. */}
        <div className="mt-3">
          <CreditTrailers
            assisted={landing.assisted}
            credits={landing.credits}
            label="title"
            {...(landing.heldBackTrailer === undefined
              ? {}
              : { heldBack: landing.heldBackTrailer })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            In a clone of {landing.project}
          </span>
          <CommandLine command={`git show ${landing.sha}`} />
        </div>
        <AppLink
          className="text-ui flex items-center gap-1.5 self-start font-medium no-underline hover:underline"
          to={commitHref(landing.project, landing.sha)}
        >
          The landing commit
          <ArrowRight
            aria-hidden="true"
            className="size-4"
            strokeWidth={1.75}
          />
        </AppLink>
      </Region>
    )}

    {/* Below the shell's width the inspector's facts sit above the run, so the plumbing comes here, last. */}
    <div className="shell:hidden">
      <ProvenanceFacts entries={verdictProvenance(verdict, now)} />
    </div>
  </>
);

export interface AnswerViewProps {
  readonly ask: Ask;
  readonly verdict: Verdict | undefined;
  readonly landing?: LandingView | undefined;
  readonly now: DateTime.Utc;
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  readonly parent?: Ask | undefined;
  readonly head?: CommitSha | undefined;
  readonly stamp?: boolean;
  readonly viewer?: Handle | undefined;
}

const NONE: ReadonlyMap<AskId, AskProgress> = new Map();

const AnswerFacts = ({
  ask,
  now,
  parent,
  progress,
  states,
  subject,
  verdict,
  viewer,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly parent: Ask | undefined;
  readonly progress: AskProgress | undefined;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly subject: StatusSubject | undefined;
  readonly verdict: Verdict | undefined;
  readonly viewer: Handle | undefined;
}) => {
  const family = familyHead(ask, parent);
  const finale = family === undefined ? undefined : deleteChildOf(family);

  const landed =
    verdict !== undefined && Outcome.isAnyOf(["Landed"])(verdict.outcome);

  return (
    <>
      {subject === undefined ? null : (
        <InspectorOnly>
          <StateFacts subject={subject} />
        </InspectorOnly>
      )}
      {landed ? null : (
        <ClaimFacts
          now={now}
          {...(progress?.claimant === undefined
            ? {}
            : { claimant: progress.claimant })}
          {...(progress?.lastPush === undefined
            ? {}
            : { lastPush: progress.lastPush })}
          {...(viewer === undefined ? {} : { viewer })}
        />
      )}
      {family === undefined ? null : (
        <FamilyFacts
          current={ask.id}
          parent={family}
          project={ask.project}
          states={states}
          {...(finale === undefined ? {} : { finale })}
        />
      )}
      <TerritoryFacts ask={ask} />
      {verdict === undefined ? null : (
        <InspectorOnly>
          <ProvenanceFacts entries={verdictProvenance(verdict, now)} />
        </InspectorOnly>
      )}
    </>
  );
};

const AnswerMeta = ({
  ask,
  head,
  now,
  rounds,
  verdict,
}: {
  readonly ask: Ask;
  readonly head: CommitSha | undefined;
  readonly now: DateTime.Utc;
  readonly rounds: AskProgress["rounds"];
  readonly verdict: Verdict | undefined;
}) => {
  const round =
    verdict === undefined ? undefined : roundOf(rounds, verdict.head);

  return (
    <MetaLine
      parts={[
        <MetaCode key="ask">{ask.id}</MetaCode>,
        round === undefined
          ? undefined
          : `round ${round.number} of ${round.of}`,
        verdict === undefined ? undefined : (
          <span key="judged">
            judged <When at={verdict.at} now={now} />
          </span>
        ),
        head === undefined ? undefined : (
          <span key="earlier">
            an earlier answer;{" "}
            <AppLink
              className="decoration-rule underline hover:decoration-current"
              to={answerPath(ask.project, ask.id)}
            >
              the latest
            </AppLink>
          </span>
        ),
      ]}
    />
  );
};

export const AnswerView = ({
  ask,
  head,
  landing,
  now,
  parent,
  stamp = false,
  states = NONE,
  verdict,
  viewer,
}: AnswerViewProps) => {
  const progress = states.get(ask.id);
  const rounds = roundsAsTheyStand(progress, verdict);

  const subject: StatusSubject | undefined =
    verdict === undefined
      ? undefined
      : {
          claimant: progress?.claimant,
          kind: "answer",
          outcome: verdict.outcome,
          project: ask.project,
          stage: verdict.stage,
        };

  return (
    <Workspace
      crumbs={answerCrumbs(ask)}
      facts={
        <AnswerFacts
          ask={ask}
          now={now}
          parent={parent}
          progress={progress}
          states={states}
          subject={subject}
          verdict={verdict}
          viewer={viewer}
        />
      }
      factsHeading="This answer"
      state={
        <StatusLine
          compact
          subject={
            subject ?? {
              ask,
              claimant: progress?.claimant,
              kind: "ask",
              takeable: ask.state === "open",
            }
          }
        />
      }
      status={
        <div className="flex min-w-0 flex-col gap-4">
          <div className="text-ui text-muted-foreground">
            <AnswerMeta
              ask={ask}
              head={head}
              now={now}
              rounds={progress?.rounds ?? []}
              verdict={verdict}
            />
          </div>
          <Hero
            ask={ask}
            now={now}
            stamp={
              stamp &&
              verdict !== undefined &&
              Outcome.isAnyOf(["Landed"])(verdict.outcome)
            }
            states={states}
            verdict={verdict}
          />
        </div>
      }
      said
      title={ask.brief.want}
    >
      {rounds.length > 1 ? (
        <RoundsRegion
          ask={ask.id}
          current={verdict?.head}
          now={now}
          project={ask.project}
          rounds={rounds}
        />
      ) : null}
      {verdict === undefined ? null : (
        <Run
          holds={holdsOf(verdict, landing, progress?.rounds ?? [])}
          landing={landing}
          now={now}
          round={roundOf(progress?.rounds ?? [], verdict.head)}
          verdict={verdict}
        />
      )}
    </Workspace>
  );
};
