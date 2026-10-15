import type { Finish } from "@repo/protocol/contracts";
import type { AnswerReceipt, Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { RequestId } from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";
import { ChevronLeft, ChevronRight, FileDiff, RotateCw } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { ClientDiffs } from "../code/client-code.tsx";
import { DiffStatsFacts, DiffToolbar } from "../code/commit-view.tsx";
import { statsOf } from "../code/diff-model.ts";
import { DiffPane, PANE_SCROLLER } from "../code/diff-pane.tsx";
import type { DiffAnnotation, DiffFileSlot } from "../code/diff-view.tsx";
import { shortSha } from "../code/paths.ts";
import { Choices, DecisionRecord, stuckAtFoot } from "../decision/choices.tsx";
import { DecisionCard, ExpiryLines } from "../decision/decision-card.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import { describeSubject } from "../decision/subject.ts";
import { FactBlock, GateFacts } from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath, INBOX_PATH } from "../shared/paths.ts";
import { GUTTER } from "../shared/shell/gutter.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import type { PlacedRefusal } from "./annotation.tsx";
import { RefusalNote } from "./annotation.tsx";
import type { PatchFile } from "./files.ts";
import { FinishPlainDiff } from "./finish-plain.tsx";
import type { LineNote } from "./finish-plain.tsx";
import { MarkRead } from "./mark-read.tsx";
import { forkOf } from "./patch.ts";
import type { FinishDecision } from "./patch.ts";
import type { MarkedFile } from "./read-marks.ts";

export { patchOf } from "./patch.ts";

export type { FinishDecision } from "./patch.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const WantFacts = ({ ask }: { readonly ask: Ask }) => (
  <FactBlock label="The ask wants">
    <p className="text-want font-normal" data-said="">
      {ask.brief.want}
    </p>
    <AppLink className={`text-ui ${LINK}`} to={askPath(ask.project, ask.id)}>
      The ask <code className="text-mono font-mono">{ask.id}</code>
    </AppLink>
  </FactBlock>
);

const VerdictFacts = ({ verdict }: { readonly verdict: Verdict }) => (
  <FactBlock label={`Verdict at ${shortSha(verdict.head)}`}>
    <div className="flex flex-col gap-2" data-outcome={verdict.outcome._tag}>
      <StatusLine
        subject={{
          kind: "answer",
          outcome: verdict.outcome,
          project: verdict.project,
          stage: verdict.stage,
        }}
      />
    </div>
  </FactBlock>
);

export type FinishInput = typeof Finish.payloadSchema.Type;

export interface FinishViewProps {
  readonly decision: FinishDecision;
  readonly ask?: Ask | undefined;
  readonly verdict?: Verdict | undefined;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly busy?: boolean;
  readonly soon?: boolean;
  readonly files: readonly PatchFile[];
  readonly placed?: readonly PlacedRefusal[];
  readonly newerHead?: CommitSha | undefined;
  readonly read?: ReadonlySet<string>;
  readonly onMark?: (file: MarkedFile, read: boolean) => void;
  readonly split?: boolean;
  readonly onSplit?: (split: boolean) => void;
  readonly folded?: ReadonlySet<string> | undefined;
  readonly onFold?: (path: string, folded: boolean) => void;
  readonly onFoldAll?: (folded: boolean) => void;
  readonly draw?: boolean;
  readonly filesButton?: ReactNode;
  readonly stamp?: boolean;
  readonly failure?: ReactNode;
  /** The answer fork's newest commit; undefined while it is read, none when it could not be. */
  readonly forkHead?: Option.Option<CommitSha> | undefined;
  readonly onReadFork?: (() => void) | undefined;
  readonly onFinish?: ((input: FinishInput) => void) | undefined;
  readonly finishing?: boolean;
  readonly finished?: AnswerReceipt | undefined;
  readonly finishFailure?: ReactNode;
}

const NO_FILES: ReadonlySet<string> = new Set();

const NO_REFUSALS: readonly PlacedRefusal[] = [];

const NO_CHANGED: readonly ChangedFile[] = [];

const slotOf = (
  path: string,
  header: ReactNode,
  refused: ReadonlySet<string>,
  read: ReadonlySet<string>
): DiffFileSlot => {
  if (refused.has(path)) {
    return { header, path, status: "refused" };
  }

  return read.has(path) ? { header, path, status: "read" } : { header, path };
};

const refusalNotes = (placed: readonly PlacedRefusal[]): readonly LineNote[] =>
  placed.map((each) => ({
    line: each.line,
    node: <RefusalNote placed={each} />,
    path: each.path,
  }));

const NewerHead = ({ head }: { readonly head: CommitSha }) => (
  <output
    className={`border-rule bg-surface flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-2 ${GUTTER}`}
    data-newer-head={head}
  >
    <p className="text-ui">
      A new answer was pushed, at{" "}
      <code className="text-mono font-mono">{shortSha(head)}</code>. This diff
      is the one the decision names.
    </p>
    <Button
      onClick={() => {
        globalThis.location.reload();
      }}
      size="sm"
      variant="outline"
    >
      <RotateCw aria-hidden="true" strokeWidth={1.75} />
      Reload the diff
    </Button>
  </output>
);

const DecisionBar = ({
  busy,
  decision,
  now,
  onDecide,
  soon,
  stamp,
}: {
  readonly decision: FinishDecision;
  readonly busy: boolean;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly soon: boolean;
  readonly stamp: boolean;
}) => (
  <section
    aria-label="Your choice"
    className="border-rule bg-background flex shrink-0 flex-wrap items-start gap-x-6 gap-y-2 border-t px-4 py-3"
    data-decision-bar=""
  >
    {decision.decided === undefined ? (
      <>
        <div className="min-w-0 flex-1 basis-56">
          <ExpiryLines decision={decision} now={now} soon={soon} />
        </div>
        <div className="max-w-[34rem] min-w-0 flex-[2] basis-80">
          <Choices
            busy={busy}
            decision={decision}
            onChoose={(choice) => {
              onDecide({
                choice,
                decision: decision.id,
                project: decision.project,
              });
            }}
          />
        </div>
      </>
    ) : (
      <DecisionRecord
        decided={decision.decided}
        decision={decision}
        now={now}
        stamp={stamp}
      />
    )}
  </section>
);

const Failure = ({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <div aria-live="polite" className={`empty:hidden ${className}`}>
    {children}
  </div>
);

const OneFileAtATime = ({
  files,
  notes,
  onMark,
  read,
}: {
  readonly files: readonly PatchFile[];
  readonly notes: readonly LineNote[];
  readonly read: ReadonlySet<string>;
  readonly onMark?: ((file: MarkedFile, read: boolean) => void) | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const file = files[at];

  if (!open || file === undefined) {
    return (
      <Button
        className="h-11 w-full"
        disabled={files.length === 0}
        onClick={() => {
          setOpen(true);
        }}
        variant="outline"
      >
        <FileDiff aria-hidden="true" strokeWidth={1.75} />
        Read the diff ({files.length} {files.length === 1 ? "file" : "files"})
      </Button>
    );
  }

  return (
    <section
      aria-label="The diff, one file at a time"
      className="-mx-4 flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-2">
        <Button
          className="h-11"
          disabled={at === 0}
          onClick={() => {
            setAt(at - 1);
          }}
          variant="outline"
        >
          <ChevronLeft aria-hidden="true" strokeWidth={1.75} />
          Previous file
        </Button>
        <p className="text-label text-muted-foreground tabular-nums">
          {at + 1} of {files.length}
        </p>
        <Button
          className="h-11"
          disabled={at === files.length - 1}
          onClick={() => {
            setAt(at + 1);
          }}
          variant="outline"
        >
          Next file
          <ChevronRight aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </div>
      <FinishPlainDiff
        files={[file]}
        folded={NO_FILES}
        notes={notes}
        onMark={onMark}
        read={read}
      />
    </section>
  );
};

const WideDiff = ({
  busy,
  decision,
  draw,
  failure,
  files,
  folded,
  newerHead,
  now,
  onDecide,
  onFold,
  onMark,
  placed,
  read,
  soon,
  split,
  stamp,
}: Required<
  Pick<
    FinishViewProps,
    | "busy"
    | "decision"
    | "draw"
    | "files"
    | "now"
    | "onDecide"
    | "placed"
    | "read"
    | "soon"
    | "split"
    | "stamp"
  >
> &
  Pick<
    FinishViewProps,
    "failure" | "folded" | "newerHead" | "onFold" | "onMark"
  >) => {
  const refused = new Set(placed.map(({ path }) => path));

  const plain = (
    <div className={PANE_SCROLLER}>
      <FinishPlainDiff
        files={files}
        folded={folded}
        notes={refusalNotes(placed)}
        onFold={onFold}
        onMark={onMark}
        read={read}
        refused={refused}
      />
    </div>
  );

  const annotations = placed.map((each): DiffAnnotation => ({
    line: each.line,
    path: each.path,
    render: () => <RefusalNote placed={each} />,
    side: "additions",
  }));

  const slots = files.map((each) =>
    slotOf(
      each.file.path,
      <MarkRead file={each} onMark={onMark} read={read.has(each.file.path)} />,
      refused,
      read
    )
  );

  return (
    <div className="tablet:contents hidden">
      <Failure className={`py-3 ${GUTTER}`}>{failure}</Failure>
      {newerHead === undefined ? null : <NewerHead head={newerHead} />}
      <DiffPane>
        {draw ? (
          <ClientDiffs
            annotations={annotations}
            drawn={files}
            fallback={plain}
            files={NO_CHANGED}
            folded={folded}
            onFold={onFold}
            slots={slots}
            split={split}
          />
        ) : (
          plain
        )}
        <DecisionBar
          busy={busy}
          decision={decision}
          now={now}
          onDecide={onDecide}
          soon={soon}
          stamp={stamp}
        />
      </DiffPane>
    </div>
  );
};

const PhoneFinish = ({
  ask,
  busy,
  decision,
  failure,
  files,
  newerHead,
  now,
  onDecide,
  onMark,
  placed,
  read,
  soon,
  stamp,
  verdict,
}: Required<
  Pick<
    FinishViewProps,
    | "busy"
    | "decision"
    | "files"
    | "now"
    | "onDecide"
    | "placed"
    | "read"
    | "soon"
    | "stamp"
  >
> &
  Pick<
    FinishViewProps,
    "ask" | "failure" | "newerHead" | "onMark" | "verdict"
  >) => (
  <div className={`tablet:hidden flex flex-col gap-6 ${GUTTER}`}>
    {ask === undefined ? null : (
      <p className="text-want max-w-(--measure)" data-said="">
        {ask.brief.want}
      </p>
    )}
    {verdict === undefined ? null : (
      <div data-outcome={verdict.outcome._tag}>
        <StatusLine
          subject={{
            kind: "answer",
            outcome: verdict.outcome,
            project: verdict.project,
            stage: verdict.stage,
          }}
        />
      </div>
    )}
    {newerHead === undefined ? null : <NewerHead head={newerHead} />}
    <Failure>{failure}</Failure>
    <DecisionCard
      busy={busy}
      choices={stuckAtFoot}
      decision={decision}
      finishLink={false}
      now={now}
      onDecide={onDecide}
      soon={soon}
      stamp={stamp}
    />
    {files.length === 0 ? null : (
      <OneFileAtATime
        files={files}
        notes={refusalNotes(placed)}
        onMark={onMark}
        read={read}
      />
    )}
  </div>
);

const ForkHeadLine = ({
  answer,
  forkHead,
}: {
  readonly answer: CommitSha;
  readonly forkHead: Option.Option<CommitSha> | undefined;
}) => {
  if (forkHead === undefined) {
    return (
      <p className="text-ui text-muted-foreground">
        Reading the fork&apos;s head…
      </p>
    );
  }

  if (Option.isNone(forkHead)) {
    return (
      <p className="text-ui text-muted-foreground">
        The fork&apos;s head could not be read.
      </p>
    );
  }

  const head = forkHead.value;

  return head === answer ? (
    <p className="text-ui text-muted-foreground" data-fork-head={head}>
      Nothing is on top of the answer yet: the fork&apos;s head is still{" "}
      <code className="text-mono font-mono">{shortSha(head)}</code>.
    </p>
  ) : (
    <p className="text-ui" data-fork-head={head}>
      The fork&apos;s head is{" "}
      <code className="text-mono font-mono">{shortSha(head)}</code>, on top of
      the answer.
    </p>
  );
};

/** A head on top of the answer's, with the verdict's base to finish from. */
export const finishInput = (
  decision: FinishDecision,
  verdict: Verdict | undefined,
  forkHead: Option.Option<CommitSha> | undefined
): Option.Option<FinishInput> =>
  Option.flatMap(
    Option.filter(
      Option.flatten(Option.fromUndefinedOr(forkHead)),
      (head) => head !== decision.subject.head
    ),
    (head) =>
      Option.map(Option.fromUndefinedOr(verdict), ({ base }) => ({
        ask: decision.subject.ask,
        base,
        head,
        project: decision.project,
        requestId: RequestId.make(`finish-${head}`),
      }))
  );

const FinishItFacts = ({
  decision,
  finishFailure,
  finished,
  finishing = false,
  forkHead,
  onFinish,
  onReadFork,
  verdict,
}: Pick<
  FinishViewProps,
  | "decision"
  | "finishFailure"
  | "finished"
  | "finishing"
  | "forkHead"
  | "onFinish"
  | "onReadFork"
  | "verdict"
>) => {
  const fork = forkOf(decision);
  const input = finishInput(decision, verdict, forkHead);

  return (
    <FactBlock label="Finish it">
      <p className="text-ui">
        To finish it with your own changes, push your commits onto the
        answer&apos;s fork, on top of its head, then finish it here. They are
        checked again, and you are credited as Finished-by.
      </p>
      {Option.isSome(fork) ? (
        <p className="text-ui text-muted-foreground">
          The fork:{" "}
          <code className="text-mono text-foreground font-mono [overflow-wrap:anywhere]">
            {fork.value}
          </code>
        </p>
      ) : null}
      <ForkHeadLine answer={decision.subject.head} forkHead={forkHead} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-action="finish"
          disabled={finishing || onFinish === undefined || Option.isNone(input)}
          onClick={() => {
            if (Option.isSome(input)) {
              onFinish?.(input.value);
            }
          }}
          size="sm"
        >
          Finish with these commits
        </Button>
        {onReadFork === undefined ? null : (
          <Button onClick={onReadFork} size="sm" variant="outline">
            <RotateCw aria-hidden="true" strokeWidth={1.75} />
            Read the fork again
          </Button>
        )}
      </div>
      {finished === undefined ? null : (
        <div data-finished={finished.head}>
          <StatusLine
            subject={{
              kind: "answer",
              outcome: finished.outcome,
              project: finished.project,
            }}
          />
        </div>
      )}
      <Failure>{finishFailure}</Failure>
      <p className="text-ui text-muted-foreground">
        To land the answer as it is, accept the decision instead.
      </p>
    </FactBlock>
  );
};

const FinishFacts = ({
  ask,
  busy,
  decision,
  files,
  now,
  onDecide,
  soon,
  stamp,
  verdict,
  ...finish
}: Required<
  Pick<
    FinishViewProps,
    "busy" | "decision" | "files" | "now" | "onDecide" | "soon" | "stamp"
  >
> &
  Pick<
    FinishViewProps,
    | "ask"
    | "finishFailure"
    | "finished"
    | "finishing"
    | "forkHead"
    | "onFinish"
    | "onReadFork"
    | "verdict"
  >) => (
  <>
    {ask === undefined ? null : <WantFacts ask={ask} />}
    {verdict === undefined ? null : <VerdictFacts verdict={verdict} />}
    {verdict === undefined ? null : (
      <GateFacts
        holds={{ decided: false, heldBack: verdict.heldBack.length > 0 }}
        outcome={verdict.outcome}
        stage={verdict.stage}
      />
    )}
    <FactBlock label="Decision">
      <DecisionCard
        busy={busy}
        decision={decision}
        finishLink={false}
        layout="stack"
        now={now}
        onDecide={onDecide}
        soon={soon}
        stamp={stamp}
      />
    </FactBlock>
    {decision.decided === undefined ? (
      <FinishItFacts {...finish} decision={decision} verdict={verdict} />
    ) : null}
    {files.length === 0 ? null : (
      <DiffStatsFacts stats={statsOf(files, ask?.territory.paths ?? [])} />
    )}
  </>
);

export const FinishView = ({
  busy = false,
  draw = false,
  placed = NO_REFUSALS,
  read = NO_FILES,
  soon = false,
  split = false,
  stamp = false,
  ...props
}: FinishViewProps) => {
  const { ask, decision, files, folded, now } = props;
  const stats = statsOf(files, ask?.territory.paths ?? []);
  const readCount = files.filter(({ file }) => read.has(file.path)).length;

  const subject = {
    decision,
    kind: "decision",
    now,
    viewerDecides: true,
  } as const;

  const allFolded =
    files.length > 0 &&
    files.every((file) =>
      folded === undefined ? file.folded : folded.has(file.file.path)
    );

  const shared = { busy, placed, read, soon, stamp };

  return (
    <Workspace
      crumbs={[
        { label: decision.project, to: `/${decision.project}` },
        { label: "Inbox", to: INBOX_PATH },
        { label: decision.id, mono: true },
      ]}
      facts={<FinishFacts {...props} {...shared} />}
      factsHeading="This finish"
      meta={
        <>
          {decision.project} · finish ·{" "}
          <code className="text-mono font-mono">{decision.id}</code>
        </>
      }
      state={<StatusLine compact subject={subject} />}
      status={<StatusLine subject={subject} />}
      title={describeSubject(decision.subject)}
      toolbar={
        files.length === 0 ? undefined : (
          <>
            <DiffToolbar
              allFolded={allFolded}
              files={props.filesButton}
              onFoldAll={props.onFoldAll}
              onSplit={props.onSplit}
              split={split}
              stats={stats}
            />
            <p
              className="text-ui text-muted-foreground tablet:block hidden shrink-0 tabular-nums"
              data-read-count={readCount}
            >
              {readCount} of {files.length}{" "}
              {files.length === 1 ? "file" : "files"} read
            </p>
          </>
        )
      }
      variant="code"
    >
      <PhoneFinish {...props} {...shared} />
      {files.length === 0 ? (
        <p
          className={`text-ui text-muted-foreground tablet:block hidden ${GUTTER}`}
        >
          This decision carries no diff: read the answer&apos;s head on its
          fork.
        </p>
      ) : (
        <WideDiff {...props} {...shared} draw={draw} split={split} />
      )}
    </Workspace>
  );
};
