/**
 * One proposal, as its proposer and its deciders follow it: the want and
 * who proposed it, where the platform's draft of its ask stands (drafting,
 * ready after its check ran red first, or failed with the last refusal),
 * the drafted files, and the way to the decision that would open the ask.
 * "Draft again" (with an optional note for the agent) is the proposer's or
 * a decider's while the proposal is open and not drafting. Props in, markup
 * out: the route reads `showProposal`, who is signed in and the decider's
 * Today, and sends `draftAsk`.
 *
 * Nothing here edits the drafted files: a member proposes again, or a
 * decider sends the draft back with a note.
 */
import type { ConfigFile } from "@repo/protocol/domain/common";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import { constVoid } from "effect/Function";
import { CircleCheck, OctagonX, Scale } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { DraftedCode } from "./client-file.tsx";

/**
 * How many attempts a draft round makes before it fails: the platform's
 * `DRAFT_ROUNDS` (`@repo/project/draft-runs`), which the web's production
 * code does not import; `test/proposal.test.tsx` holds the two equal.
 */
export const DRAFT_ATTEMPTS = 3;

/** The longest note `draftAsk` takes. */
const NOTE_LIMIT = 2000;

/** Where a proposal stands in one word: its draft's while it is open, else its own. */
export const standing = (proposal: Proposal) =>
  proposal.state === "open" && proposal.draft !== undefined
    ? proposal.draft._tag
    : proposal.state;

const draftingNow = DraftState.isAnyOf(["Drafting"]);

const failedNow = DraftState.isAnyOf(["Failed"]);

/** Whether the platform's agent is drafting the proposal's ask right now. */
export const isDrafting = (proposal: Proposal) =>
  proposal.draft !== undefined && draftingNow(proposal.draft);

const LABEL = "text-muted-foreground text-xs font-medium";

/** The badge each standing wears: an ending that opened nothing reads as refused. */
const badgeVariant = {
  Drafting: "outline",
  Failed: "destructive",
  Ready: "secondary",
  accepted: "secondary",
  declined: "destructive",
  expired: "destructive",
  open: "secondary",
} as const satisfies Record<ReturnType<typeof standing>, string>;

const StateBadge = ({ proposal }: { readonly proposal: Proposal }) => {
  const word = standing(proposal);

  return (
    <Badge data-standing={word} variant={badgeVariant[word]}>
      {word === "Drafting" ? <Spinner className="size-3" /> : null}
      {word}
    </Badge>
  );
};

/** What the draft says: in progress, ready with its red-first run, or failed. */
const DraftFacts = ({ draft }: { readonly draft: DraftState }) =>
  DraftState.match(draft, {
    Drafting: ({ note, round }) => (
      <div className="flex flex-col gap-1 text-sm" data-draft="Drafting">
        <p className="flex items-start gap-2">
          <Spinner className="text-checking mt-0.5 shrink-0" />
          <span>
            Drafting (round {round}): the platform&apos;s agent is writing the
            ask and a check, then running the check on main, where it must fail
            twice the same way. This takes a few minutes; the page follows it.
          </span>
        </p>
        {note === undefined ? null : (
          <p
            className="pl-6 [overflow-wrap:anywhere] whitespace-pre-line"
            data-note=""
          >
            <span className={LABEL}>Note:</span> {note}
          </p>
        )}
      </div>
    ),
    Failed: ({ attempts, model, refusal, round }) => (
      <div className="flex flex-col gap-1 text-sm" data-draft="Failed">
        <p className="flex items-start gap-2">
          <OctagonX
            aria-hidden="true"
            className="text-refused mt-0.5 size-4 shrink-0"
          />
          <span>
            The draft failed (round {round}), after {attempts} of{" "}
            {DRAFT_ATTEMPTS} attempts by {model}. The last refusal:{" "}
            <b className="text-refused font-mono font-semibold">{refusal}</b>
          </span>
        </p>
      </div>
    ),
    Ready: ({ attempts, model, red }) => (
      <dl
        className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]"
        data-draft="Ready"
      >
        <dt className={`${LABEL} pt-0.5`}>Red first</dt>
        <dd className="mb-1.5 flex items-start gap-2 [overflow-wrap:anywhere] sm:mb-0">
          <CircleCheck
            aria-hidden="true"
            className="text-landed mt-0.5 size-4 shrink-0"
          />
          <span>
            fails twice the same way in lane {red.lane}: {red.signature}
          </span>
        </dd>
        <dt className={`${LABEL} pt-0.5`}>Drafted by</dt>
        <dd className="mb-1.5 [overflow-wrap:anywhere] sm:mb-0">
          drafted by {model}, attempt {attempts} of {DRAFT_ATTEMPTS}
        </dd>
      </dl>
    ),
  });

/** "Draft again", with a note the agent reads. */
const Redraft = ({
  again,
  busy,
  onRedraft,
}: {
  readonly again: boolean;
  readonly busy: boolean;
  readonly onRedraft: (note: string | undefined) => void;
}) => {
  const [note, setNote] = useState("");
  const noteId = useId();

  return (
    <section
      aria-label="Draft again"
      className="border-rule flex flex-col gap-3 border-t pt-4"
    >
      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer py-1 select-none">
          Add a note for the agent
        </summary>
        <label className={`${LABEL} mt-2 block`} htmlFor={noteId}>
          What the next draft should do differently
        </label>
        <Textarea
          className="mt-1 text-sm md:text-sm"
          id={noteId}
          maxLength={NOTE_LIMIT}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          value={note}
        />
      </details>
      <Button
        className="h-11 w-full px-4 text-sm sm:h-9 sm:w-fit sm:min-w-28"
        disabled={busy}
        onClick={() => {
          const written = note.trim();

          onRedraft(written.length === 0 ? undefined : written);
        }}
        type="button"
        variant="outline"
      >
        {again ? "Draft again" : "Let the platform's agent draft it"}
      </Button>
    </section>
  );
};

/** The way to the open decision that would open the ask. */
const DecisionLink = ({
  decision,
  project,
}: {
  readonly decision: DecisionId;
  readonly project: ProjectName;
}) => (
  <a
    className="decoration-rule flex w-fit items-center gap-2 text-sm font-medium underline hover:decoration-current"
    data-decision={decision}
    href={`/${project}/decisions/${decision}`}
  >
    <Scale aria-hidden="true" className="size-4 shrink-0" />
    Decide it: {decision}
  </a>
);

export const ProposalView = ({
  busy = false,
  children,
  decision,
  files,
  mayRedraft,
  onRedraft = constVoid,
  project,
  proposal,
}: {
  readonly project: ProjectName;
  readonly proposal: Proposal;
  /** The files the proposal holds (the ask file and its check), as `showProposal` read them. */
  readonly files: readonly ConfigFile[];
  /** The open decision on the proposal, when the reader's Today holds it. */
  readonly decision: Option.Option<DecisionId>;
  /** Whether the reader is its proposer or one of the project's deciders. */
  readonly mayRedraft: boolean;
  readonly onRedraft?: (note: string | undefined) => void;
  /** Whether a "Draft again" is on its way: the button waits. */
  readonly busy?: boolean;
  /** What the last "Draft again" came back with, when it was refused. */
  readonly children?: ReactNode;
}): ReactNode => {
  const open = proposal.state === "open";

  return (
    <article
      aria-labelledby={`${proposal.id}-want`}
      className="flex max-w-[90ch] min-w-0 flex-col gap-5"
      data-proposal={proposal.id}
    >
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono">{project}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{proposal.id}</span>
          <StateBadge proposal={proposal} />
        </p>
        <h2
          className="text-lg font-semibold text-balance [overflow-wrap:anywhere]"
          id={`${proposal.id}-want`}
        >
          {proposal.want}
        </h2>
        <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            Proposed by <HandleLink handle={proposal.proposer} />
          </span>
          {proposal.territory === undefined ? null : (
            <span>
              in <code className="font-mono">{proposal.territory}</code>
            </span>
          )}
        </p>
      </header>

      {proposal.draft === undefined ? null : (
        <DraftFacts draft={proposal.draft} />
      )}

      {Option.isSome(decision) ? (
        <DecisionLink decision={decision.value} project={project} />
      ) : null}

      {files.length === 0 ? null : (
        <section
          aria-labelledby={`${proposal.id}-files`}
          className="flex min-w-0 flex-col gap-4"
        >
          <h2 className="text-base font-semibold" id={`${proposal.id}-files`}>
            {proposal.draft === undefined ? "Proposed files" : "Drafted files"}
          </h2>
          {proposal.draft !== undefined && failedNow(proposal.draft) ? (
            <p className="text-muted-foreground -mt-2 text-sm" data-kept="">
              An earlier round&apos;s ready draft, which a decider can still
              accept: it runs red first again on main before the ask opens.
            </p>
          ) : null}
          {files.map(({ content, path }) => (
            <DraftedCode content={content} key={path} path={path} />
          ))}
        </section>
      )}

      {children}

      {mayRedraft && open && !isDrafting(proposal) ? (
        <Redraft
          again={proposal.draft !== undefined}
          busy={busy}
          onRedraft={onRedraft}
        />
      ) : null}
    </article>
  );
};
