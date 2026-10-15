import type { Decide } from "@repo/protocol/contracts";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import type { DateTime } from "effect";
import { Option } from "effect";
import { ChevronDown, Hourglass, Shield } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Textarea } from "../../components/ui/textarea.tsx";
import { changedFiles, isFinishDecision, patchOf } from "../finish/patch.ts";
import { When } from "../shared/time.tsx";
import { Choices, DecisionRecord } from "./choices.tsx";
import type { ChoicesLayout } from "./choices.tsx";
import { DecisionEvidence, FinishLink } from "./evidence.tsx";
import { describeDefault } from "./subject.ts";

export {
  allowedChoices,
  consequenceOf,
  describeDefault,
  describeSubject,
} from "./subject.ts";

export type DecideInput = typeof Decide.payloadSchema.Type;

export const ExpiryLines = ({
  decision,
  now,
  soon,
}: {
  readonly decision: Decision;
  readonly now: DateTime.Utc;
  readonly soon: boolean;
}) => (
  <div className="text-ui flex flex-col gap-1">
    <p
      className={`flex items-start gap-2 ${soon ? "text-waiting font-medium" : "text-muted-foreground"}`}
      data-soon={soon}
    >
      <Hourglass
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span>
        Expires <When at={decision.expiresAt} now={now} />
        {soon ? ", within the day" : null}
      </span>
    </p>
    <p className="flex items-start gap-2" data-default={decision.default}>
      <Shield
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span>{describeDefault(decision)}</span>
    </p>
  </div>
);

const NoteField = ({
  note,
  onNote,
}: {
  readonly note: string;
  readonly onNote: (note: string) => void;
}) => {
  const id = useId();

  return (
    <details className="group text-ui">
      <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 select-none [&::-webkit-details-marker]:hidden">
        Add a note to your choice
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform duration-150 group-open:rotate-180"
          strokeWidth={1.75}
        />
      </summary>
      <label
        className="text-label text-muted-foreground mt-2 block"
        htmlFor={id}
      >
        Note, kept with the decision
      </label>
      <Textarea
        className="tablet:text-ui mt-1 text-base"
        id={id}
        onChange={(event) => {
          onNote(event.target.value);
        }}
        value={note}
      />
    </details>
  );
};

interface ChoiceProps {
  readonly busy: boolean;
  readonly handleChoose: (choice: Choice) => void;
  readonly decision: Decision;
  readonly layout: ChoicesLayout;
}

const Ending = ({
  now,
  stamp,
  ...props
}: ChoiceProps & {
  readonly now: DateTime.Utc;
  readonly stamp: boolean;
}) => {
  const { decision } = props;

  if (decision.decided !== undefined) {
    return (
      <DecisionRecord
        decided={decision.decided}
        decision={decision}
        now={now}
        stamp={stamp}
      />
    );
  }

  return (
    <Choices
      busy={props.busy}
      decision={decision}
      layout={props.layout}
      onChoose={props.handleChoose}
    />
  );
};

export const finishFileCount = (decision: Decision): number | undefined =>
  Option.getOrUndefined(
    Option.map(patchOf(decision), (patch) => changedFiles(patch).length)
  );

export const DecisionCard = ({
  busy = false,
  children,
  choices,
  decision,
  expiry = true,
  finishLink = true,
  layout = "grid",
  now,
  onDecide,
  soon = false,
  stamp = false,
}: {
  readonly decision: Decision;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly soon?: boolean;
  readonly busy?: boolean;
  readonly children?: ReactNode;
  readonly choices?: (node: ReactNode) => ReactNode;
  readonly expiry?: boolean;
  readonly finishLink?: boolean;
  readonly layout?: ChoicesLayout;
  readonly stamp?: boolean;
}) => {
  const [note, setNote] = useState("");

  const handleChoose = (choice: Choice) => {
    const written = note.trim();

    const input = {
      choice,
      decision: decision.id,
      project: decision.project,
    };

    onDecide(written.length === 0 ? input : { ...input, note: written });
  };

  const chosen = (
    <Ending
      busy={busy}
      decision={decision}
      handleChoose={handleChoose}
      layout={layout}
      now={now}
      stamp={stamp}
    />
  );

  return (
    <article
      aria-label={`Decision ${decision.id}`}
      className="flex min-w-0 flex-col gap-4"
      data-decision={decision.id}
      data-project={decision.project}
    >
      {expiry && decision.decided === undefined ? (
        <ExpiryLines decision={decision} now={now} soon={soon} />
      ) : null}
      <DecisionEvidence decision={decision} />
      {finishLink && isFinishDecision(decision) ? (
        <FinishLink decision={decision} files={finishFileCount(decision)} />
      ) : null}
      {children}
      {decision.decided === undefined ? (
        <NoteField note={note} onNote={setNote} />
      ) : null}
      {choices === undefined ? chosen : choices(chosen)}
    </article>
  );
};
