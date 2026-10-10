/**
 * Where an answer stands, read the same on every page that shows one.
 *
 * `OutcomeView` gives the outcome as the status line (`StatusLine`):
 * checking, waiting (on a decision, a finish or a parent ask) or landed,
 * each with its state as `data-state` ("waiting" or "final"); a refusal's
 * line is followed by the refusal itself, drawn whole by `RefusalView`.
 * Waiting is never shown as refusing.
 *
 * `StageStrip` is the gate's results row: one cell per stage, in the order
 * of cost, each marked passed, current, refused, pending or not needed by
 * a mark and a word, colour only third.
 */
import { Outcome, StageName } from "@repo/protocol/domain/outcome";
import type { Handle, ProjectName } from "@repo/protocol/ids";

import { StateMarkIcon } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";
import { RefusalView } from "./refusal.tsx";
import { StatusLine, stageNames } from "./status-line.tsx";
import type { StatusSubject } from "./status-line.tsx";

export const OutcomeView = ({
  claimant,
  outcome,
  project,
  size = "body",
  stage,
  stamp = false,
}: {
  readonly outcome: Outcome;
  /** Who holds the ask, to name whose move a refusal leaves. */
  readonly claimant?: Handle;
  /** The stage the verdict reached, to say where a refusal came from. */
  readonly stage?: StageName;
  /** The project, to link the landing or what the answer waits on. */
  readonly project?: ProjectName;
  /** The answer page's hero is a step up. */
  readonly size?: "body" | "title";
  /** Settle a landing's mark once: it landed while the page was open. */
  readonly stamp?: boolean;
}) => {
  const subject: StatusSubject = {
    claimant,
    kind: "answer",
    outcome,
    project,
    stage,
  };

  if (Outcome.isAnyOf(["Refused"])(outcome)) {
    return (
      <div
        className="flex flex-col gap-3"
        data-outcome={outcome._tag}
        data-state="final"
      >
        <StatusLine command={false} size={size} subject={subject} />
        <RefusalView refusals={outcome.refusals} />
      </div>
    );
  }

  return (
    <div
      data-outcome={outcome._tag}
      data-state={Outcome.isAnyOf(["Landed"])(outcome) ? "final" : "waiting"}
    >
      <StatusLine
        size={size}
        stamp={stamp && Outcome.isAnyOf(["Landed"])(outcome)}
        subject={subject}
      />
    </div>
  );
};

/** A stage's place in the strip. */
export type StageState =
  | "passed"
  | "current"
  | "refused"
  | "pending"
  | "skipped";

/** What a verdict holds beyond its stage: a decider's decision, and held-back results. */
export interface StageHolds {
  readonly decided: boolean;
  readonly heldBack: boolean;
}

/**
 * Each stage's state, given the furthest stage the answer reached and its
 * outcome: stages before it passed; at it, current (checking or waiting),
 * refused, or passed (landed or waiting on its parent); after it, pending,
 * or skipped once the answer landed without them.
 *
 * A passing verdict reaches the decider stage whether or not a decider
 * took part, so with `holds` (what the verdict holds) a held-back or
 * decider stage that would read passed reads not needed when the verdict
 * holds no held-back results or no decision. Without it, every stage
 * before the reached one reads passed.
 */
export const stageStates = (
  reached: StageName,
  outcome: Outcome,
  holds?: StageHolds
): readonly (readonly [StageName, StageState])[] => {
  const at = StageName.literals.indexOf(reached);

  const atReached = Outcome.match<StageState>(outcome, {
    AwaitingDecision: () => "current",
    AwaitingFinish: () => "current",
    Checking: () => "current",
    Landed: () => "passed",
    Refused: () => "refused",
    WaitingOnParent: () => "passed",
  });

  const after: StageState = Outcome.isAnyOf(["Landed"])(outcome)
    ? "skipped"
    : "pending";

  const needed = (stage: StageName) =>
    holds === undefined ||
    (stage === "heldBack"
      ? holds.heldBack
      : stage !== "human" || holds.decided);

  const reachedAs = (index: number): StageState => {
    if (index < at) {
      return "passed";
    }

    return index === at ? atReached : after;
  };

  return StageName.literals.map((stage, index) => {
    const state = reachedAs(index);

    return [
      stage,
      state === "passed" && !needed(stage) ? "skipped" : state,
    ] as const;
  });
};

/** Each state's mark and word in a cell; the current one's mark follows the outcome. */
const cellMarks = (outcome: Outcome) =>
  ({
    current: {
      mark: Outcome.isAnyOf(["Checking"])(outcome) ? "now" : "waiting",
      word: "now",
    },
    passed: { mark: "passed", word: "passed" },
    pending: { mark: "notYet", word: "not yet" },
    refused: { mark: "refused", word: "refused" },
    skipped: { mark: "notNeeded", word: "not needed" },
  }) as const satisfies Record<
    StageState,
    { readonly mark: StateMark; readonly word: string }
  >;

/** A cell's word in its state's role; not yet and not needed stay muted. */
const wordTones = {
  current: "",
  passed: "text-landed",
  pending: "text-muted-foreground",
  refused: "text-refused",
  skipped: "text-muted-foreground",
} as const satisfies Record<StageState, string>;

export const StageStrip = ({
  holds,
  outcome,
  stage,
}: {
  /** What the verdict holds, so a stage it never needed reads not needed. */
  readonly holds?: StageHolds;
  readonly outcome: Outcome;
  readonly stage: StageName;
}) => {
  const marks = cellMarks(outcome);

  const currentTone = Outcome.isAnyOf(["Checking"])(outcome)
    ? "text-checking"
    : "text-waiting";

  return (
    <ol
      aria-label="Gate stages"
      className="border-rule tablet:grid-cols-7 grid grid-cols-4 border-t border-l"
    >
      {stageStates(stage, outcome, holds).map(([name, state]) => (
        <li
          aria-current={state === "current" ? "step" : undefined}
          className={`border-rule flex min-w-0 flex-col gap-0.5 border-r border-b px-2 py-1.5 ${
            state === "current" ? "bg-surface" : ""
          }`}
          data-stage={name}
          data-state={state}
          key={name}
        >
          <span className="text-label flex min-w-0 items-center gap-1.5">
            <StateMarkIcon mark={marks[state].mark} size="sm" />
            <span
              className={`truncate ${
                state === "pending" || state === "skipped"
                  ? "text-muted-foreground"
                  : "text-foreground"
              }`}
            >
              {stageNames(name).label}
            </span>
          </span>
          <span
            className={`text-label pl-5 font-normal ${
              state === "current" ? currentTone : wordTones[state]
            }`}
          >
            {marks[state].word}
          </span>
        </li>
      ))}
    </ol>
  );
};
