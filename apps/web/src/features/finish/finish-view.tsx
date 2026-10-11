/**
 * A `Finish` decision's page: the one page where a decider reads an
 * answer's diff, laid out as the code browser is. The changed files sit in
 * the rail (territory first, then tests, then the rest); the diff fills
 * main, file by file under sticky headers, each with a "Mark read" button,
 * and a refusal from an earlier round sits under the line it pointed at.
 * The want, the verdict, the choices and the three lines that finish it
 * from a clone sit in the inspector from 1440 px; below that, the choices
 * stay in a bar at the foot of the diff. On a phone the page reads the
 * want, the verdict and the choices first, then the diff one file at a
 * time.
 *
 * The read marks are this browser's alone (`read-marks.ts`). A head pushed
 * to the answer while the page is open says so above the diff, and the
 * diff stays as it was until the reader reloads it.
 *
 * What the page reads from the decision's evidence: `patch`, the answer's
 * unified diff, and `fork`, the name of the answer's fork
 * (`<key>--<ask>--<handle>`), where a finish fetches the head and pushes
 * its commits. Without a patch the page shows the lines and no diff;
 * without a fork it names the fork by the claim fork's pattern and leaves
 * the answerer's handle for the decider to fill in. The web never calls
 * `finish` itself.
 */
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ChangedFile } from "@repo/protocol/domain/code";
import type { CommitSha } from "@repo/protocol/ids";
import { Array as Arr, Option } from "effect";
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
import {
  Choices,
  DecisionRecord,
  stuckAboveBar,
} from "../decision/choices.tsx";
import { DecisionCard, ExpiryLines } from "../decision/decision-card.tsx";
import type { DecideInput } from "../decision/decision-card.tsx";
import { describeSubject } from "../decision/subject.ts";
import { CommandLine } from "../shared/command.tsx";
import { FactBlock, GateFacts } from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath } from "../shared/paths.ts";
import { GUTTER, Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import type { PlacedRefusal } from "./annotation.tsx";
import { RefusalNote } from "./annotation.tsx";
import type { PatchFile } from "./files.ts";
import { FinishPlainDiff } from "./finish-plain.tsx";
import type { LineNote } from "./finish-plain.tsx";
import { MarkRead } from "./mark-read.tsx";
import { FORK_LABEL } from "./patch.ts";
import type { FinishDecision } from "./patch.ts";
import type { MarkedFile } from "./read-marks.ts";

export { patchOf } from "./patch.ts";

export type { FinishDecision } from "./patch.ts";

const LINK = "decoration-rule underline hover:decoration-current";

/** Where the answer's head lives: its fork's git URL on the platform. */
const remoteOf = (decision: FinishDecision, platformUrl: string) =>
  Arr.findFirst(decision.evidence, ({ label }) => label === FORK_LABEL).pipe(
    Option.map(
      ({ href, value }) => href ?? `${platformUrl}/${value.trim()}.git`
    ),
    Option.getOrElse(
      () =>
        `${platformUrl}/${decision.project}--${decision.subject.ask}--<answerer>.git`
    )
  );

/** The three lines that take the answer's head into a clone, put the decider's commits on it, and finish it. */
export const finishLines = (
  decision: FinishDecision,
  platformUrl: string,
  verdict: Verdict | undefined
) => {
  const remote = remoteOf(decision, platformUrl);
  const { ask, head } = decision.subject;
  const base = verdict?.base ?? "<base>";

  return [
    {
      command: `git fetch ${remote} ${head} && git switch --detach FETCH_HEAD`,
      label: "Fetch the answer's head and stand on it",
    },
    {
      command: `git push ${remote} HEAD:main`,
      label: "Commit your changes on top, then push them onto its fork",
    },
    {
      command: `${Brand.cli} finish ${ask} --project ${decision.project} --base ${base} --head $(git rev-parse HEAD) --requestId finish-$(git rev-parse HEAD) --yes`,
      label: "Hand the finish to the gate: it lands with you as Finished-by",
    },
  ] as const;
};

/** The three finish lines, numbered, each under what it does. */
const FinishLines = ({
  decision,
  platformUrl,
  verdict,
}: {
  readonly decision: FinishDecision;
  readonly platformUrl: string;
  readonly verdict: Verdict | undefined;
}) => (
  <FactBlock label="Finish it from your clone">
    <ol className="flex flex-col gap-3" data-finish-lines="">
      {finishLines(decision, platformUrl, verdict).map(({ command, label }) => (
        <li className="flex min-w-0 flex-col gap-1" key={command}>
          <p className="text-label text-muted-foreground font-normal">
            {label}
          </p>
          <CommandLine command={command} numbered />
        </li>
      ))}
    </ol>
    <p className="text-ui text-muted-foreground">
      To land the answer as it is, accept the decision instead.
    </p>
  </FactBlock>
);

/** What the ask wants, in one paragraph, and the way to it. */
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

/** The verdict on the head: its line, and the gate's stages in a strip. */
const VerdictFacts = ({ verdict }: { readonly verdict: Verdict }) => (
  <FactBlock label={`Verdict at ${shortSha(verdict.head)}`}>
    <div className="flex flex-col gap-2" data-outcome={verdict.outcome._tag}>
      <StatusLine
        command={false}
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

export interface FinishViewProps {
  readonly decision: FinishDecision;
  readonly ask?: Ask | undefined;
  readonly verdict?: Verdict | undefined;
  readonly platformUrl: string;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly busy?: boolean;
  readonly soon?: boolean;
  /** The diff's files, territory first (`patchFiles`); none without a patch. */
  readonly files: readonly PatchFile[];
  /** Refusals from the answer's rounds that point into its files. */
  readonly placed?: readonly PlacedRefusal[];
  /** The head last pushed to the answer, when it is not the one decided on. */
  readonly newerHead?: CommitSha | undefined;
  /** The files this reader marked read. */
  readonly read?: ReadonlySet<string>;
  readonly onMark?: (file: MarkedFile, read: boolean) => void;
  readonly split?: boolean;
  readonly onSplit?: (split: boolean) => void;
  readonly folded?: ReadonlySet<string> | undefined;
  readonly onFold?: (path: string, folded: boolean) => void;
  readonly onFoldAll?: (folded: boolean) => void;
  /** Draw the diff in the browser over the plain text (the page does; a test reads the plain text). */
  readonly draw?: boolean;
  /** The Files button, below the shell's width. */
  readonly filesButton?: ReactNode;
  /** Settle the record's mark: the choice was taken while the page was open. */
  readonly stamp?: boolean;
  /** What the reader's last choice came back with, when it failed. */
  readonly failure?: ReactNode;
}

const NO_FILES: ReadonlySet<string> = new Set();

const NO_REFUSALS: readonly PlacedRefusal[] = [];

/** No whole files: a decision's diff comes parsed from its patch. */
const NO_CHANGED: readonly ChangedFile[] = [];

/** A file's state in its header: a refusal pointed into it, or this reader read it. */
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

/** The refusals among `placed`, as notes under their lines. */
const refusalNotes = (placed: readonly PlacedRefusal[]): readonly LineNote[] =>
  placed.map((each) => ({
    line: each.line,
    node: <RefusalNote placed={each} />,
    path: each.path,
  }));

/** A head pushed after the one the decision names: said above the diff, never swapped in. */
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

/**
 * The choices kept at the foot of the diff below 1440 px, where the
 * inspector is a sheet; once taken, the choice's record in their place.
 */
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
    className="border-rule bg-background codefacts:hidden flex shrink-0 flex-wrap items-start gap-x-6 gap-y-2 border-t px-4 py-3"
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

/** A choice that came back failed: said where the reader looks next, and politely. */
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

/** On a phone: the diff one file at a time, with the way to the next and the one before. */
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

/** The diff from a tablet's width: plain from the server, drawn over in the browser, the choices at its foot. */
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

/** On a phone: the want, the verdict and the choices first, then the diff a file at a time. */
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
      <p className="text-want max-w-[70ch]" data-said="">
        {ask.brief.want}
      </p>
    )}
    {verdict === undefined ? null : (
      <div data-outcome={verdict.outcome._tag}>
        <StatusLine
          command={false}
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
      choices={stuckAboveBar}
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

/** The inspector's facts: the want, the verdict, the decision, the lines that finish it, the diff's stats. */
const FinishFacts = ({
  ask,
  busy,
  decision,
  files,
  now,
  onDecide,
  platformUrl,
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
    | "platformUrl"
    | "soon"
    | "stamp"
  >
> &
  Pick<FinishViewProps, "ask" | "verdict">) => (
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
    <FinishLines
      decision={decision}
      platformUrl={platformUrl}
      verdict={verdict}
    />
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
        { label: "Today", to: "/today" },
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
          This decision carries no diff: fetch the answer&apos;s head to read
          it, with the first line in Facts.
        </p>
      ) : (
        <WideDiff {...props} {...shared} draw={draw} split={split} />
      )}
    </Workspace>
  );
};
