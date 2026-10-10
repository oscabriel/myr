/**
 * Where an answer stands, read the same on every page that shows one.
 *
 * `OutcomeView` gives the outcome in a sentence: checking, waiting (on a
 * decision, a finish or a parent ask) or landed, each with its state as
 * `data-state` ("waiting" or "final"); a refusal is drawn by `RefusalView`.
 * Waiting is never shown as refusing.
 *
 * `StageStrip` is the gate's results row: one cell per stage, in the order of
 * cost, each marked passed, current, refused, pending or skipped by a mark
 * and a word, colour only third.
 */
import { Outcome, StageName } from "@repo/protocol/domain/outcome";
import { Match } from "effect";
import {
  Check,
  Circle,
  CircleDot,
  Hourglass,
  Minus,
  Stamp,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { HandleLink } from "./handle.tsx";
import { RefusalView } from "./refusal.tsx";

/** Each stage as its cell is headed (`label`) and as a sentence names it (`words`). */
const stageNames = Match.type<StageName>().pipe(
  Match.when("parse", () => ({ label: "Parse", words: "parse" })),
  Match.when("shape", () => ({ label: "Shape", words: "shape" })),
  Match.when("merge", () => ({ label: "Merge", words: "merge" })),
  Match.when("cheap", () => ({ label: "Cheap", words: "cheap checks" })),
  Match.when("checks", () => ({ label: "Checks", words: "checks" })),
  Match.when("heldBack", () => ({
    label: "Held-back",
    words: "held-back checks",
  })),
  Match.when("human", () => ({ label: "Decider", words: "decider" })),
  Match.exhaustive
);

const short = (sha: string) => sha.slice(0, 7);

const ID = "font-mono text-mono";

interface Reading {
  readonly icon: LucideIcon;
  /** The role colour, as a text class. */
  readonly tone: string;
  readonly state: "waiting" | "final";
  /** The sentence's first word, set in the role colour. */
  readonly lead: string;
  /** The rest of the sentence, in ink. */
  readonly rest: ReactNode;
  /** Whether the mark settles once, as a landing's stamp does. */
  readonly stamps?: true;
}

/** An outcome `OutcomeView` reads as a sentence: anything but a refusal. */
type Sentenced = Exclude<Outcome, { readonly _tag: "Refused" }>;

const reading = Match.typeTags<Sentenced, Reading>()({
  AwaitingDecision: ({ decision }) => ({
    icon: Hourglass,
    lead: "Waiting",
    rest: (
      <>
        {" "}
        on decision <code className={ID}>{decision}</code>
      </>
    ),
    state: "waiting",
    tone: "text-waiting",
  }),
  AwaitingFinish: ({ decider }) => ({
    icon: Hourglass,
    lead: "Passed",
    rest: (
      <>
        , waiting for a decider&apos;s finish
        {decider === undefined ? null : (
          <>
            {" "}
            from <HandleLink handle={decider} />
          </>
        )}
      </>
    ),
    state: "waiting",
    tone: "text-waiting",
  }),
  Checking: ({ stage }) => ({
    icon: CircleDot,
    lead: "Checking",
    rest: <> at the {stageNames(stage).words} stage</>,
    state: "waiting",
    tone: "text-checking",
  }),
  Landed: ({ sha }) => ({
    icon: Stamp,
    lead: "Landed",
    rest: (
      <>
        {" "}
        as <code className={ID}>{short(sha)}</code>
      </>
    ),
    stamps: true,
    state: "final",
    tone: "text-landed",
  }),
  WaitingOnParent: ({ ask }) => ({
    icon: Hourglass,
    lead: "Passed",
    rest: (
      <>
        , waiting for <code className={ID}>{ask}</code> to land first
      </>
    ),
    state: "waiting",
    tone: "text-waiting",
  }),
});

export const OutcomeView = ({ outcome }: { readonly outcome: Outcome }) => {
  if (Outcome.isAnyOf(["Refused"])(outcome)) {
    return (
      <div data-outcome={outcome._tag} data-state="final">
        <RefusalView refusals={outcome.refusals} />
      </div>
    );
  }

  const read = reading(outcome);
  const Icon = read.icon;

  return (
    <p
      className="flex items-start gap-2 text-base"
      data-outcome={outcome._tag}
      data-state={read.state}
    >
      <Icon
        aria-hidden="true"
        className={`mt-1 size-4 shrink-0 ${read.tone} ${read.stamps === true ? "motion-safe:animate-stamp" : ""}`}
      />
      <span className="min-w-0">
        <strong className={`font-semibold ${read.tone}`}>{read.lead}</strong>
        {read.rest}
      </span>
    </p>
  );
};

/** A stage's place in the strip. */
export type StageState =
  | "passed"
  | "current"
  | "refused"
  | "pending"
  | "skipped";

/**
 * Each stage's state, given the furthest stage the answer reached and its
 * outcome: stages before it passed; at it, current (checking or waiting),
 * refused, or passed (landed or waiting on its parent); after it, pending,
 * or skipped once the answer landed without them.
 */
export const stageStates = (
  reached: StageName,
  outcome: Outcome
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

  return StageName.literals.map((stage, index) => {
    if (index < at) {
      return [stage, "passed"] as const;
    }

    return [stage, index === at ? atReached : after] as const;
  });
};

const marks = {
  current: { icon: CircleDot, word: "now" },
  passed: { icon: Check, word: "passed" },
  pending: { icon: Circle, word: "not yet" },
  refused: { icon: X, word: "refused" },
  skipped: { icon: Minus, word: "not needed" },
} as const satisfies Record<
  StageState,
  { readonly icon: LucideIcon; readonly word: string }
>;

export const StageStrip = ({
  outcome,
  stage,
}: {
  readonly outcome: Outcome;
  readonly stage: StageName;
}) => {
  const currentTone = Outcome.isAnyOf(["Checking"])(outcome)
    ? "text-checking"
    : "text-waiting";

  const tones = {
    current: currentTone,
    passed: "text-landed",
    pending: "text-muted-foreground",
    refused: "text-refused",
    skipped: "text-muted-foreground",
  } as const satisfies Record<StageState, string>;

  return (
    <ol
      aria-label="Gate stages"
      className="border-rule flex flex-wrap border-t border-l"
    >
      {stageStates(stage, outcome).map(([name, state]) => {
        const { icon: Icon, word } = marks[state];

        return (
          <li
            aria-current={state === "current" ? "step" : undefined}
            className={`border-rule flex min-w-0 grow basis-1/4 items-start gap-1.5 border-r border-b px-2 py-1.5 sm:basis-0 ${state === "pending" || state === "skipped" ? "text-muted-foreground" : ""}`}
            data-stage={name}
            data-state={state}
            key={name}
          >
            <Icon
              aria-hidden="true"
              className={`mt-0.5 size-3.5 shrink-0 ${tones[state]}`}
              strokeWidth={state === "current" ? 2.5 : 2}
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-label truncate">
                {stageNames(name).label}
              </span>
              <span className={`text-label ${tones[state]}`}>{word}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};
