import type { Ask } from "@repo/protocol/domain/ask";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { Hourglass, Shield } from "lucide-react";
import type { ReactNode } from "react";

import { signInHref } from "../auth/session-slot.tsx";
import { MarkerNote } from "../finish/annotation.tsx";
import type { PatchFile } from "../finish/files.ts";
import { FinishPlainDiff } from "../finish/finish-plain.tsx";
import type { LineNote } from "../finish/finish-plain.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock, PostureFacts } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { askPath, INBOX_PATH } from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { RefusalView } from "../shared/refusal.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine } from "../shared/status-line.tsx";
import { When } from "../shared/time.tsx";
import { stuckAtFoot } from "./choices.tsx";
import { DecisionCard } from "./decision-card.tsx";
import type { DecideInput } from "./decision-card.tsx";
import { DecisionRead } from "./read.ts";
import type { DecisionPageData, FoundDecision } from "./read.ts";
import { byWhen, describeSubject, subjectKind } from "./subject.ts";

export { DecisionPageData, DecisionRead } from "./read.ts";

export type { FoundDecision } from "./read.ts";

const waives = DecisionSubject.isAnyOf(["Waiver"]);

const finishes = DecisionSubject.isAnyOf(["Finish"]);

const NO_FILES: readonly PatchFile[] = [];

const LINK = "decoration-rule underline hover:decoration-current";

const crumbsOf = (project: ProjectName, id: DecisionId) => [
  { label: project, to: `/${project}` },
  { label: "Inbox", to: INBOX_PATH },
  { label: id, mono: true },
];

const DecisionFacts = ({
  decision,
  now,
  soon,
}: {
  readonly decision: Decision;
  readonly now: DateTime.Utc;
  readonly soon: boolean;
}) => (
  <FactBlock label="Decision">
    <dl className="text-ui grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
      <dt className="text-label text-muted-foreground pt-0.5">Maintainers</dt>
      <dd className="flex flex-wrap gap-x-2">
        {decision.deciders.map((handle) => (
          <HandleLink handle={handle} key={handle} />
        ))}
      </dd>
      <dt className="text-label text-muted-foreground pt-0.5">Opened</dt>
      <dd>
        <When at={decision.openedAt} now={now} />
      </dd>
      <dt className="text-label text-muted-foreground pt-0.5">Expires</dt>
      <dd className={soon ? "text-waiting font-medium" : ""} data-soon={soon}>
        <Hourglass
          aria-hidden="true"
          className="mr-1.5 inline size-4 align-[-0.1875rem]"
          strokeWidth={1.75}
        />
        <When at={decision.expiresAt} now={now} />
        <span className="text-muted-foreground font-normal">
          {" "}
          · {byWhen(decision.expiresAt)}
        </span>
      </dd>
      <dt className="text-label text-muted-foreground pt-0.5">Default</dt>
      <dd data-default={decision.default}>
        <Shield
          aria-hidden="true"
          className="text-muted-foreground mr-1.5 inline size-4 align-[-0.1875rem]"
          strokeWidth={1.75}
        />
        {decision.default}
      </dd>
    </dl>
  </FactBlock>
);

const AskFacts = ({ ask }: { readonly ask: Ask }) => (
  <FactBlock label="The ask">
    <p className="text-ui" data-said="">
      {ask.brief.want}
    </p>
    <AppLink className={`text-ui ${LINK}`} to={askPath(ask.project, ask.id)}>
      <code className="text-mono font-mono">{ask.id}</code>
    </AppLink>
  </FactBlock>
);

export const WaiverDiff = ({
  decision,
  files,
}: {
  readonly decision: Decision;
  readonly files: readonly PatchFile[];
}) => {
  if (!waives(decision.subject)) {
    return null;
  }

  const { at, marker, reason } = decision.subject;
  const mine = files.filter(({ file }) => file.path === at.path);

  const notes: readonly LineNote[] = [
    {
      line: at.line,
      node: <MarkerNote marker={marker} reason={reason} />,
      path: at.path,
    },
  ];

  return mine.length === 0 ? null : (
    <section
      aria-label="The marker in the answer"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 className="text-title">The marker in the answer</h2>
      <div className="border-rule -mx-px overflow-hidden border">
        <FinishPlainDiff files={mine} notes={notes} />
      </div>
    </section>
  );
};

const ForAnyone = ({
  children,
  id,
  project,
}: {
  readonly children?: ReactNode;
  readonly id: DecisionId;
  readonly project: ProjectName;
}) => (
  <div className="flex max-w-(--measure) flex-col items-start gap-3">
    <p className="text-body">
      Decision <code className="text-mono font-mono">{id}</code> is a choice put
      to {project}&apos;s maintainers: the people its policy names for what it
      is about. A maintainer takes it on their Today, with its evidence and a
      safe default if nobody does.
    </p>
    <p className="text-ui">
      <AppLink className={LINK} to={`/${project}/policy`}>
        Who decides in {project}
      </AppLink>
    </p>
    {children}
  </div>
);

export interface DecisionViewProps {
  readonly data: DecisionPageData;
  readonly onDecide: (input: DecideInput) => void;
  readonly busy?: boolean;
  readonly taken?: Decision | undefined;
  readonly files?: readonly PatchFile[];
  readonly finish?: ReactNode;
  readonly here: string;
  readonly failure?: ReactNode;
}

const Found = ({
  busy,
  failure,
  files,
  found,
  now,
  onDecide,
  taken,
}: {
  readonly found: FoundDecision;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly busy: boolean;
  readonly files: readonly PatchFile[];
  readonly taken: Decision | undefined;
  readonly failure: ReactNode;
}) => {
  const decision = taken ?? found.decision;

  const subject = {
    decision,
    kind: "decision",
    now,
    viewerDecides: true,
  } as const;

  return (
    <Workspace
      crumbs={crumbsOf(decision.project, decision.id)}
      facts={
        <>
          <DecisionFacts decision={decision} now={now} soon={found.soon} />
          {found.ask === undefined ? null : <AskFacts ask={found.ask} />}
          {found.posture === undefined ? null : (
            <PostureFacts
              label={found.posture.label}
              posture={found.posture.posture}
              project={decision.project}
            />
          )}
        </>
      }
      factsHeading="This decision"
      meta={
        <>
          {decision.project} · {subjectKind(decision.subject)} ·{" "}
          <code className="text-mono font-mono">{decision.id}</code>
        </>
      }
      state={<StatusLine compact subject={subject} />}
      status={<StatusLine stamp={taken !== undefined} subject={subject} />}
      title={describeSubject(decision.subject)}
    >
      <DecisionCard
        busy={busy}
        choices={stuckAtFoot}
        decision={decision}
        expiry={false}
        now={now}
        onDecide={onDecide}
        soon={found.soon}
        stamp={taken !== undefined}
      >
        <WaiverDiff decision={decision} files={files} />
        <div aria-live="polite" className="empty:hidden">
          {failure}
        </div>
      </DecisionCard>
    </Workspace>
  );
};

const Apart = ({
  children,
  data,
}: {
  readonly children: ReactNode;
  readonly data: DecisionPageData;
}) => (
  <Workspace
    crumbs={crumbsOf(data.project, data.decision)}
    title={`Decision ${data.decision}`}
  >
    {children}
  </Workspace>
);

export const DecisionView = ({
  busy = false,
  data,
  failure,
  files = NO_FILES,
  finish,
  here,
  onDecide,
  taken,
}: DecisionViewProps) =>
  DecisionRead.match(data.read, {
    Found: (found) =>
      finish !== undefined && finishes(found.decision.subject) ? (
        finish
      ) : (
        <Found
          busy={busy}
          failure={failure}
          files={files}
          found={found}
          now={data.now}
          onDecide={onDecide}
          taken={taken}
        />
      ),
    NotOnToday: () => (
      <Apart data={data}>
        <EmptyState
          title={`Decision ${data.decision} is not on your Today: it was decided, or it expired to its default.`}
        />
      </Apart>
    ),
    Refused: ({ refusal }) => (
      <Apart data={data}>
        <ForAnyone id={data.decision} project={data.project}>
          <RefusalView refusals={[refusal]} />
        </ForAnyone>
      </Apart>
    ),
    SignedOut: () => (
      <Apart data={data}>
        <ForAnyone id={data.decision} project={data.project}>
          <p className="text-ui">
            <a
              className="decoration-rule font-medium underline hover:decoration-current"
              href={signInHref(here)}
            >
              Sign in
            </a>{" "}
            to take it, if you decide in {data.project}.
          </p>
        </ForAnyone>
      </Apart>
    ),
    Unreachable: () => (
      <Apart data={data}>
        <UnreachableNotice />
      </Apart>
    ),
  });
