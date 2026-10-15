import type { Choice, Decision } from "@repo/protocol/domain/decision";
import type { DateTime } from "effect";
import { useId } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
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

export type ChoicesLayout = "grid" | "stack";

const LAYOUTS = {
  grid: "grid grid-cols-2 gap-x-3 gap-y-3",
  stack: "grid grid-cols-1 gap-3",
} as const satisfies Record<ChoicesLayout, string>;

export const Choices = ({
  busy,
  decision,
  layout = "grid",
  onChoose,
}: {
  readonly decision: Decision;
  readonly busy: boolean;
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
          const consequence = consequenceOf(decision.subject, choice);

          return (
            <div className="flex min-w-0 flex-col gap-1.5" key={choice}>
              <Button
                aria-describedby={`${id}-${choice}`}
                className="tablet:h-9 h-11 w-full px-4"
                data-choice={choice}
                disabled={busy}
                onClick={() => {
                  onChoose(choice);
                }}
                type="button"
                variant={isDefault ? "outline" : "default"}
              >
                {choiceWords[choice]}
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

export const TakenLine = ({
  choice,
  decision,
  stamp = false,
}: {
  readonly decision: Decision;
  readonly choice: Choice;
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

// Fixed at the foot of the screen, not sticky, on a phone: a bar that only
// stuck would stay below the screen while its decision starts low on the page.
// Its own padding clears the safe area, so no page shows beneath it.
export const stuckAtFoot = (node: ReactNode) => (
  <div
    className="border-rule bg-background tablet:static tablet:border-t-0 tablet:p-0 fixed inset-x-0 bottom-0 z-[6] border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    data-choices-bar=""
  >
    {node}
  </div>
);
