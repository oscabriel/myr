import type { Evidence as Fact } from "@repo/protocol/domain/common";
/**
 * A decision's evidence, typed by what it is about: the commits a stray
 * push moved between (each a link to its page), the proposal's draft and
 * files, a ratchet's before and after, a waiver's marker at its line, a
 * posture's from and to beside the ledger, the hosts a proxy may now reach,
 * the item a stored value matched, the person a vouch admits, the answer a
 * finish lands. Then whatever else the platform put on it, as label and
 * value, the diff and the fork left to the finish.
 *
 * Every value that is code is mono; every link is the router's.
 */
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { Posture } from "@repo/protocol/posture";
import { ArrowRight, FileDiff, FileText } from "lucide-react";
import type { ReactNode } from "react";

import { commitHref, shortSha } from "../code/paths.ts";
import { FORK_LABEL, PATCH_LABEL } from "../finish/patch.ts";
import { DraftedCode } from "../proposal/client-file.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { POSTURE_MARKS } from "../shared/mark-look.ts";
import { Mark } from "../shared/marks.tsx";
import { answerPath, envPath, ledgerPath } from "../shared/paths.ts";
import { refWords } from "./subject.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const CODE = "text-mono font-mono [overflow-wrap:anywhere]";

/**
 * Whether an evidence line holds a file: its label is a path (one word with
 * a slash or a dot, as the ask file under the config folder, or a check
 * at the root, `offset.test.ts`), where every other label is words.
 */
const isFileFact = ({ label }: Fact) => /^\S*[./]\S*$/u.test(label);

const opensAsk = DecisionSubject.isAnyOf(["OpenProposal"]);

/** The files an `OpenProposal` decision holds, shown as code; none for any other subject. */
export const filesOf = (decision: Decision): readonly Fact[] =>
  opensAsk(decision.subject) ? decision.evidence.filter(isFileFact) : [];

/** One fact: its label over (or beside) its value. */
const FactRow = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <div className="contents">
    <dt className="text-label text-muted-foreground pt-0.5">{label}</dt>
    <dd className="text-ui tablet:mb-0 mb-1.5 min-w-0 [overflow-wrap:anywhere]">
      {children}
    </dd>
  </div>
);

const FactList = ({ children }: { readonly children: ReactNode }) => (
  <dl className="tablet:grid-cols-[minmax(7rem,auto)_1fr] grid grid-cols-1 gap-x-4 gap-y-1.5">
    {children}
  </dl>
);

/** A link to a page of the web, with its mark. */
const PageLink = ({
  children,
  icon: Icon,
  to,
}: {
  readonly children: ReactNode;
  readonly icon: typeof FileText;
  readonly to: string;
}) => (
  <AppLink
    className={`text-ui flex w-fit items-center gap-2 font-medium ${LINK}`}
    to={to}
  >
    <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
    {children}
  </AppLink>
);

/** A posture as a mark and its name, in its role. */
const PostureWord = ({ posture }: { readonly posture: Posture }) => (
  <span className="inline-flex items-center gap-1.5">
    <Mark look={POSTURE_MARKS[posture]} size="sm" />
    <code className={CODE}>{posture}</code>
  </span>
);

/** From one value to another, the arrow hidden from a screen reader, which hears "to". */
const FromTo = ({
  from,
  to,
}: {
  readonly from: ReactNode;
  readonly to: ReactNode;
}) => (
  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
    {from}
    <ArrowRight
      aria-hidden="true"
      className="text-muted-foreground size-3.5"
      strokeWidth={1.75}
    />
    <span className="sr-only">to</span>
    {to}
  </span>
);

const CommitLink = ({
  decision,
  sha,
}: {
  readonly decision: Decision;
  readonly sha: string;
}) => (
  <AppLink
    className={`${CODE} ${LINK}`}
    title={sha}
    to={commitHref(decision.project, sha)}
  >
    {shortSha(sha)}
  </AppLink>
);

/** The facts each subject carries in its own fields, typed. */
const SubjectFacts = ({ decision }: { readonly decision: Decision }) =>
  DecisionSubject.match(decision.subject, {
    Finish: ({ ask, head }) => (
      <FactList>
        <FactRow label="Answer">
          <AppLink className={LINK} to={answerPath(decision.project, ask)}>
            The answer to <code className={CODE}>{ask}</code>
          </AppLink>{" "}
          at{" "}
          <code className={CODE} title={head}>
            {shortSha(head)}
          </code>
        </FactRow>
      </FactList>
    ),
    OpenProposal: ({ proposal }) => (
      <PageLink
        icon={FileText}
        to={`/${decision.project}/proposals/${proposal}`}
      >
        Read the draft of {proposal}
      </PageLink>
    ),
    PostureChange: ({ from, to }) => (
      <FactList>
        <FactRow label="Posture">
          <FromTo
            from={<PostureWord posture={from} />}
            to={<PostureWord posture={to} />}
          />
        </FactRow>
        <FactRow label="Ledger">
          <AppLink className={LINK} to={ledgerPath(decision.project)}>
            The ledger of {decision.project}
          </AppLink>
        </FactRow>
      </FactList>
    ),
    ProxyWidened: ({ hosts, item }) => (
      <FactList>
        <FactRow label="Item">
          <code className={`${CODE} text-sealed`}>{item}</code>
        </FactRow>
        <FactRow label="Hosts">
          {hosts.length === 0 ? (
            "more hosts than before"
          ) : (
            <ul className="flex flex-col">
              {hosts.map((host) => (
                <li className={CODE} key={host}>
                  {host}
                </li>
              ))}
            </ul>
          )}
        </FactRow>
      </FactList>
    ),
    RaiseRatchet: ({ after, ask, before, ratchet, territory }) => (
      <FactList>
        <FactRow label="Ratchet">
          <code className={CODE}>{ratchet}</code> in{" "}
          <code className={CODE}>{territory}</code>
        </FactRow>
        <FactRow label="Count">
          <FromTo from={before} to={after} />
        </FactRow>
        <FactRow label="Answer">
          <AppLink className={LINK} to={answerPath(decision.project, ask)}>
            The answer to <code className={CODE}>{ask}</code>
          </AppLink>
        </FactRow>
      </FactList>
    ),
    SecretInTree: ({ ask, item }) => (
      <FactList>
        <FactRow label="Item">
          <AppLink
            className={`${CODE} text-sealed ${LINK}`}
            to={envPath(decision.project)}
          >
            {item}
          </AppLink>
        </FactRow>
        <FactRow label="Answer">
          <AppLink className={LINK} to={answerPath(decision.project, ask)}>
            The answer to <code className={CODE}>{ask}</code>
          </AppLink>
        </FactRow>
      </FactList>
    ),
    StrayPush: ({ after, before, ref }) => (
      <FactList>
        <FactRow label="Ref">
          <code className={CODE}>{refWords(ref)}</code>
        </FactRow>
        <FactRow label="Moved">
          <FromTo
            from={<CommitLink decision={decision} sha={before} />}
            to={<CommitLink decision={decision} sha={after} />}
          />
        </FactRow>
      </FactList>
    ),
    Vouch: ({ handle }) => (
      <FactList>
        <FactRow label="Person">
          <HandleLink handle={handle} />
        </FactRow>
      </FactList>
    ),
    Waiver: ({ ask, at, marker, reason }) => (
      <FactList>
        <FactRow label="Marker">
          <code className={`${CODE} text-waiting font-medium`}>{marker}</code>{" "}
          at{" "}
          <code className={CODE}>
            {at.path}:{at.line}
          </code>
        </FactRow>
        <FactRow label="Reason">{reason}</FactRow>
        <FactRow label="Answer">
          <AppLink className={LINK} to={answerPath(decision.project, ask)}>
            The answer to <code className={CODE}>{ask}</code>
          </AppLink>
        </FactRow>
      </FactList>
    ),
  });

/** A whole commit id in running evidence. */
const WHOLE_SHA = /\b[0-9a-f]{40}\b/u;

/** `text` with each whole commit id cut to its first seven, whole in its title. */
const ShortShas = ({ text }: { readonly text: string }) =>
  text.split(/(?<sha>\b[0-9a-f]{40}\b)/u).map((part, index) =>
    WHOLE_SHA.test(part) ? (
      <code className={CODE} key={`${index}:${part}`} title={part}>
        {shortSha(part)}
      </code>
    ) : (
      part
    )
  );

/** The labels the subject's own facts already say, or the finish draws. */
const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([PATCH_LABEL, FORK_LABEL]);

/** The rest of what the platform put on the decision, as label and value. */
const OtherFacts = ({
  decision,
  files,
}: {
  readonly decision: Decision;
  readonly files: readonly Fact[];
}) => {
  const facts = decision.evidence.filter(
    (fact) => !SHOWN_ELSEWHERE.has(fact.label) && !files.includes(fact)
  );

  return facts.length === 0 ? null : (
    <FactList>
      {facts.map(({ href, label, value }) => (
        <FactRow key={`${label}:${value}`} label={label}>
          {href === undefined ? (
            <ShortShas text={value} />
          ) : (
            <a className={LINK} href={href}>
              {value}
            </a>
          )}
        </FactRow>
      ))}
    </FactList>
  );
};

/** The way from a `Finish` decision to its answer's diff, with how many files it changes. */
export const FinishLink = ({
  decision,
  files,
}: {
  readonly decision: Decision;
  readonly files: number | undefined;
}) => (
  <PageLink
    icon={FileDiff}
    to={`/${decision.project}/decisions/${decision.id}`}
  >
    Read the answer&apos;s diff
    {files === undefined ? "" : ` (${files} ${files === 1 ? "file" : "files"})`}
  </PageLink>
);

/** A decision's evidence: its subject's facts, the rest, and a proposal's files as code. */
export const DecisionEvidence = ({
  decision,
  heading = "h4",
}: {
  readonly decision: Decision;
  /** The heading level a proposal's file paths take. */
  readonly heading?: "h3" | "h4";
}) => {
  const files = filesOf(decision);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-evidence="">
      <SubjectFacts decision={decision} />
      <OtherFacts decision={decision} files={files} />
      {files.map(({ label, value }) => (
        <DraftedCode
          content={value}
          heading={heading}
          key={label}
          path={label}
        />
      ))}
    </div>
  );
};
