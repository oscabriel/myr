import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { Posture } from "@repo/protocol/posture";
import { ArrowRight, FileDiff } from "lucide-react";
import type { ReactNode } from "react";

import { commitHref, shortSha } from "../code/paths.ts";
import { FORK_LABEL, PATCH_LABEL } from "../finish/patch.ts";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { POSTURE_MARKS } from "../shared/mark-look.ts";
import { Mark } from "../shared/marks.tsx";
import {
  answerPath,
  ENVIRONMENT_ANCHOR,
  LEDGER_ANCHOR,
  visibilityPath,
} from "../shared/paths.ts";
import { refWords } from "./subject.ts";

const LINK = "decoration-rule underline hover:decoration-current";

const CODE = "text-mono font-mono [overflow-wrap:anywhere]";

const FactRow = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <div className="contents">
    {/* Sentence case: the platform names some evidence in lower case. */}
    <dt className="text-label text-muted-foreground pt-0.5 first-letter:uppercase">
      {label}
    </dt>
    <dd className="text-ui mb-1.5 min-w-0 [overflow-wrap:anywhere] @lg:mb-0">
      {children}
    </dd>
  </div>
);

const FactList = ({ children }: { readonly children: ReactNode }) => (
  <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 @lg:grid-cols-[minmax(7rem,auto)_1fr]">
    {children}
  </dl>
);

const PageLink = ({
  children,
  icon: Icon,
  to,
}: {
  readonly children: ReactNode;
  readonly icon: typeof FileDiff;
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

const PostureWord = ({ posture }: { readonly posture: Posture }) => (
  <span className="inline-flex items-center gap-1.5">
    <Mark look={POSTURE_MARKS[posture]} size="sm" />
    <code className={CODE}>{posture}</code>
  </span>
);

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
    PostureChange: ({ from, to }) => (
      <FactList>
        <FactRow label="Posture">
          <FromTo
            from={<PostureWord posture={from} />}
            to={<PostureWord posture={to} />}
          />
        </FactRow>
        <FactRow label="Ledger">
          <AppLink
            className={LINK}
            hash={LEDGER_ANCHOR}
            to={visibilityPath(decision.project)}
          >
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
            hash={ENVIRONMENT_ANCHOR}
            to={visibilityPath(decision.project)}
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

const WHOLE_SHA = /\b[0-9a-f]{40}\b/u;

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

const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([
  PATCH_LABEL,
  FORK_LABEL,
  "escape",
  "ratchet",
]);

const OtherFacts = ({ decision }: { readonly decision: Decision }) => {
  const facts = decision.evidence.filter(
    (fact) => !SHOWN_ELSEWHERE.has(fact.label)
  );

  return facts.length === 0 ? null : (
    <FactList>
      {facts.map(({ href, label, value }) => (
        <FactRow
          key={`${label}:${value}`}
          label={label === "answer" ? "Pushed by" : label}
        >
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

export const DecisionEvidence = ({
  decision,
}: {
  readonly decision: Decision;
}) => (
  <div className="@container flex min-w-0 flex-col gap-3" data-evidence="">
    <SubjectFacts decision={decision} />
    <OtherFacts decision={decision} />
  </div>
);
