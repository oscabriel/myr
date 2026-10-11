/**
 * The inspector's fact blocks: the typed facts of the thing in hand, each
 * under a label, in a fixed order per page. A block holds no box; a value
 * that is code is mono and wraps anywhere; a long SHA or root is shortened
 * (`7fbe4b2`, `sha256:7fbe4b…`), its whole value in its title and on copy.
 * Blocks never repeat the page's prose: they hold the facts it refers to.
 *
 * The blocks every page shares are here (State, Take it, Claim, Gate,
 * Posture, Held back, Family, Territory and check, Credit,
 * Provenance); a block only one page has is that page's own.
 */
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import type { LandingView } from "@repo/protocol/domain/landing";
import { StageName } from "@repo/protocol/domain/outcome";
import type { Outcome } from "@repo/protocol/domain/outcome";
import type { AreaName, Handle, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { DateTime, Match } from "effect";
import { ChevronDown, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { blobHref, shortSha, treeHref } from "../code/paths.ts";
import type { AskProgress } from "./ask-progress.ts";
import { CommandLine } from "./command.tsx";
import { CopyAction } from "./copy-action.tsx";
import { CreditTrailers } from "./credits.tsx";
import { FamilyTree } from "./family.tsx";
import { HandleLink } from "./handle.tsx";
import { AppLink } from "./link.tsx";
import { StateMarkIcon } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";
import { stageStates } from "./outcome.tsx";
import type { StageHolds, StageState } from "./outcome.tsx";
import { ledgerPath } from "./paths.ts";
import { PostureBadge } from "./posture.tsx";
import { MetaCode } from "./row.tsx";
import { StatusLine, readStatus, stageNames } from "./status-line.tsx";
import type { StatusSubject } from "./status-line.tsx";
import { When } from "./time.tsx";

/** A block's frame: a hairline above every block but the first. */
const BLOCK =
  "@container border-rule flex min-w-0 flex-col gap-2.5 border-t py-3 first:border-t-0 first:pt-0";

const LINK = "decoration-rule underline hover:decoration-current";

/** One block: its label, then its facts. */
export const FactBlock = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <section aria-label={label} className={BLOCK}>
    <h3 className="text-label text-muted-foreground">{label}</h3>
    {children}
  </section>
);

/**
 * A long hash as a person reads it: a 40- or 64-hex SHA to its first
 * seven, an `algorithm:hex` root to the algorithm and six; anything else as
 * it is.
 */
export const shortValue = (value: string) => {
  if (/^[0-9a-f]{40,64}$/u.test(value)) {
    return shortSha(value);
  }

  const named = /^(?<algorithm>[a-z0-9]+):(?<hex>[0-9a-f]{16,})$/u.exec(value);

  const algorithm = named?.groups?.algorithm;
  const hex = named?.groups?.hex;

  return algorithm === undefined || hex === undefined
    ? value
    : `${algorithm}:${hex.slice(0, 6)}…`;
};

/** A value that is code: shortened, whole in its title. */
export const CodeValue = ({ value }: { readonly value: string }) => (
  <code className="text-mono font-mono [overflow-wrap:anywhere]" title={value}>
    {shortValue(value)}
  </code>
);

/** The status line whole, and the command that runs next, numbered first. */
export const StateFacts = ({
  command,
  subject,
}: {
  readonly subject: StatusSubject;
  /** What runs next; a refusal's own `next` when left out. */
  readonly command?: string;
}) => {
  const next = command ?? readStatus(subject).next;

  return (
    <FactBlock label="State">
      <StatusLine command={false} subject={subject} />
      {next === undefined ? null : <CommandLine command={next} numbered />}
    </FactBlock>
  );
};

/** One numbered step: what it does, then its command. */
const Step = ({
  command,
  label,
}: {
  readonly command: string;
  readonly label: string;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-label text-muted-foreground">{label}</p>
    <CommandLine command={command} numbered />
  </div>
);

/** Who may take an ask, in a sentence. */
const whoMayTake = (ask: Ask) => {
  if (ask.reserve === "newcomers") {
    return ask.mentor === undefined
      ? "Held for newcomers"
      : `Held for newcomers, mentored by ${ask.mentor}`;
  }

  return ask.reserve === "people"
    ? "Held for people, not agents"
    : `Anyone vouched in ${ask.project}, or with a record in its area`;
};

/** Who may take an open ask, then the three commands that start an answer. */
export const TakeItFacts = ({
  ask,
  platformUrl,
}: {
  readonly ask: Ask;
  /** Where the project is cloned from. */
  readonly platformUrl: string;
}) => (
  <FactBlock label="Take it">
    <p className="text-ui">{whoMayTake(ask)}</p>
    <Step
      command={`git clone ${platformUrl}/${ask.project}.git`}
      label="Clone the project"
    />
    <Step
      command={`${Brand.cli} claim ${ask.id} --project ${ask.project}`}
      label="Claim it, in the clone"
    />
    <Step command={`${Brand.cli} check`} label="Check before you push" />
  </FactBlock>
);

/** Who holds a claim, in words: the viewer, someone, or nobody. */
const Holder = ({
  claimant,
  yours,
}: {
  readonly claimant: Handle | undefined;
  readonly yours: boolean;
}) => {
  if (claimant === undefined) {
    return "Nobody holds a claim on it.";
  }

  return yours ? (
    <span className="font-medium">You hold this claim</span>
  ) : (
    <>
      Claimed by <HandleLink handle={claimant} />
    </>
  );
};

/**
 * Who holds a claim and when they last pushed. No read carries a claim's
 * deadline, so none is shown.
 */
export const ClaimFacts = ({
  claimant,
  lastPush,
  now,
  viewer,
}: {
  readonly claimant?: Handle;
  readonly lastPush?: AskProgress["lastPush"];
  readonly now: DateTime.Utc;
  /** Who is reading, to tell the claimant it is theirs. */
  readonly viewer?: Handle;
}) => {
  const yours = claimant !== undefined && claimant === viewer;

  return (
    <FactBlock label="Claim">
      <p className="text-ui">
        <Holder claimant={claimant} yours={yours} />
      </p>
      {lastPush === undefined ? null : (
        <p className="text-ui text-muted-foreground">
          Last pushed <When at={lastPush.at} now={now} />, as{" "}
          <CodeValue value={lastPush.head} />
        </p>
      )}
      {yours ? (
        <>
          <Step command={`${Brand.cli} check`} label="Check before you push" />
          <Step command="git push" label="Push your answer" />
        </>
      ) : null}
    </FactBlock>
  );
};

/** What each stage runs, in one line. */
const runs = Match.type<StageName>().pipe(
  Match.when(
    "parse",
    () => "Who may push what: the branch, the pusher and their claim."
  ),
  Match.when(
    "shape",
    () => "What the change touches, read from its paths and added lines."
  ),
  Match.when("merge", () => "The answer merged onto the landed main."),
  Match.when(
    "cheap",
    () => "Counts on the merged tree: the project's ratchets."
  ),
  Match.when(
    "checks",
    () =>
      "The ask's check first, then every lane of the project, on the merged tree."
  ),
  Match.when(
    "heldBack",
    () => "Checks kept in a layer, one result per area and nothing more."
  ),
  Match.when(
    "human",
    () => "A decider's finish, when the ask's kind asks for one."
  ),
  Match.exhaustive
);

/** Each stage's state as a mark and a word. */
const stageMarks = {
  current: { mark: "now", word: "now" },
  passed: { mark: "passed", word: "passed" },
  pending: { mark: "notYet", word: "not yet" },
  refused: { mark: "refused", word: "refused" },
  skipped: { mark: "notNeeded", word: "not needed" },
} as const satisfies Record<
  StageState,
  { readonly mark: StateMark; readonly word: string }
>;

/**
 * The gate. On a project: the seven stages in the order of their cost, on
 * one line, and what each runs behind a disclosure. On an answer: each
 * stage's state, the one it stands at marked as the current step.
 */
export const GateFacts = (
  props:
    | { readonly outcome?: undefined }
    | {
        readonly outcome: Outcome;
        readonly stage: StageName;
        readonly holds?: StageHolds;
      }
) => {
  if (props.outcome === undefined) {
    return (
      <FactBlock label="Gate">
        <p className="text-ui" data-term="">
          {StageName.literals
            .map((stage) => stageNames(stage).label)
            .join(" · ")}
        </p>
        <p className="text-ui text-muted-foreground">
          Every answer is checked on the exact tree it would land as.
        </p>
        <details className="group">
          <summary className="text-ui hover:text-foreground text-muted-foreground flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            What each stage runs
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 transition-transform duration-150 group-open:rotate-180"
              strokeWidth={1.75}
            />
          </summary>
          <dl className="mt-2 flex flex-col gap-1.5">
            {StageName.literals.map((stage) => (
              <div className="flex flex-col" key={stage}>
                <dt className="text-label" data-term="">
                  {stageNames(stage).label}
                </dt>
                <dd className="text-label text-muted-foreground font-normal">
                  {runs(stage)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </FactBlock>
    );
  }

  const { holds, outcome, stage } = props;

  return (
    <FactBlock label="Gate">
      <ol aria-label="Gate stages" className="flex flex-col">
        {stageStates(stage, outcome, holds).map(([name, state]) => (
          <li
            aria-current={state === "current" ? "step" : undefined}
            className={`text-ui -mx-2 flex h-7 items-center gap-2 px-2 ${
              state === "current" ? "bg-surface font-medium" : ""
            }`}
            data-stage={name}
            data-state={state}
            key={name}
          >
            <StateMarkIcon mark={stageMarks[state].mark} size="sm" />
            <span
              className={
                state === "pending" || state === "skipped"
                  ? "text-muted-foreground"
                  : ""
              }
              data-term=""
            >
              {stageNames(name).label}
            </span>
            <span className="text-label text-muted-foreground ml-auto font-normal">
              {stageMarks[state].word}
            </span>
          </li>
        ))}
      </ol>
    </FactBlock>
  );
};

/** What each posture means, in one line. */
const glosses = {
  open: "Everything it ships is public.",
  openCore: "Some files it ships are kept in a layer, with no date to open.",
  openOnSchedule:
    "Some files it ships wait in a layer, and open by a set date.",
  openWithSealedEvidence:
    "Everything it ships is public; some checks are kept in a layer and judge answers unseen.",
  sourceAvailable: "Its licence is not an open-source one.",
} as const satisfies Record<Posture, string>;

/** A project's posture as the platform labels it, what it means, and its ledger. */
export const PostureFacts = ({
  label,
  posture,
  project,
}: {
  readonly label: string;
  readonly posture: Posture;
  readonly project: ProjectName;
}) => (
  <FactBlock label="Posture">
    <PostureBadge label={label} posture={posture} />
    <p className="text-ui text-muted-foreground">{glosses[posture]}</p>
    <AppLink className={`text-ui ${LINK}`} to={ledgerPath(project)}>
      The ledger of {project}
    </AppLink>
  </FactBlock>
);

/** What a project holds back: one sealed line per area, or that nothing is. */
export const HeldBackFacts = ({
  areas,
}: {
  readonly areas: readonly {
    readonly area: AreaName;
    /** What the area holds, in words: "7 sealed checks". */
    readonly detail: string;
  }[];
}) => (
  <FactBlock label="Held back">
    {areas.length === 0 ? (
      <p className="text-ui text-muted-foreground">Nothing held back</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {areas.map(({ area, detail }) => (
          <li
            className="text-ui text-sealed flex items-start gap-2"
            data-area={area}
            key={area}
          >
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="text-mono font-mono">{area}</span>: {detail}
            </span>
          </li>
        ))}
      </ul>
    )}
  </FactBlock>
);

/** The family a member belongs to, drawn top to bottom. */
export const FamilyFacts = (props: Parameters<typeof FamilyTree>[0]) => (
  <FactBlock label="Family">
    <FamilyTree {...props} />
  </FactBlock>
);

/** The folder a territory's first path names, when it names one plainly. */
const folderOf = (ask: Ask) => {
  const [first] = ask.territory.paths;
  const folder = first.replace(/\/\*\*$|\/\*$|^\*\*$/u, "");

  return /[*?[{]/u.test(folder) ? undefined : folder;
};

/**
 * A territory: a module by name, linked to its folder when its first path
 * names one plainly; the whole project when it covers every path; or, in
 * a repo of one package, the paths themselves.
 */
const TerritoryLine = ({ ask }: { readonly ask: Ask }) => {
  const folder = folderOf(ask);
  const { module, paths } = ask.territory;

  if (folder === "") {
    return (
      <AppLink className={`text-ui ${LINK}`} to={treeHref(ask.project, "main")}>
        The whole project
      </AppLink>
    );
  }

  if (module === ".") {
    return (
      <p className="text-mono font-mono [overflow-wrap:anywhere]">
        {paths.join(", ")}
      </p>
    );
  }

  return folder === undefined ? (
    <MetaCode>{module}</MetaCode>
  ) : (
    <AppLink
      className={`text-mono font-mono [overflow-wrap:anywhere] ${LINK}`}
      to={treeHref(ask.project, "main", folder)}
    >
      {module}
    </AppLink>
  );
};

/** What judges an answer, by the check's kind. */
const CheckLine = ({ ask }: { readonly ask: Ask }) =>
  CheckSpec.match(ask.check, {
    LintToZero: ({ rule }) => (
      <p className="text-ui">
        Lint to zero: <MetaCode>{rule}</MetaCode>
      </p>
    ),
    Migrate: ({ from, to }) => (
      <p className="text-ui">
        Migrate <MetaCode>{from}</MetaCode>
        {to === undefined ? null : (
          <>
            {" "}
            to <MetaCode>{to}</MetaCode>
          </>
        )}
      </p>
    ),
    Ratchet: ({ ratchet }) => (
      <p className="text-ui">
        The ratchet <MetaCode>{ratchet}</MetaCode> goes down
      </p>
    ),
    RedThenGreen: ({ path }) => (
      <>
        <AppLink
          className={`text-mono font-mono [overflow-wrap:anywhere] ${LINK}`}
          to={blobHref(ask.project, "main", path)}
        >
          {path}
        </AppLink>
        <p className="text-ui text-muted-foreground">
          The check fails on main: it is red first.
        </p>
      </>
    ),
    SymbolAbsent: ({ symbol }) => (
      <p className="text-ui">
        <MetaCode>{symbol}</MetaCode> is gone
      </p>
    ),
  });

/** Where an answer may change things, and what judges it. */
export const TerritoryFacts = ({ ask }: { readonly ask: Ask }) => (
  <FactBlock label="Territory and check">
    <TerritoryLine ask={ask} />
    <CheckLine ask={ask} />
  </FactBlock>
);

/** A landing's credit as the commit carries it, the agents apart. */
export const CreditFacts = (props: {
  readonly assisted: readonly AgentTrailer[];
  readonly credits: readonly Credit[];
  readonly heldBack?: string | undefined;
}) => (
  <div className={BLOCK}>
    <CreditTrailers
      assisted={props.assisted}
      credits={props.credits}
      {...(props.heldBack === undefined ? {} : { heldBack: props.heldBack })}
    />
  </div>
);

/** One fact of provenance: its label, its whole value, and how it reads. */
export interface ProvenanceEntry {
  readonly label: string;
  readonly value: string;
  /** How it reads, when not as its shortened value (a time). */
  readonly shown?: ReactNode;
}

/** What a verdict judged: the commits, the tree, the patch, the check, who judged it and when. */
export const verdictProvenance = (
  verdict: Verdict,
  now: DateTime.Utc
): readonly ProvenanceEntry[] => [
  { label: "Head", value: verdict.head },
  { label: "Base", value: verdict.base },
  { label: "Merged tree", value: verdict.tree },
  { label: "Patch id", value: verdict.patchId },
  { label: "Check version", value: verdict.checkVersion },
  { label: "Verifier", value: verdict.verifier },
  {
    label: "Judged",
    shown: <When at={verdict.at} now={now} />,
    value: DateTime.formatIso(verdict.at),
  },
];

/** Where a landing comes from: its author, its parent, and the request that landed it. */
export const landingProvenance = (
  landing: LandingView
): readonly ProvenanceEntry[] => [
  { label: "Author", value: landing.author },
  ...(landing.parent === undefined
    ? []
    : [{ label: "Parent", value: landing.parent }]),
  ...(landing.verdict === undefined
    ? []
    : [{ label: "Verdict", value: landing.verdict.patchId }]),
  ...(landing.requestId === undefined
    ? []
    : [{ label: "Request-Id", value: landing.requestId }]),
];

/**
 * The plumbing, last: each value shortened, whole in its title and on
 * copy. Below the shell's width it starts folded.
 */
export const ProvenanceFacts = ({
  entries,
}: {
  readonly entries: readonly ProvenanceEntry[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Provenance" className={BLOCK}>
      <h3 className="text-label text-muted-foreground shell:block hidden">
        Provenance
      </h3>
      <button
        aria-expanded={open}
        className="text-label text-muted-foreground hover:text-foreground shell:hidden flex items-center gap-1.5 self-start"
        onClick={() => {
          setOpen((now) => !now);
        }}
        type="button"
      >
        Provenance
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      <dl className={`${open ? "flex" : "shell:flex hidden"} flex-col gap-1.5`}>
        {entries.map(({ label, shown, value }) => (
          // A label over its value, as every block is: never a key and
          // value grid.
          <div
            className="flex min-w-0 flex-col"
            data-provenance={label}
            key={label}
          >
            <dt className="text-label text-muted-foreground">{label}</dt>
            <dd className="text-ui flex min-h-8 min-w-0 items-center gap-3">
              <span className="min-w-0 flex-1 truncate">
                {shown ?? <CodeValue value={value} />}
              </span>
              {shown === undefined ? (
                <CopyAction command={value} label={`Copy ${label}`} />
              ) : (
                // A time reads as words, its exact instant in its own
                // title: nothing here to paste into a terminal.
                <span aria-hidden="true" className="size-8 shrink-0" />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
