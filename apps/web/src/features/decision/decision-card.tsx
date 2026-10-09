/**
 * One decision, as a decider takes it: what it is about in plain words, the
 * evidence, what happens if nobody decides (the decision's own `default`)
 * and when, and one button per choice its subject allows. A note is
 * optional. A `Finish` decision links to the answer's diff; no other
 * decision shows one, and the card never shows the diff itself.
 *
 * An `OpenProposal` shows the files the proposal would add (the ask file and
 * its check) as code under their paths, links the proposal's page, and holds
 * Accept until its draft has been read, and while the platform's agent is
 * drafting the proposal again: the draft is passed in, or read from
 * `showProposal` in the browser when it is not, so the server never renders
 * an Accept the browser might then hold.
 *
 * The subject's words follow GLOSSARY.md (ask, answer, landing, finish,
 * vouch). The default's word is the decision's `default` field as the
 * platform set it: the web keeps no table of defaults by subject.
 */
import type { Decide } from "@repo/protocol/contracts";
import type { Evidence as Fact } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";
import { FileDiff, FileText, Hourglass, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import {
  changedFiles,
  isFinishDecision,
  PATCH_LABEL,
  patchOf,
} from "../finish/patch.ts";
import { DraftedCode } from "../proposal/client-file.tsx";
import { useLiveDraft } from "../proposal/live-draft.ts";
import type { DraftRead } from "../proposal/live-draft.ts";
import { When } from "../shared/time.tsx";

/** What a decider sends when they choose: the `decide` contract's payload, from its one schema. */
export type DecideInput = typeof Decide.payloadSchema.Type;

const yesOrNo: readonly Choice[] = ["accept", "decline"];

/**
 * The choices a subject's deciders have: a stray push is adopted or
 * reverted, anything else accepted or declined. The platform reads `accept`
 * on a stray push as `adopt` too, but the page offers each subject its own
 * words only.
 */
export const allowedChoices = DecisionSubject.match({
  Finish: () => yesOrNo,
  OpenProposal: () => yesOrNo,
  PostureChange: () => yesOrNo,
  ProxyWidened: () => yesOrNo,
  RaiseRatchet: () => yesOrNo,
  SecretInTree: () => yesOrNo,
  StrayPush: (): readonly Choice[] => ["adopt", "revert"],
  Vouch: () => yesOrNo,
  Waiver: () => yesOrNo,
});

const short = (sha: string) => sha.slice(0, 7);

/** A ref as people say it: `main` for `refs/heads/main`. */
const refWords = (ref: string) => ref.replace(/^refs\/heads\//u, "");

/** What a decision is about, in one plain sentence. */
export const describeSubject = DecisionSubject.match({
  Finish: ({ ask, head }) =>
    `Finish the passing answer to ${ask}, at ${short(head)}`,
  OpenProposal: ({ proposal }) => `Open the ask proposed in ${proposal}`,
  PostureChange: ({ from, to }) =>
    `Change the project's posture from ${from} to ${to}`,
  ProxyWidened: ({ hosts, item }) =>
    `Let ${item} be sent to ${hosts.length === 0 ? "more hosts" : hosts.join(", ")} through the platform's proxy`,
  RaiseRatchet: ({ after, ask, before, ratchet, territory }) =>
    `Raise the ${ratchet} ratchet in ${territory} from ${before} to ${after}, for the answer to ${ask}`,
  SecretInTree: ({ ask, item }) =>
    `A stored value of ${item} turned up in the answer to ${ask}, which is held aside`,
  StrayPush: ({ after, before, ref }) =>
    `${refWords(ref)} moved without a landing, from ${short(before)} to ${short(after)}`,
  Vouch: ({ handle }) => `Vouch for ${handle}, so they may claim asks`,
  Waiver: ({ ask, at, marker, reason }) =>
    `Allow ${marker} at ${at.path}:${at.line} in the answer to ${ask}: ${reason}`,
});

/** An expiry as a decider reads it on any phone: weekday, date and time, in UTC. */
const byWhen = (at: DateTime.Utc) =>
  `${DateTime.formatUtc(at, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    locale: "en-GB",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  })} UTC`;

/** What happens when nobody decides in time: the decision's own default, and by when. */
export const describeDefault = (decision: Decision) =>
  `If nobody decides by ${byWhen(decision.expiresAt)}: ${decision.default}`;

/** A decision's own page: for a `Finish`, the answer's diff and how to finish it. */
export const decisionPath = (decision: Decision) =>
  `/${decision.project}/decisions/${decision.id}`;

const LABEL = "text-muted-foreground text-xs font-medium";

const words = {
  accept: "Accept",
  adopt: "Adopt",
  decline: "Decline",
  revert: "Revert",
} as const satisfies Record<Choice, string>;

/** Whether a decision opens a proposed ask. */
const opensAsk = DecisionSubject.isAnyOf(["OpenProposal"]);

/** Whether a draft is still being written. */
const isDraftingNow = DraftState.isAnyOf(["Drafting"]);

/**
 * Why Accept on a proposal waits, if it does: its draft not read yet, or
 * being written. Once read it may be accepted: a ready draft, a want alone,
 * or a failed round (which keeps an earlier ready draft, or leaves the want
 * alone).
 */
const acceptHeld = (read: DraftRead): Option.Option<string> =>
  Option.match(read, {
    onNone: () => Option.some("Reading the draft…"),
    onSome: (draft) =>
      Option.exists(draft, isDraftingNow)
        ? Option.some("Drafting…")
        : Option.none(),
  });

/**
 * Whether an evidence line holds a file: its label is a path (one word with
 * a slash or a dot, as the ask file under the config folder, or a check
 * at the root, `offset.test.ts`), where every other label is words.
 */
const isFileFact = ({ label }: Fact) => /^\S*[./]\S*$/u.test(label);

/** The files an `OpenProposal` decision holds, shown as code; none for any other subject. */
const filesOf = (decision: Decision): readonly Fact[] =>
  opensAsk(decision.subject) ? decision.evidence.filter(isFileFact) : [];

const Facts = ({ facts }: { readonly facts: readonly Fact[] }) => (
  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(8rem,auto)_1fr]">
    {facts.map(({ href, label, value }) => (
      <div className="contents" key={`${label}:${value}`}>
        <dt className={`${LABEL} pt-0.5`}>{label}</dt>
        <dd className="mb-1.5 text-sm [overflow-wrap:anywhere] sm:mb-0">
          {href === undefined ? (
            value
          ) : (
            <a
              className="decoration-rule underline hover:decoration-current"
              href={href}
            >
              {value}
            </a>
          )}
        </dd>
      </div>
    ))}
  </dl>
);

const Evidence = ({ decision }: { readonly decision: Decision }) => {
  // The diff is the finish page's; here it is only counted. A proposal's
  // files are drawn as code below the facts.
  const files = filesOf(decision);

  const facts = decision.evidence.filter(
    (fact) => fact.label !== PATCH_LABEL && !files.includes(fact)
  );

  return (
    <>
      {facts.length === 0 ? null : <Facts facts={facts} />}
      {files.map(({ label, value }) => (
        <DraftedCode content={value} heading="h4" key={label} path={label} />
      ))}
    </>
  );
};

/** The way from a `Finish` decision on Today to its answer's diff. */
const FinishLink = ({ decision }: { readonly decision: Decision }) => {
  const files = Option.match(patchOf(decision), {
    onNone: () => "",
    onSome: (patch) => {
      const count = changedFiles(patch).length;

      return ` (${count} ${count === 1 ? "file" : "files"} changed)`;
    },
  });

  return (
    <a
      className="decoration-rule flex w-fit items-center gap-2 text-sm font-medium underline hover:decoration-current"
      href={decisionPath(decision)}
    >
      <FileDiff aria-hidden="true" className="size-4 shrink-0" />
      Read the answer&apos;s diff and finish it{files}
    </a>
  );
};

/** The way from an `OpenProposal` decision to the proposal's page: its draft and files. */
const ProposalLink = ({
  project,
  proposal,
}: {
  readonly project: ProjectName;
  readonly proposal: ProposalId;
}) => (
  <a
    className="decoration-rule flex w-fit items-center gap-2 text-sm font-medium underline hover:decoration-current"
    href={`/${project}/proposals/${proposal}`}
  >
    <FileText aria-hidden="true" className="size-4 shrink-0" />
    Read the proposal
  </a>
);

interface ChoicesProps {
  readonly busy: boolean;
  readonly choose: (choice: Choice) => void;
  readonly decision: Decision;
  readonly subject: string;
}

/** One button per choice; Accept waits, saying why, while `held` says it should. */
const Choices = ({
  busy,
  choose,
  decision,
  held,
  subject,
}: ChoicesProps & { readonly held: Option.Option<string> }) => (
  <fieldset className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
    <legend className="sr-only">Your choice: {subject}</legend>
    {allowedChoices(decision.subject).map((choice) => {
      const isDefault = choice === decision.default;

      const waits = Option.filter(held, () => choice === "accept");

      return (
        <Button
          className="h-11 px-4 text-sm sm:h-9 sm:min-w-28"
          data-choice={choice}
          disabled={busy || Option.isSome(waits)}
          key={choice}
          onClick={() => {
            choose(choice);
          }}
          type="button"
          variant={isDefault ? "outline" : "default"}
        >
          {Option.isSome(waits) ? (
            <>
              <Spinner />
              {waits.value}
            </>
          ) : (
            words[choice]
          )}
          {isDefault ? (
            <span className="text-muted-foreground font-normal">default</span>
          ) : null}
        </Button>
      );
    })}
  </fieldset>
);

/** The choices on a proposal whose draft state was not passed: read from `showProposal`. */
const ProposalChoices = ({
  proposal,
  ...props
}: ChoicesProps & { readonly proposal: ProposalId }) => {
  const read = useLiveDraft(props.decision.project, proposal);

  return <Choices {...props} held={acceptHeld(read)} />;
};

export const DecisionCard = ({
  busy = false,
  children,
  decision,
  draft,
  now,
  onDecide,
  soon = false,
  standalone = false,
}: {
  readonly decision: Decision;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  /** Whether it expires within the day (Today's `expiringSoon`). */
  readonly soon?: boolean;
  /** Whether a choice on it is on its way: its buttons wait. */
  readonly busy?: boolean;
  /** Whether it is shown on its own page, so its title needs no link there. */
  readonly standalone?: boolean;
  /** What its own page shows before the choices: for a finish, the diff. */
  readonly children?: ReactNode;
  /**
   * For an `OpenProposal`, what has been read of the proposal's draft:
   * Accept waits until it is read, and while it is drafting. Read from
   * `showProposal` in the browser when not passed.
   */
  readonly draft?: DraftRead | undefined;
}) => {
  const [note, setNote] = useState("");
  const noteId = useId();
  const subject = describeSubject(decision.subject);
  const Title = standalone ? "h2" : "h3";

  const choose = (choice: Choice) => {
    const written = note.trim();

    const input = {
      choice,
      decision: decision.id,
      project: decision.project,
    };

    onDecide(written.length === 0 ? input : { ...input, note: written });
  };

  return (
    <article
      aria-labelledby={`${noteId}-title`}
      className="flex flex-col gap-3"
      data-decision={decision.id}
      data-project={decision.project}
    >
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-mono">{decision.project}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{decision.id}</span>
        </p>
        <Title
          className="text-lg font-semibold text-balance [overflow-wrap:anywhere]"
          id={`${noteId}-title`}
        >
          {standalone ? (
            subject
          ) : (
            <a
              className="decoration-rule underline-offset-4 hover:underline"
              href={decisionPath(decision)}
            >
              {subject}
            </a>
          )}
        </Title>
      </header>

      <div className="flex flex-col gap-1 text-sm">
        <p
          className={`flex items-start gap-2 ${soon ? "text-waiting font-medium" : "text-muted-foreground"}`}
          data-soon={soon}
        >
          <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Expires <When at={decision.expiresAt} now={now} />
            {soon ? ", within the day" : null}
          </span>
        </p>
        <p className="flex items-start gap-2" data-default={decision.default}>
          <ShieldCheck
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
          <span>{describeDefault(decision)}</span>
        </p>
      </div>

      <Evidence decision={decision} />

      {isFinishDecision(decision) && !standalone ? (
        <FinishLink decision={decision} />
      ) : null}

      {opensAsk(decision.subject) ? (
        <ProposalLink
          project={decision.project}
          proposal={decision.subject.proposal}
        />
      ) : null}

      {children === undefined ? null : (
        <div className="border-rule mt-3 flex flex-col gap-8 border-t pt-6">
          {children}
        </div>
      )}

      <details className="group text-sm">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer py-1 select-none">
          Add a note to your choice
        </summary>
        <label className={`${LABEL} mt-2 block`} htmlFor={noteId}>
          Note, kept with the decision
        </label>
        <Textarea
          className="mt-1 text-sm md:text-sm"
          id={noteId}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          value={note}
        />
      </details>

      {opensAsk(decision.subject) && draft === undefined ? (
        <ProposalChoices
          busy={busy}
          choose={choose}
          decision={decision}
          proposal={decision.subject.proposal}
          subject={subject}
        />
      ) : (
        <Choices
          busy={busy}
          choose={choose}
          decision={decision}
          held={
            draft !== undefined && opensAsk(decision.subject)
              ? acceptHeld(draft)
              : Option.none()
          }
          subject={subject}
        />
      )}
    </article>
  );
};
