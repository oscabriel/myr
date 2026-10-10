/**
 * An answer, read like a run of the gate: where it stands first, then the
 * stages it passed, the lanes (failed ones open, passed ones folded into a
 * line), the held-back checks as one line per area, and, once it landed,
 * the landing's credit and its commit. What was judged (head, base, merged
 * tree, patch id) is plumbing, so it sits last, in the inspector.
 *
 * - The outcome is the hero: the status line a step up, whose move it is,
 *   and a refusal drawn whole by `RefusalView`, as `git push` printed it.
 *   When the outcome changes while the page is open its word and mark
 *   settle in, and a landing that happened then is stamped once.
 * - A stage the answer never needed (no decider took part, no held-back
 *   checks judged it) reads not needed, never passed.
 * - With no answer judged yet, the page says who holds the ask, or gives
 *   the command that claims it: never a dead end.
 *
 * Held-back checks show only what `HeldBackResult` carries: an area, how
 * many passed of how many, and the suite's root. A lane's log is named
 * only by the command that reads it. The head and the merged tree live in
 * the claim's fork, which the code browser never reads, so only the base
 * and the landing link their commit pages.
 */
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
import type { AskId, CommitSha, Handle } from "@repo/protocol/ids";
import { ChecksFailed } from "@repo/protocol/refusal";
import type { DateTime } from "effect";
import { ChevronDown, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Region } from "../ask/fields.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { CommandLine } from "../shared/command.tsx";
import { CreditTrailers } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import {
  ClaimFacts,
  FamilyFacts,
  ProvenanceFacts,
  RoundsFacts,
  StateFacts,
  TerritoryFacts,
  verdictProvenance,
} from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import type { StateMark } from "../shared/marks.tsx";
import { OutcomeView, StageStrip } from "../shared/outcome.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { MetaCode, MetaLine } from "../shared/row.tsx";
import type { Crumb } from "../shared/shell/sections.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import type { StatusSubject } from "../shared/status-line.tsx";
import { distanceInWords, When } from "../shared/time.tsx";
import {
  deleteChildOf,
  familyHead,
  holdsOf,
  roundOf,
  roundsAsTheyStand,
} from "./subject.ts";

/** How long a lane ran: "640 ms", "8.3 s", "2 min 5 s". */
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

/** Each lane result as a mark, a word and its role colour: the word first. */
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

/** The page's trail: the project, its asks, the ask, then this answer. */
export const answerCrumbs = (ask: Ask): readonly Crumb[] => [
  { label: ask.project, to: `/${ask.project}` },
  { label: "Asks", to: `/${ask.project}` },
  { label: ask.id, mono: true, to: askPath(ask.project, ask.id) },
  { label: "Answer" },
];

/** What reads a lane's log, when the platform kept one. */
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

/** One lane: its mark, name and command, its result in a word, and how long it ran. */
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

/** "6 lanes passed in 41 s": the lanes run one after another, so their times add up. */
const passedLine = (lanes: readonly LaneResult[]) =>
  `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"} passed in ${durationText(
    lanes.reduce((total, { durationMs }) => total + durationMs, 0)
  )}`;

/** The lanes the platform ran on the merged tree: what failed, open and first; what passed, in one line. */
export const Lanes = ({
  lanes,
  project,
}: {
  readonly lanes: readonly LaneResult[];
  readonly project: Ask["project"];
}) => {
  if (lanes.length === 0) {
    return <EmptyState title="No lane ran on this answer." />;
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

/** Held-back checks: one line per area, as the landing's trailer spells it, and nothing else. */
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
          {area} {passed}/{total} @ {suite}
        </span>
      </li>
    ))}
  </ul>
);

/** A git id, short as git prints it, whole on hover. */
const Sha = ({ sha }: { readonly sha: string }) => (
  <code className="text-mono font-mono" title={sha}>
    {shortSha(sha)}
  </code>
);

/** Content the inspector shows, left out of the facts drawn inline in main below the shell's width. */
export const InspectorOnly = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <div className="border-rule flex min-w-0 flex-col border-t pt-3 first:border-t-0 first:pt-0 [[data-facts=inline]_&]:hidden">
    {children}
  </div>
);

/** What the hero says before any answer was judged: who holds the ask, or how to take it. */
const NoAnswerYet = ({
  ask,
  now,
  progress,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly progress: AskProgress | undefined;
}) => {
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

/**
 * The outcome, a step up: settled in when it changes while the page is
 * open (never on the first paint), and stamped once on a live landing.
 */
const Hero = ({
  ask,
  now,
  progress,
  stamp,
  verdict,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly progress: AskProgress | undefined;
  readonly stamp: boolean;
  readonly verdict: Verdict | undefined;
}) => {
  const tag = verdict?.outcome._tag ?? "none";
  // Only an outcome that replaced another while the page was open settles in.
  const [shown, setShown] = useState(tag);
  const [changed, setChanged] = useState(false);

  if (shown !== tag) {
    setShown(tag);
    setChanged(true);
  }

  const claimant = progress?.claimant;

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
          <NoAnswerYet ask={ask} now={now} progress={progress} />
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

/** The answer's run: the gate, the lanes, the held-back checks, and the landing. */
const Run = ({
  holds,
  landing,
  now,
  verdict,
}: {
  readonly holds: ReturnType<typeof holdsOf>;
  readonly landing: LandingView | undefined;
  readonly now: DateTime.Utc;
  readonly verdict: Verdict;
}) => (
  <>
    <Region id="answer-gate" title="Gate">
      <StageStrip
        holds={holds}
        outcome={verdict.outcome}
        stage={verdict.stage}
      />
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
      <Lanes lanes={verdict.lanes} project={verdict.project} />
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
        <CreditTrailers
          assisted={landing.assisted}
          credits={landing.credits}
          {...(landing.heldBackTrailer === undefined
            ? {}
            : { heldBack: landing.heldBackTrailer })}
        />
        <AppLink
          className="text-ui decoration-rule self-start font-medium underline hover:decoration-current"
          to={commitHref(landing.project, landing.sha)}
        >
          The landing commit
        </AppLink>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            In a clone of {landing.project}
          </span>
          <CommandLine command={`git show ${landing.sha}`} />
        </div>
      </Region>
    )}

    {/* Below the shell's width the inspector's facts sit above the run, so
        the plumbing comes here, last. */}
    <div className="shell:hidden">
      <ProvenanceFacts entries={verdictProvenance(verdict, now)} />
    </div>
  </>
);

export interface AnswerViewProps {
  /** The ask the answer is to: its want titles the page. */
  readonly ask: Ask;
  /** The verdict on the answer; none before one was judged. */
  readonly verdict: Verdict | undefined;
  /** The landing it made, once it landed. */
  readonly landing?: LandingView | undefined;
  readonly now: DateTime.Utc;
  /** Where each ask stands, from the project's events (`askStates`). */
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  /** The family's parent, when the ask is a member of one. */
  readonly parent?: Ask | undefined;
  /** The head the address names, when it names an earlier answer. */
  readonly head?: CommitSha | undefined;
  /** It landed while the page was open: stamp the landing's mark, once. */
  readonly stamp?: boolean;
  /** Who is reading, to tell the claimant the claim is theirs. */
  readonly viewer?: Handle | undefined;
}

const NONE: ReadonlyMap<AskId, AskProgress> = new Map();

/** The answer's facts: its state, rounds, claim, family, territory and check, then what was judged. */
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
      <RoundsFacts
        ask={ask.id}
        now={now}
        project={ask.project}
        rounds={roundsAsTheyStand(progress, verdict)}
        {...(verdict === undefined ? {} : { current: verdict.head })}
      />
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

/** The line under the hero's title: the ask, the round, when it was judged, and the way to the latest answer. */
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
      meta={
        <AnswerMeta
          ask={ask}
          head={head}
          now={now}
          rounds={progress?.rounds ?? []}
          verdict={verdict}
        />
      }
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
        <Hero
          ask={ask}
          now={now}
          progress={progress}
          stamp={
            stamp &&
            verdict !== undefined &&
            Outcome.isAnyOf(["Landed"])(verdict.outcome)
          }
          verdict={verdict}
        />
      }
      title={ask.brief.want}
    >
      {verdict === undefined ? null : (
        <Run
          holds={holdsOf(verdict, landing, progress?.rounds ?? [])}
          landing={landing}
          now={now}
          verdict={verdict}
        />
      )}
    </Workspace>
  );
};
