/**
 * An ask, as a person reads it: the want as the page's title, the fields
 * (kind, state, territory, check, who asked, its parent, who it is held
 * for), what it waits on, the brief's sections, and the lines that clone
 * the project, claim the ask and check an answer. Agents read the same ask
 * as Markdown (`markdown.ts`); the page links to it and shows the brief
 * verbatim, so a person sees what their agent reads.
 */
import { Brand } from "@repo/brand";
import type { Ask, AskState } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { Circle, CircleDot, Hourglass, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CommandLine } from "../shared/command.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { When } from "../shared/time.tsx";
import { CODE, Field, Fields, LINK, Region } from "./fields.tsx";
import { markdownPath } from "./markdown.ts";

/** An ask's page. */
export const askPath = (project: ProjectName, ask: AskId) =>
  `/${project}/asks/${ask}`;

/** The page of the verdict on an ask's latest answer. */
export const answerPath = (project: ProjectName, ask: AskId) =>
  `/${project}/answers/${ask}`;

/** Each state as a mark, a word and its role colour (none for open: nothing is happening yet). */
const states = {
  claimed: { icon: CircleDot, tone: "", word: "Claimed" },
  closed: { icon: Minus, tone: "text-muted-foreground", word: "Closed" },
  open: { icon: Circle, tone: "", word: "Open" },
  waitingOnParent: {
    icon: Hourglass,
    tone: "text-waiting",
    word: "Waiting on its parent",
  },
} as const satisfies Record<
  AskState,
  { readonly icon: LucideIcon; readonly tone: string; readonly word: string }
>;

const StateMark = ({ state }: { readonly state: AskState }) => {
  const { icon: Icon, tone, word } = states[state];

  return (
    <span className={`font-medium ${tone}`}>
      <Icon
        aria-hidden="true"
        className="mr-1.5 inline-block size-3.5 align-[-0.15em]"
      />
      {word}
    </span>
  );
};

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={CODE}>{children}</code>
);

/** What judges an answer: the check's kind in words, then what it names. */
const checkOf = (check: CheckSpec) =>
  CheckSpec.match(check, {
    LintToZero: ({ rule, territory }) => (
      <>
        Lint to zero: <Code>{rule}</Code>
        {territory === undefined ? null : (
          <>
            {" "}
            in <Code>{territory}</Code>
          </>
        )}
      </>
    ),
    Migrate: ({ from, to }) => (
      <>
        Migrate: <Code>{from}</Code>
        {to === undefined ? null : (
          <>
            {" "}
            to <Code>{to}</Code>
          </>
        )}
      </>
    ),
    Ratchet: ({ ratchet }) => (
      <>
        Ratchet <Code>{ratchet}</Code> goes down
      </>
    ),
    RedThenGreen: ({ path }) => (
      <>
        Red, then green: <Code>{path}</Code>
      </>
    ),
    SymbolAbsent: ({ symbol }) => (
      <>
        Nothing uses <Code>{symbol}</Code>
      </>
    ),
  });

/** Asks, each linking to its page, separated by commas. */
const AskLinks = ({
  asks,
  project,
}: {
  readonly asks: readonly AskId[];
  readonly project: ProjectName;
}) =>
  asks.map((ask, index) => (
    <span key={ask}>
      {index === 0 ? null : ", "}
      <a className={`${LINK} ${CODE}`} href={askPath(project, ask)}>
        {ask}
      </a>
    </span>
  ));

const reserved = {
  newcomers: "Held for newcomers",
  people: "Held for a person to answer, not an agent",
} as const;

const BriefPart = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <h3 className="text-sm font-semibold">{title}</h3>
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

/** The lines that start an answer: clone, claim (it prints the fork's remote), check before the push. */
const TakeIt = ({
  ask,
  platformUrl,
}: {
  readonly ask: Ask;
  readonly platformUrl: string;
}) => {
  if (ask.state === "closed") {
    return (
      <p className="text-muted-foreground text-sm">
        This ask is closed, so it takes no claim.
      </p>
    );
  }

  const steps = [
    ["Clone the project", `git clone ${platformUrl}/${ask.project}.git`],
    [
      "Claim the ask; the claim prints your fork's remote",
      `${Brand.cli} claim ${ask.id} --project ${ask.project}`,
    ],
    [
      "Check your answer before you push it",
      `${Brand.cli} check --ask ${ask.id}`,
    ],
  ] as const;

  return (
    <ol className="flex flex-col gap-3">
      {steps.map(([label, command]) => (
        <li className="flex min-w-0 flex-col gap-1.5" key={command}>
          <span className="text-muted-foreground text-xs font-medium">
            {label}
          </span>
          <CommandLine command={command} />
        </li>
      ))}
    </ol>
  );
};

export const AskView = ({
  ask,
  brief,
  now,
  platformUrl,
}: {
  readonly ask: Ask;
  readonly brief: string;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
}) => {
  const { context, current, outOfScope, terms } = ask.brief;

  return (
    <PageShell title={ask.brief.want}>
      <Fields label="The ask">
        <Field label="Ask">
          <Code>{ask.id}</Code>
        </Field>
        <Field label="State">
          <StateMark state={ask.state} />
        </Field>
        <Field label="Kind">
          <Code>{ask.kind}</Code>
        </Field>
        <Field label="Asked by">
          <HandleLink handle={ask.askedBy} />{" "}
          <span className="text-muted-foreground">
            · opened <When at={ask.openedAt} now={now} />
          </span>
        </Field>
        <Field label="Territory">
          <Code>{ask.territory.module}</Code>
          <span className="text-muted-foreground">: </span>
          {ask.territory.paths.map((path, index) => (
            <span key={path}>
              {index === 0 ? null : ", "}
              <Code>{path}</Code>
            </span>
          ))}
        </Field>
        <Field label="Check">{checkOf(ask.check)}</Field>
        {ask.parent === undefined ? null : (
          <Field label="Step of">
            <AskLinks asks={[ask.parent]} project={ask.project} />
          </Field>
        )}
        {ask.reserve === undefined ? null : (
          <Field label="Who may take it">
            {reserved[ask.reserve]}
            {ask.mentor === undefined ? null : (
              <>
                , mentored by <HandleLink handle={ask.mentor} />
              </>
            )}
          </Field>
        )}
      </Fields>

      {ask.blockedBy.length === 0 ? null : (
        <p className="text-waiting flex items-start gap-2" data-state="waiting">
          <Hourglass aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <span className="text-foreground min-w-0">
            <strong className="text-waiting font-semibold">Waits on</strong>{" "}
            <AskLinks asks={ask.blockedBy} project={ask.project} /> to land
            first; a claim waits until they do.
          </span>
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
        <Region id="ask-brief" title="Brief">
          <div className="flex max-w-[70ch] flex-col gap-5">
            {current === undefined ? null : (
              <BriefPart title="Current behaviour">
                <p>{current}</p>
              </BriefPart>
            )}
            {outOfScope === undefined ? null : (
              <BriefPart title="Out of scope">
                <BriefList items={outOfScope} />
              </BriefPart>
            )}
            {terms === undefined || terms.length === 0 ? null : (
              <BriefPart title="Terms">
                <BriefList items={terms} />
              </BriefPart>
            )}
            {context === undefined || context.length === 0 ? null : (
              <BriefPart title="Context">
                <BriefList items={context} />
              </BriefPart>
            )}
            <details className="border-rule group border-t pt-3">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm select-none">
                The brief, as an agent reads it
              </summary>
              <pre className="border-rule bg-surface mt-3 overflow-x-auto border p-3 font-mono text-[0.8125rem] leading-6 whitespace-pre-wrap">
                {brief}
              </pre>
            </details>
          </div>
        </Region>

        <div className="flex min-w-0 flex-col gap-8">
          <Region id="ask-take" title="Take it">
            <TakeIt ask={ask} platformUrl={platformUrl} />
          </Region>
          <Region id="ask-more" title="See also">
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>
                <a className={LINK} href={answerPath(ask.project, ask.id)}>
                  Where the latest answer stands
                </a>
              </li>
              <li>
                <a
                  className={LINK}
                  href={markdownPath(ask.project, ask.id)}
                  type="text/markdown"
                >
                  This ask as Markdown
                </a>
                <span className="text-muted-foreground">
                  , for an agent to fetch
                </span>
              </li>
            </ul>
          </Region>
        </div>
      </div>
    </PageShell>
  );
};
