/**
 * One proposal, as its proposer and its deciders follow it. The title is
 * its want; under it, where the platform's draft stands in the outcome's
 * words: drafting (the checking role), ready and waiting for a decider (the
 * waiting role), or a failed round, drawn by `RefusalView` when the round
 * failed with a refusal the page can draw whole, else as an ink line. Then
 * the draft read as a guide, in the order it was made: the ask file (its
 * want, territory and kind as rows, its source behind a disclosure), the
 * check (its source), and red first (the run that failed twice the same
 * way, its assertion once).
 *
 * "Let the platform's agent draft it" (or "Draft again"), with a note for
 * the agent, is the proposer's or a decider's while the proposal is open
 * and not drafting; a decider also gets the way to the decision that would
 * open the ask. The inspector holds who proposed it, when it expires, the
 * decision, and the draft's round.
 *
 * Nothing here edits the drafted files: a member proposes again, or a
 * decider sends the draft back with a note.
 */
import { Brand } from "@repo/brand";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { groups } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Array as Arr, DateTime, Option } from "effect";
import { constVoid } from "effect/Function";
import { ChevronDown, Scale, X } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { isTestPath } from "../code/diff-model.ts";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { decisionPath } from "../shared/paths.ts";
import { RefusalView } from "../shared/refusal.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import { When } from "../shared/time.tsx";
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

/** Every refusal of the union, to find one by the tag a failed draft kept. */
const refusalKinds = groups.flatMap(({ members }) => [...members]);

/**
 * The refusal a failed round ended with, when its tag alone makes one: a
 * draft keeps only the tag, so a refusal that needs fields of its own
 * cannot be drawn whole, and is said in words instead.
 */
export const refusalOfTag = (tag: string): Option.Option<Refusal> =>
  Arr.findFirst(refusalKinds, (kind) => kind.identifier === tag).pipe(
    Option.flatMap((kind): Option.Option<Refusal> =>
      // SAFETY: `makeOption` checks its input at run time, so a refusal whose fields all have defaults is made and one that needs a field answers None.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a loop over the union's members cannot name each member's input; see SAFETY.
      kind.makeOption({} as never)
    )
  );

/** Whether a drafted file is the ask file: under the config folder, or named as one. */
const isAskFile = ({ path }: ConfigFile) =>
  path.startsWith(`${Brand.configDir}/`) || path.endsWith(".ask.ts");

/** The draft's files in the order it made them: the ask file, the check, then what the check reads. */
const filesInOrder = (files: readonly ConfigFile[]) => {
  const askFile = files.find(isAskFile);
  const rest = files.filter((file) => file !== askFile);
  const checks = rest.filter(({ path }) => isTestPath(path));
  const others = rest.filter(({ path }) => !isTestPath(path));

  return { askFile, checks, others };
};

/** The kind an ask file names (`kinds.fix`), when it names one plainly. */
const kindIn = (source: string) =>
  /\bkinds\.(?<kind>[A-Za-z]+)/u.exec(source)?.groups?.kind;

const Step = ({
  children,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) => (
  <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
    <h2 className="text-title" id={id}>
      {title}
    </h2>
    {children}
  </section>
);

const Row = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <div className="contents">
    <dt className="text-label text-muted-foreground pt-0.5">{label}</dt>
    <dd className="text-ui min-w-0 [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

/** The ask file: what it states, then its source behind a disclosure. */
const AskFileStep = ({
  file,
  proposal,
}: {
  readonly file: ConfigFile | undefined;
  readonly proposal: Proposal;
}) => {
  const kind = file === undefined ? undefined : kindIn(file.content);

  return (
    <Step id={`${proposal.id}-ask-file`} title="The ask file">
      <dl className="tablet:grid-cols-[7rem_1fr] grid grid-cols-1 gap-x-4 gap-y-1.5">
        <Row label="Want">{proposal.want}</Row>
        {proposal.territory === undefined ? null : (
          <Row label="Territory">
            <code className="text-mono font-mono">{proposal.territory}</code>
          </Row>
        )}
        {kind === undefined ? null : (
          <Row label="Kind">
            <code className="text-mono font-mono">{kind}</code>
          </Row>
        )}
      </dl>
      {file === undefined ? null : (
        <details className="group">
          <summary className="text-ui text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            Its source, <code className="text-mono font-mono">{file.path}</code>
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 transition-transform duration-150 group-open:rotate-180"
              strokeWidth={1.75}
            />
          </summary>
          <div className="mt-2">
            <DraftedCode content={file.content} path={file.path} />
          </div>
        </details>
      )}
    </Step>
  );
};

/** Red first: the run that failed twice the same way on main, its assertion once. */
const RedFirst = ({ draft }: { readonly draft: DraftState }) =>
  DraftState.match(draft, {
    Drafting: () => null,
    Failed: () => null,
    Ready: ({ attempts, model, red }) => (
      <Step id="red-first" title="Red first">
        <p className="text-ui">
          The check ran on main and fails twice the same way in lane {red.lane}:{" "}
          <span className="sr-only">{red.signature}</span>
        </p>
        <samp
          aria-hidden="true"
          className="border-rule bg-surface text-mono leading-terminal block border px-3 py-2 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {red.signature}
        </samp>
        <p className="text-label text-muted-foreground font-normal">
          drafted by {model}, attempt {attempts} of {DRAFT_ATTEMPTS}
        </p>
      </Step>
    ),
  });

/** A round that failed: the refusal whole when the page can draw it, else in words, in ink. */
const FailedRound = ({ draft }: { readonly draft: DraftState }) =>
  DraftState.match(draft, {
    Drafting: () => null,
    Failed: ({ attempts, model, refusal, round }) =>
      Option.match(refusalOfTag(refusal), {
        onNone: () => (
          <p className="text-want flex items-start gap-2" data-draft="Failed">
            <X
              aria-hidden="true"
              className="mt-1 size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span>
              <strong className="font-semibold">The draft failed:</strong>{" "}
              <code className="text-mono font-mono">{refusal}</code>, in round{" "}
              {round}, after {attempts} of {DRAFT_ATTEMPTS} attempts by {model}.
            </span>
          </p>
        ),
        onSome: (made) => (
          <div className="flex flex-col gap-2" data-draft="Failed">
            <p className="text-ui text-muted-foreground">
              Round {round} failed after {attempts} of {DRAFT_ATTEMPTS} attempts
              by {model}, with:
            </p>
            <RefusalView refusals={[made]} />
          </div>
        ),
      }),
    Ready: () => null,
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
      <details className="group">
        <summary className="text-ui text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 select-none [&::-webkit-details-marker]:hidden">
          Add a note for the agent
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform duration-150 group-open:rotate-180"
            strokeWidth={1.75}
          />
        </summary>
        <label
          className="text-label text-muted-foreground mt-2 block"
          htmlFor={noteId}
        >
          What the next draft should do differently
        </label>
        <Textarea
          className="tablet:text-ui mt-1 text-base"
          id={noteId}
          maxLength={NOTE_LIMIT}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          value={note}
        />
      </details>
      <Button
        className="tablet:h-9 tablet:w-fit h-11 w-full px-4"
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
  <AppLink
    className="text-ui decoration-rule flex w-fit items-center gap-2 font-medium underline hover:decoration-current"
    data-decision={decision}
    to={decisionPath(project, decision)}
  >
    <Scale aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
    Decide it: {decision}
  </AppLink>
);

/** The draft's round, in a line: its number and where it stands. */
const roundLine = (draft: DraftState) =>
  DraftState.match(draft, {
    Drafting: ({ round }) => `Round ${round}, drafting now`,
    Failed: ({ attempts, round }) =>
      `Round ${round} failed after ${attempts} of ${DRAFT_ATTEMPTS} attempts`,
    Ready: ({ attempts, round }) =>
      `Round ${round} ready after ${attempts} of ${DRAFT_ATTEMPTS} attempts`,
  });

/** The inspector's facts: who proposed it, when it expires, its decision, the draft's round. */
const ProposalFacts = ({
  decision,
  now,
  project,
  proposal,
}: {
  readonly decision: Option.Option<DecisionId>;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly proposal: Proposal;
}) => (
  <>
    <FactBlock label="Proposal">
      <dl className="text-ui grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-label text-muted-foreground pt-0.5">Proposed by</dt>
        <dd>
          <HandleLink handle={proposal.proposer} />{" "}
          <span className="text-muted-foreground">
            <When at={proposal.openedAt} now={now} />
          </span>
        </dd>
        <dt className="text-label text-muted-foreground pt-0.5">Expires</dt>
        <dd>
          <When at={proposal.expiresAt} now={now} />
          <span className="text-muted-foreground">
            {" "}
            unless a decider opens it
          </span>
        </dd>
        <dt className="text-label text-muted-foreground pt-0.5">State</dt>
        <dd data-standing={standing(proposal)}>{proposal.state}</dd>
      </dl>
    </FactBlock>
    {Option.isSome(decision) ? (
      <FactBlock label="Decision">
        <DecisionLink decision={decision.value} project={project} />
      </FactBlock>
    ) : null}
    {proposal.draft === undefined ? null : (
      <FactBlock label="Drafting">
        <p className="text-ui">{roundLine(proposal.draft)}</p>
      </FactBlock>
    )}
  </>
);

/** Where the proposal stands, under its title: the status line, or a failed round; then what drafting means and its note. */
const ProposalStatus = ({ proposal }: { readonly proposal: Proposal }) => {
  const { draft } = proposal;
  const drafting = draft !== undefined && draftingNow(draft);

  return (
    <div
      className="flex flex-col gap-3"
      data-draft={draft?._tag}
      data-proposal={proposal.id}
      data-standing={standing(proposal)}
    >
      {draft !== undefined && failedNow(draft) && proposal.state === "open" ? (
        <FailedRound draft={draft} />
      ) : (
        <StatusLine subject={{ kind: "proposal", proposal }} />
      )}
      {drafting ? (
        <p className="text-ui text-muted-foreground max-w-[70ch]">
          The platform&apos;s agent is writing the ask and a check, then running
          the check on main, where it must fail twice the same way. This takes a
          few minutes; the page follows it.
        </p>
      ) : null}
      {drafting && draft.note !== undefined ? (
        <p
          className="text-ui [overflow-wrap:anywhere] whitespace-pre-line"
          data-note=""
        >
          <span className="text-label text-muted-foreground">Note:</span>{" "}
          {draft.note}
        </p>
      ) : null}
    </div>
  );
};

/** The draft as a guide, in the order it was made; a want alone says so. */
const DraftGuide = ({
  files,
  proposal,
}: {
  readonly files: readonly ConfigFile[];
  readonly proposal: Proposal;
}) => {
  const { askFile, checks, others } = filesInOrder(files);
  const kept = proposal.draft !== undefined && failedNow(proposal.draft);

  if (files.length === 0) {
    return proposal.draft === undefined ? (
      <p className="text-body max-w-[70ch]">
        A want alone: no ask file or check yet. A decider who accepts it writes
        the change it asks for.
      </p>
    ) : null;
  }

  return (
    <>
      {kept ? (
        <p className="text-ui text-muted-foreground" data-kept="">
          An earlier round&apos;s ready draft, which a decider can still accept:
          it runs red first again on main before the ask opens.
        </p>
      ) : null}
      <AskFileStep file={askFile} proposal={proposal} />
      {checks.length === 0 ? null : (
        <Step id={`${proposal.id}-check`} title="The check">
          {[...checks, ...others].map(({ content, path }) => (
            <DraftedCode content={content} key={path} path={path} />
          ))}
        </Step>
      )}
      {proposal.draft === undefined ? null : (
        <RedFirst draft={proposal.draft} />
      )}
    </>
  );
};

export const ProposalView = ({
  busy = false,
  children,
  decision,
  files,
  mayRedraft,
  now = DateTime.nowUnsafe(),
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
  readonly now?: DateTime.Utc;
}): ReactNode => {
  const open = proposal.state === "open";

  return (
    <Workspace
      crumbs={[
        { label: project, to: `/${project}` },
        { label: "Proposals" },
        { label: proposal.id, mono: true },
      ]}
      facts={
        <ProposalFacts
          decision={decision}
          now={now}
          project={project}
          proposal={proposal}
        />
      }
      factsHeading="This proposal"
      meta={
        <>
          proposed by <HandleLink handle={proposal.proposer} /> ·{" "}
          <code className="text-mono font-mono">{proposal.id}</code>
        </>
      }
      state={<StatusLine compact subject={{ kind: "proposal", proposal }} />}
      status={<ProposalStatus proposal={proposal} />}
      said
      title={proposal.want}
    >
      {Option.isSome(decision) && open ? (
        <DecisionLink decision={decision.value} project={project} />
      ) : null}
      <DraftGuide files={files} proposal={proposal} />
      {children}
      {mayRedraft && open && !isDrafting(proposal) ? (
        <Redraft
          again={proposal.draft !== undefined}
          busy={busy}
          onRedraft={onRedraft}
        />
      ) : null}
    </Workspace>
  );
};
