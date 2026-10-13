import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, Handle, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import type { DateTime } from "effect";
import { ChevronDown, Hourglass } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  deleteChildOf,
  familyHead,
  roundsAsTheyStand,
} from "../answer/subject.ts";
import { ClientFile } from "../code/client-code.tsx";
import { linesOf } from "../code/file-header.tsx";
import { NumberedLines } from "../code/numbered-lines.tsx";
import { blobHref, shortSha } from "../code/paths.ts";
import { postureLabel } from "../project/posture-label.ts";
import { familyMarks } from "../shared/ask-progress.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import {
  ClaimFacts,
  PostureFacts,
  TakeItFacts,
  TerritoryFacts,
} from "../shared/facts.tsx";
import { FamilyStrip } from "../shared/family.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { answerPath, askPath } from "../shared/paths.ts";
import { MetaCode, MetaLine, Row } from "../shared/row.tsx";
import type { Crumb } from "../shared/shell/sections.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { StatusLine, readStatus } from "../shared/status-line.tsx";
import type { StatusSubject } from "../shared/status-line.tsx";
import { When } from "../shared/time.tsx";
import { Region } from "./fields.tsx";
import { markdownPath } from "./markdown.ts";

export interface CheckSource {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}

const LINK = "decoration-rule underline hover:decoration-current";

const NONE: ReadonlyMap<AskId, AskProgress> = new Map();

const CHECK_LINES = 30;

export const askCrumbs = (ask: Ask): readonly Crumb[] => [
  { label: ask.project, to: `/${ask.project}` },
  { label: "Asks", to: `/${ask.project}` },
  { label: ask.id, mono: true },
];

export const claimCommand = (ask: Ask) =>
  `${Brand.cli} claim ${ask.id} --project ${ask.project}`;

const CheckSummary = ({ ask }: { readonly ask: Ask }) =>
  CheckSpec.match(ask.check, {
    LintToZero: ({ rule, territory }) => (
      <>
        Lint to zero: <MetaCode>{rule}</MetaCode>
        {territory === undefined ? null : (
          <>
            {" "}
            in <MetaCode>{territory}</MetaCode>
          </>
        )}
      </>
    ),
    Migrate: ({ from, to }) => (
      <>
        Migrate: no caller of <MetaCode>{from}</MetaCode> is left
        {to === undefined ? null : (
          <>
            ; each moves to <MetaCode>{to}</MetaCode>
          </>
        )}
      </>
    ),
    Ratchet: ({ ratchet }) => (
      <>
        The ratchet <MetaCode>{ratchet}</MetaCode> goes down
      </>
    ),
    RedThenGreen: ({ path }) => (
      <>
        Red, then green:{" "}
        <AppLink
          className={`text-mono font-mono [overflow-wrap:anywhere] ${LINK}`}
          to={blobHref(ask.project, "main", path)}
        >
          {path}
        </AppLink>{" "}
        fails on main, and passes once the ask is answered.
      </>
    ),
    SymbolAbsent: ({ symbol }) => (
      <>
        Nothing uses <MetaCode>{symbol}</MetaCode> any more
      </>
    ),
  });

const CheckFile = ({ source }: { readonly source: CheckSource }) => {
  const [whole, setWhole] = useState(false);
  const lines = linesOf(source.text);
  const long = lines.length > CHECK_LINES;

  const shown =
    whole || !long ? source.text : lines.slice(0, CHECK_LINES).join("\n");

  return (
    <figure className="border-rule flex min-w-0 flex-col border">
      <figcaption className="border-rule text-label text-muted-foreground flex h-9 min-w-0 items-center gap-3 border-b px-3">
        <span className="text-mono min-w-0 flex-1 truncate font-mono">
          {source.path}
        </span>
        <span className="shrink-0 tabular-nums">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </figcaption>
      <ClientFile
        fallback={<NumberedLines text={shown} />}
        key={whole ? "whole" : "head"}
        path={source.path}
        sha={whole || !long ? source.sha : `${source.sha}:${CHECK_LINES}`}
        text={shown}
      />
      {long ? (
        <button
          aria-expanded={whole}
          className="border-rule text-ui hover:bg-surface flex min-h-10 items-center gap-2 border-t px-3 text-left transition-colors duration-[120ms]"
          onClick={() => {
            setWhole((now) => !now);
          }}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={`text-muted-foreground size-4 shrink-0 transition-transform duration-150 ${whole ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
          {whole
            ? `Show the first ${CHECK_LINES} lines`
            : `Show the whole check, ${lines.length} lines`}
        </button>
      ) : null}
    </figure>
  );
};

const BriefPart = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <h3 className="text-ui font-semibold">{title}</h3>
    {children}
  </div>
);

const BriefList = ({ items }: { readonly items: readonly string[] }) => (
  <ul className="flex list-[square] flex-col gap-1 pl-5 marker:text-[color:var(--rule-strong)]">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const Brief = ({ ask }: { readonly ask: Ask }) => {
  const { context, current, outOfScope, terms } = ask.brief;

  const parts = [
    current === undefined ? null : (
      <BriefPart key="current" title="Current behaviour">
        <p>{current}</p>
      </BriefPart>
    ),
    outOfScope === undefined ? null : (
      <BriefPart key="out" title="Out of scope">
        <BriefList items={outOfScope} />
      </BriefPart>
    ),
    terms === undefined || terms.length === 0 ? null : (
      <BriefPart key="terms" title="Terms">
        <BriefList items={terms} />
      </BriefPart>
    ),
    context === undefined || context.length === 0 ? null : (
      <BriefPart key="context" title="Context">
        <BriefList items={context} />
      </BriefPart>
    ),
  ].filter((part) => part !== null);

  return parts.length === 0 ? null : (
    <Region id="ask-brief" title="Brief">
      <div className="text-body flex max-w-[70ch] flex-col gap-5" data-said="">
        {parts}
      </div>
    </Region>
  );
};

const Answers = ({
  ask,
  now,
  rounds,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly rounds: AskProgress["rounds"];
}) => (
  <Region id="ask-answers" title="Answers">
    {rounds.length === 0 ? (
      <p className="text-ui text-muted-foreground">
        No answer has been judged yet.
      </p>
    ) : (
      <ul aria-label="Answers, oldest first" className="border-rule border-t">
        {rounds.map(({ at, head, outcome, seq }, index) => {
          const { lead, mark } = readStatus({ kind: "answer", outcome });

          return (
            <Row
              href={answerPath(ask.project, ask.id)}
              id={`${head}:${seq}`}
              key={seq}
              meta={<MetaCode>{shortSha(head)}</MetaCode>}
              search={{ head }}
              size="one-line"
              state={{ mark, time: <When at={at} now={now} />, word: lead }}
              title={`Round ${index + 1}`}
            />
          );
        })}
      </ul>
    )}
    <AppLink
      className={`text-ui self-start ${LINK}`}
      to={answerPath(ask.project, ask.id)}
    >
      Where the latest answer stands
    </AppLink>
  </Region>
);

const WaitsOn = ({
  asks,
  project,
}: {
  readonly asks: readonly AskId[];
  readonly project: ProjectName;
}) => (
  <p className="text-ui mt-2 flex items-start gap-2" data-state="waiting">
    <Hourglass
      aria-hidden="true"
      className="text-waiting mt-0.5 size-4 shrink-0"
      strokeWidth={1.75}
    />
    <span className="min-w-0">
      Waits on{" "}
      {asks.map((ask, index) => (
        <span key={ask}>
          {index === 0 ? null : ", "}
          <AppLink
            className={`text-mono font-mono ${LINK}`}
            to={askPath(project, ask)}
          >
            {ask}
          </AppLink>
        </span>
      ))}{" "}
      to land first; a claim waits until they do.
    </span>
  </p>
);

const FamilyWaits = ({
  finale,
  parent,
  project,
  states,
}: {
  readonly finale: AskId;
  readonly parent: Ask;
  readonly project: ProjectName;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}) => {
  const children = parent.blockedBy.filter((child) => child !== finale);

  const left = children.filter(
    (child) => states.get(child)?.landed === undefined
  ).length;

  const deleteStep = (
    <AppLink className={LINK} to={askPath(project, finale)}>
      the delete step
    </AppLink>
  );

  return (
    <p className="text-ui mt-2 flex items-start gap-2" data-state="waiting">
      <Hourglass
        aria-hidden="true"
        className="text-waiting mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span className="min-w-0">
        Waits for{" "}
        {left === 0 ? null : (
          <>
            {left} of {children.length}{" "}
            {children.length === 1 ? "child" : "children"} and{" "}
          </>
        )}
        {deleteStep} to land first; a claim waits until they do.
      </span>
    </p>
  );
};

export interface AskViewProps {
  readonly ask: Ask;
  readonly brief: string;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  readonly parent?: Ask | undefined;
  readonly verdict?: Verdict | undefined;
  readonly check?: CheckSource | undefined;
  readonly posture?: Posture | undefined;
  readonly viewer?: Handle | undefined;
}

const subjectOf = (
  ask: Ask,
  states: ReadonlyMap<AskId, AskProgress>,
  verdict: Verdict | undefined,
  takeable: boolean
): StatusSubject => {
  const progress = states.get(ask.id);
  const claimant = progress?.claimant;
  const latest = progress?.latest;

  if (progress?.landed !== undefined) {
    return {
      kind: "answer",
      outcome: Outcome.cases.Landed.make({ sha: progress.landed.sha }),
      project: ask.project,
    };
  }

  const lastRound = progress?.rounds.at(-1);

  if (
    latest !== undefined &&
    Outcome.isAnyOf(["Refused"])(latest) &&
    verdict !== undefined &&
    verdict.head === lastRound?.head
  ) {
    return {
      claimant,
      kind: "answer",
      outcome: latest,
      project: ask.project,
      stage: verdict.stage,
    };
  }

  return {
    blockers:
      ask.parent !== undefined && ask.blockedBy.length > 0
        ? familyMarks(ask, states)
        : undefined,
    claimant,
    kind: "ask",
    latest,
    ask,
    takeable,
  };
};

const standing = (
  ask: Ask,
  states: ReadonlyMap<AskId, AskProgress>,
  parent: Ask | undefined
) => {
  const progress = states.get(ask.id);

  const remaining = ask.blockedBy.filter(
    (blocker) => states.get(blocker)?.landed === undefined
  );

  const family = familyHead(ask, parent);
  const latest = progress?.latest;

  return {
    family,
    finale: family === undefined ? undefined : deleteChildOf(family),
    held: progress?.claimant !== undefined || ask.state === "claimed",
    progress,
    remaining,
    takeable: ask.state === "open" && remaining.length === 0,
    waitsOn:
      ask.parent === undefined &&
      remaining.length > 0 &&
      !(latest !== undefined && Outcome.isAnyOf(["WaitingOnParent"])(latest)),
  };
};

const AskFacts = ({
  ask,
  now,
  parent,
  platformUrl,
  posture,
  states,
  viewer,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
  readonly parent: Ask | undefined;
  readonly platformUrl: string;
  readonly posture: Posture | undefined;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly viewer: Handle | undefined;
}) => {
  const { held, progress, takeable } = standing(ask, states, parent);

  return (
    <>
      {takeable ? <TakeItFacts ask={ask} platformUrl={platformUrl} /> : null}
      {!takeable && held && ask.state !== "closed" ? (
        <ClaimFacts
          now={now}
          {...(progress?.claimant === undefined
            ? {}
            : { claimant: progress.claimant })}
          {...(progress?.lastPush === undefined
            ? {}
            : { lastPush: progress.lastPush })}
          {...(viewer === undefined ? {} : { viewer })}
        />
      ) : null}
      <TerritoryFacts ask={ask} />
      {posture === undefined ? null : (
        <PostureFacts
          label={postureLabel(posture)}
          posture={posture}
          project={ask.project}
        />
      )}
    </>
  );
};

const AskMeta = ({
  ask,
  now,
}: {
  readonly ask: Ask;
  readonly now: DateTime.Utc;
}) => (
  <MetaLine
    parts={[
      ask.kind,
      <span key="asked">
        asked by <HandleLink handle={ask.askedBy} />
        {ask.mentor === undefined ? null : (
          <>
            , mentored by <HandleLink handle={ask.mentor} />
          </>
        )}
      </span>,
      <span key="opened">
        opened <When at={ask.openedAt} now={now} />
      </span>,
    ]}
  />
);

const ForAgents = ({
  ask,
  brief,
}: {
  readonly ask: Ask;
  readonly brief: string;
}) => (
  <section aria-label="For agents" className="flex min-w-0 flex-col gap-3">
    <details className="group border-rule border-y">
      <summary className="text-ui hover:bg-surface/50 flex min-h-10 cursor-pointer list-none items-center gap-3 transition-colors duration-[120ms] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">The brief, as an agent reads it</span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          strokeWidth={1.75}
        />
      </summary>
      <pre className="border-rule bg-surface text-mono leading-terminal mb-3 overflow-x-auto border p-3 font-mono whitespace-pre-wrap">
        {brief}
      </pre>
    </details>
    <p className="text-ui text-muted-foreground">
      {/* A server route, not one of the router's pages. */}
      <a
        className={`text-foreground ${LINK}`}
        href={markdownPath(ask.project, ask.id)}
        type="text/markdown"
      >
        This ask as Markdown
      </a>
      , for an agent to fetch.
    </p>
  </section>
);

export const AskView = ({
  ask,
  brief,
  check,
  now,
  parent,
  platformUrl,
  posture,
  states = NONE,
  verdict,
  viewer,
}: AskViewProps) => {
  const { family, finale, progress, remaining, takeable, waitsOn } = standing(
    ask,
    states,
    parent
  );

  const subject = subjectOf(ask, states, verdict, takeable);

  return (
    <Workspace
      crumbs={askCrumbs(ask)}
      facts={
        <AskFacts
          ask={ask}
          now={now}
          parent={parent}
          platformUrl={platformUrl}
          posture={posture}
          states={states}
          viewer={viewer}
        />
      }
      factsHeading="This ask"
      meta={<AskMeta ask={ask} now={now} />}
      state={<StatusLine compact subject={subject} />}
      status={
        <>
          <StatusLine subject={subject} />
          {waitsOn && family === ask && finale !== undefined ? (
            <FamilyWaits
              finale={finale}
              parent={ask}
              project={ask.project}
              states={states}
            />
          ) : null}
          {waitsOn && family !== ask ? (
            <WaitsOn asks={remaining} project={ask.project} />
          ) : null}
          {family === undefined ? null : (
            <div className="mt-4">
              <FamilyStrip
                expanded={false}
                parent={family}
                project={ask.project}
                stamps={new Set()}
                states={states}
                {...(finale === undefined ? {} : { finale })}
              />
            </div>
          )}
        </>
      }
      said
      title={ask.brief.want}
      {...(takeable ? { primaryCommand: claimCommand(ask) } : {})}
    >
      <Brief ask={ask} />

      <Region id="ask-check" title="The check">
        <p className="text-ui max-w-[70ch]">
          <CheckSummary ask={ask} />
        </p>
        {check === undefined ? null : <CheckFile source={check} />}
      </Region>

      <Answers
        ask={ask}
        now={now}
        rounds={roundsAsTheyStand(progress, verdict)}
      />

      <ForAgents ask={ask} brief={brief} />
    </Workspace>
  );
};
