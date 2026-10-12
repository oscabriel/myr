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
 * The platform's `DRAFT_ROUNDS`, which the web's production code does not
 * import; `test/proposal.test.tsx` holds the two equal.
 */
export const DRAFT_ATTEMPTS = 3;

const NOTE_LIMIT = 2000;

export const standing = (proposal: Proposal) =>
  proposal.state === "open" && proposal.draft !== undefined
    ? proposal.draft._tag
    : proposal.state;

const draftingNow = DraftState.isAnyOf(["Drafting"]);

const failedNow = DraftState.isAnyOf(["Failed"]);

export const isDrafting = (proposal: Proposal) =>
  proposal.draft !== undefined && draftingNow(proposal.draft);

const refusalKinds = groups.flatMap(({ members }) => [...members]);

/**
 * A draft keeps only the tag, so a refusal that needs fields of its own cannot
 * be drawn whole.
 */
export const refusalOfTag = (tag: string): Option.Option<Refusal> =>
  Arr.findFirst(refusalKinds, (kind) => kind.identifier === tag).pipe(
    Option.flatMap((kind): Option.Option<Refusal> =>
      // SAFETY: `makeOption` checks its input at run time, so a refusal whose fields all have defaults is made and one that needs a field answers None.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a loop over the union's members cannot name each member's input; see SAFETY.
      kind.makeOption({} as never)
    )
  );

const isAskFile = ({ path }: ConfigFile) =>
  path.startsWith(`${Brand.configDir}/`) || path.endsWith(".ask.ts");

const filesInOrder = (files: readonly ConfigFile[]) => {
  const askFile = files.find(isAskFile);
  const rest = files.filter((file) => file !== askFile);
  const checks = rest.filter(({ path }) => isTestPath(path));
  const others = rest.filter(({ path }) => !isTestPath(path));

  return { askFile, checks, others };
};

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

const roundLine = (draft: DraftState) =>
  DraftState.match(draft, {
    Drafting: ({ round }) => `Round ${round}, drafting now`,
    Failed: ({ attempts, round }) =>
      `Round ${round} failed after ${attempts} of ${DRAFT_ATTEMPTS} attempts`,
    Ready: ({ attempts, round }) =>
      `Round ${round} ready after ${attempts} of ${DRAFT_ATTEMPTS} attempts`,
  });

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
            unless a maintainer opens it
          </span>
        </dd>
        <dt className="text-label text-muted-foreground pt-0.5">State</dt>
        <dd
          className="first-letter:uppercase"
          data-standing={standing(proposal)}
        >
          {proposal.state}
        </dd>
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
        A want alone: no ask file or check yet. A maintainer who accepts it
        writes the change it asks for.
      </p>
    ) : null;
  }

  return (
    <>
      {kept ? (
        <p className="text-ui text-muted-foreground" data-kept="">
          An earlier round&apos;s ready draft, which a maintainer can still
          accept: it runs red first again on main before the ask opens.
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
  readonly files: readonly ConfigFile[];
  readonly decision: Option.Option<DecisionId>;
  readonly mayRedraft: boolean;
  readonly onRedraft?: (note: string | undefined) => void;
  readonly busy?: boolean;
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
