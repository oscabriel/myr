/**
 * A decider's choices on one decision: one button per choice its subject
 * allows, each taken with one tap (there is no confirm and no undo, as the
 * platform has none), and under each, in a muted line, what the platform
 * then does. The default (what happens if nobody decides) is the outline
 * button, with the word "default" beside its name.
 *
 * Once taken, the record replaces the buttons: who chose what, when, the
 * note, and what it did, in the landed role only for a choice that made
 * something happen.
 */
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import type { DateTime } from "effect";
import { Option } from "effect";
import { useId } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import { When } from "../shared/time.tsx";
import {
  allowedChoices,
  choiceWords,
  consequenceOf,
  describeSubject,
  takenWords,
  tookEffect,
} from "./subject.ts";

/** Why a choice waits, and whether it waits on something that will come. */
export interface Held {
  readonly reason: string;
  readonly waiting: boolean;
}

/** How the choices sit: two to a row (main, a phone's open row), or one under another (the inspector). */
export type ChoicesLayout = "grid" | "stack";

const LAYOUTS = {
  grid: "grid grid-cols-2 gap-x-3 gap-y-3",
  stack: "grid grid-cols-1 gap-3",
} as const satisfies Record<ChoicesLayout, string>;

export const Choices = ({
  busy,
  decision,
  held = Option.none(),
  layout = "grid",
  onChoose,
}: {
  readonly decision: Decision;
  /** A choice on its way: every button waits. */
  readonly busy: boolean;
  /** Why Accept waits, when it does (a proposal whose draft is not read yet). */
  readonly held?: Option.Option<Held>;
  readonly layout?: ChoicesLayout;
  readonly onChoose: (choice: Choice) => void;
}) => {
  const id = useId();

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" data-choices="">
      <legend className="sr-only">
        Your choice: {describeSubject(decision.subject)}
      </legend>
      <div className={LAYOUTS[layout]}>
        {allowedChoices(decision.subject).map((choice) => {
          const isDefault = choice === decision.default;
          const waits = Option.filter(held, () => choice === "accept");
          const consequence = consequenceOf(decision.subject, choice);

          return (
            <div className="flex min-w-0 flex-col gap-1.5" key={choice}>
              <Button
                aria-describedby={`${id}-${choice}`}
                className="tablet:h-9 h-11 w-full px-4"
                data-choice={choice}
                disabled={busy || Option.isSome(waits)}
                onClick={() => {
                  onChoose(choice);
                }}
                type="button"
                variant={isDefault ? "outline" : "default"}
              >
                {Option.isSome(waits) ? (
                  <>
                    {waits.value.waiting ? <Spinner /> : null}
                    {waits.value.reason}
                  </>
                ) : (
                  choiceWords[choice]
                )}
                {isDefault ? (
                  <span className="text-muted-foreground font-normal">
                    default
                  </span>
                ) : null}
              </Button>
              <p
                className="text-label text-muted-foreground font-normal"
                data-consequence={choice}
                id={`${id}-${choice}`}
              >
                {consequence}
              </p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};

/** A choice taken, in one line: its word in its role, then what it did. */
export const TakenLine = ({
  choice,
  decision,
  stamp = false,
}: {
  readonly decision: Decision;
  readonly choice: Choice;
  /** Settle the mark once: the decider took it while the page was open. */
  readonly stamp?: boolean;
}) => {
  const effect = tookEffect(decision, choice);

  return (
    <p className="text-ui flex items-start gap-2" data-decided={choice}>
      <StateMarkIcon
        className="mt-0.5"
        mark={effect ? "landed" : "notNeeded"}
        stamp={stamp && effect}
      />
      <span className="min-w-0">
        <strong
          className={`font-semibold ${effect ? "text-landed" : "text-foreground"}`}
        >
          {takenWords[choice]}
        </strong>
        <span className="text-muted-foreground">
          {" · "}
          {consequenceOf(decision.subject, choice)}
        </span>
      </span>
    </p>
  );
};

/** The record of a taken decision: the line, then who, when and the note. */
export const DecisionRecord = ({
  decided,
  decision,
  now,
  stamp = false,
}: {
  readonly decision: Decision;
  readonly decided: NonNullable<Decision["decided"]>;
  readonly now: DateTime.Utc;
  readonly stamp?: boolean;
}) => (
  <section aria-label="Decided" className="flex flex-col gap-2">
    <TakenLine choice={decided.choice} decision={decision} stamp={stamp} />
    <p className="text-ui text-muted-foreground pl-6">
      By <HandleLink handle={decided.by} /> <When at={decided.at} now={now} />
    </p>
    {decided.note === undefined ? null : (
      <p
        className="text-ui pl-6 [overflow-wrap:anywhere] whitespace-pre-line"
        data-note=""
        data-said=""
      >
        {decided.note}
      </p>
    )}
  </section>
);

// Choices kept in sight while their decision is: on a phone, a bar fixed
// above the bottom bar (a bar that only stuck would stay below the screen
// while its decision starts low on the page), with main keeping room for
// it at its foot (`styles.css`); from a tablet's width, where they sit.
export const stuckAboveBar = (node: ReactNode) => (
  <div
    className="border-rule bg-background tablet:static tablet:border-t-0 tablet:p-0 fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[6] border-t px-4 py-2"
    data-choices-bar=""
  >
    {node}
  </div>
);
