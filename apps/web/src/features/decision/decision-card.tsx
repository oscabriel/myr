/**
 * One decision, as a decider takes it: when it expires and what happens if
 * nobody decides (the decision's own `default`), its evidence typed by its
 * subject, a note to keep with the choice, and the choices with what each
 * does. Once taken, the record replaces the choices. Today's inspector, a
 * phone's open row and the decision's own page each draw this one card.
 *
 * An `OpenProposal` holds Accept until its draft has been read, and while
 * the platform's agent is drafting it again: the draft is passed in, or
 * read from `showProposal` in the browser when it is not, so the server
 * never renders an Accept the browser might then hold.
 *
 * The subject's words follow GLOSSARY.md (ask, answer, landing, finish,
 * vouch). The default's word is the decision's `default` field as the
 * platform set it: the web keeps no table of defaults by subject.
 */
import type { Decide } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { ProposalId } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { Option } from "effect";
import { ChevronDown, Hourglass, Shield } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Textarea } from "../../components/ui/textarea.tsx";
import { changedFiles, isFinishDecision, patchOf } from "../finish/patch.ts";
import { DraftRead, useLiveDraft } from "../proposal/live-draft.ts";
import { When } from "../shared/time.tsx";
import { Choices, DecisionRecord } from "./choices.tsx";
import type { ChoicesLayout, Held } from "./choices.tsx";
import { DecisionEvidence, FinishLink } from "./evidence.tsx";
import { describeDefault } from "./subject.ts";

export {
  allowedChoices,
  consequenceOf,
  describeDefault,
  describeSubject,
} from "./subject.ts";

/** What a decider sends when they choose: the `decide` contract's payload, from its one schema. */
export type DecideInput = typeof Decide.payloadSchema.Type;

/** Whether a decision opens a proposed ask. */
const opensAsk = DecisionSubject.isAnyOf(["OpenProposal"]);

/** Whether a draft is still being written. */
const isDraftingNow = DraftState.isAnyOf(["Drafting"]);

/**
 * Why Accept on a proposal waits, if it does: its draft not read yet, its
 * read failed, or the draft being written. Once read it may be accepted: a
 * ready draft, a want alone, or a failed round (which keeps an earlier
 * ready draft, or leaves the want alone).
 */
const acceptHeld = (read: DraftRead): Option.Option<Held> =>
  DraftRead.$match(read, {
    Read: ({ draft }) =>
      Option.exists(draft, isDraftingNow)
        ? Option.some({ reason: "Drafting…", waiting: true })
        : Option.none(),
    Unread: ({ failed }) =>
      Option.some(
        failed
          ? { reason: "Draft not read; reload", waiting: false }
          : { reason: "Reading the draft…", waiting: true }
      ),
  });

/** When it expires, and what happens if nobody decides. */
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

/** A note kept with the choice, behind a disclosure. */
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

/** The choices on a proposal whose draft state was not passed: read from `showProposal`. */
const ProposalChoices = ({
  proposal,
  ...props
}: ChoiceProps & { readonly proposal: ProposalId }) => {
  const read = useLiveDraft(props.decision.project, proposal);

  return (
    <Choices
      busy={props.busy}
      decision={props.decision}
      held={acceptHeld(read)}
      layout={props.layout}
      onChoose={props.handleChoose}
    />
  );
};

/**
 * What ends the card: the choices while the decision is open (a
 * proposal's held until its draft is read), the record once it is taken.
 */
const Ending = ({
  draft,
  now,
  stamp,
  ...props
}: ChoiceProps & {
  readonly draft: DraftRead | undefined;
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

  if (opensAsk(decision.subject)) {
    return draft === undefined ? (
      <ProposalChoices {...props} proposal={decision.subject.proposal} />
    ) : (
      <Choices
        busy={props.busy}
        decision={decision}
        held={acceptHeld(draft)}
        layout={props.layout}
        onChoose={props.handleChoose}
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

/** How many files a finish's diff changes, when it carries one. */
export const finishFileCount = (decision: Decision): number | undefined =>
  Option.getOrUndefined(
    Option.map(patchOf(decision), (patch) => changedFiles(patch).length)
  );

export const DecisionCard = ({
  busy = false,
  children,
  choices,
  decision,
  draft,
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
  /** Whether it expires within the day (Today's `expiringSoon`). */
  readonly soon?: boolean;
  /** Whether a choice on it is on its way: its buttons wait. */
  readonly busy?: boolean;
  /** What a page shows after the evidence, before the note (a waiver's diff). */
  readonly children?: ReactNode;
  /**
   * Where the choices go: in place (the default), or handed to the page,
   * which puts them where they stay in sight (a phone's sticky bar).
   */
  readonly choices?: (node: ReactNode) => ReactNode;
  /** Whether it says when it expires and its default (off where the page says so already). */
  readonly expiry?: boolean;
  /** Whether a finish links to its own page, where its diff is (off on that page). */
  readonly finishLink?: boolean;
  readonly layout?: ChoicesLayout;
  /** Settle the record's mark once: the choice was taken while the page was open. */
  readonly stamp?: boolean;
  /**
   * For an `OpenProposal`, what has been read of the proposal's draft:
   * Accept waits until it is read, and while it is drafting. Read from
   * `showProposal` in the browser when not passed.
   */
  readonly draft?: DraftRead | undefined;
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
      draft={draft}
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
