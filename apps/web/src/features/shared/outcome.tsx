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
  readonly claimant?: Handle;
  readonly stage?: StageName;
  readonly project?: ProjectName;
  readonly size?: "body" | "title";
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

export type StageState =
  | "passed"
  | "current"
  | "refused"
  | "pending"
  | "skipped";

export interface StageHolds {
  readonly decided: boolean;
  readonly heldBack: boolean;
}

/**
 * A passing verdict reaches the maintainer stage whether or not a maintainer took
 * part, so with `holds` a held-back or maintainer stage it never needed reads not
 * needed.
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
          {/* Four cells a row on a phone, then three: the mark sits over the name there, so "Maintainer" and "Held-back" stand whole. */}
          <span className="text-label tablet:flex-row tablet:items-start tablet:gap-1.5 flex min-w-0 flex-col gap-0.5">
            <StateMarkIcon
              className="mt-px"
              mark={marks[state].mark}
              size="sm"
            />
            <span
              className={`min-w-0 [hyphens:none] whitespace-nowrap ${
                state === "pending" || state === "skipped"
                  ? "text-muted-foreground"
                  : "text-foreground"
              }`}
              data-term=""
            >
              {stageNames(name).label}
            </span>
          </span>
          <span
            className={`text-label tablet:pl-5 font-normal ${
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
