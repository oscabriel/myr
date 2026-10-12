/**
 * Waiting is never drawn in the refused role, and a refusal is named by its
 * tag, never paraphrased.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { headline } from "@repo/protocol/render";
import { DateTime, Match } from "effect";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { commitHref, shortSha } from "../code/paths.ts";
import { whoseMove } from "./ask-progress.ts";
import type { Family, Move } from "./ask-progress.ts";
import { CommandChip } from "./copy-action.tsx";
import { HandleLink } from "./handle.tsx";
import { AppLink } from "./link.tsx";
import { StateMarkIcon } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";
import { askPath, decisionPath } from "./paths.ts";
import { distanceInWords } from "./time.tsx";

export const stageNames = Match.type<StageName>().pipe(
  Match.when("parse", () => ({ label: "Parse", words: "parse" })),
  Match.when("shape", () => ({ label: "Shape", words: "shape" })),
  Match.when("merge", () => ({ label: "Merge", words: "merge" })),
  Match.when("cheap", () => ({ label: "Cheap", words: "cheap checks" })),
  Match.when("checks", () => ({ label: "Checks", words: "checks" })),
  Match.when("heldBack", () => ({
    label: "Held-back",
    words: "held-back checks",
  })),
  Match.when("human", () => ({ label: "Maintainer", words: "maintainer" })),
  Match.exhaustive
);

export type StatusSubject =
  | {
      readonly kind: "answer";
      readonly outcome: Outcome;
      readonly claimant?: Handle | undefined;
      readonly stage?: StageName | undefined;
      readonly project?: ProjectName | undefined;
    }
  | {
      readonly kind: "ask";
      readonly ask: Ask;
      readonly takeable: boolean;
      readonly claimant?: Handle | undefined;
      readonly latest?: Outcome | undefined;
      readonly blockers?: Family | undefined;
    }
  | {
      readonly kind: "decision";
      readonly decision: Decision;
      readonly now: DateTime.Utc;
      readonly viewerDecides: boolean;
    }
  | { readonly kind: "proposal"; readonly proposal: Proposal };

export type StatusTone =
  | "checking"
  | "ink"
  | "landed"
  | "muted"
  | "refused"
  | "waiting";

const leadTone = {
  checking: "text-checking",
  ink: "text-foreground",
  landed: "text-landed",
  muted: "text-foreground",
  refused: "text-refused",
  waiting: "text-waiting",
} as const satisfies Record<StatusTone, string>;

interface Reading {
  readonly mark: StateMark;
  readonly tone: StatusTone;
  readonly lead: string;
  readonly rest?: ReactNode;
  readonly after: readonly string[];
  readonly next?: string;
}

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono [overflow-wrap:anywhere]">
    {children}
  </code>
);

const CodeLink = ({
  children,
  to,
}: {
  readonly children: ReactNode;
  readonly to: string | undefined;
}) =>
  to === undefined ? (
    <Code>{children}</Code>
  ) : (
    <AppLink
      className="decoration-rule text-mono font-mono underline hover:decoration-current"
      to={to}
    >
      {children}
    </AppLink>
  );

const moveWords = (
  move: Move,
  {
    claimant,
    decider,
  }: {
    readonly claimant?: Handle | undefined;
    readonly decider?: Handle | undefined;
  }
): readonly string[] =>
  Match.value(move).pipe(
    Match.when("answerer", () => [
      claimant === undefined ? "the answerer's move" : `${claimant}'s move`,
    ]),
    Match.when("decider", () => [
      decider === undefined ? "a maintainer's move" : `${decider}'s move`,
    ]),
    Match.when("platform", () => ["the platform's move"]),
    Match.when("parent", () => ["that ask's move"]),
    Match.when("none", () => []),
    Match.exhaustive
  );

const answerReading = ({
  claimant,
  outcome,
  project,
  stage,
}: {
  readonly claimant?: Handle | undefined;
  readonly outcome: Outcome;
  readonly project?: ProjectName | undefined;
  readonly stage?: StageName | undefined;
}): Reading => {
  const after = (decider?: Handle) =>
    moveWords(whoseMove(outcome, claimant), { claimant, decider });

  return Outcome.match(outcome, {
    AwaitingDecision: ({ decision }): Reading => ({
      after: after(),
      lead: "Waiting",
      mark: "waiting",
      rest: (
        <>
          {" "}
          on decision{" "}
          <CodeLink
            to={
              project === undefined
                ? undefined
                : decisionPath(project, decision)
            }
          >
            {decision}
          </CodeLink>
        </>
      ),
      tone: "waiting",
    }),
    AwaitingFinish: ({ decider }): Reading => ({
      after: after(decider),
      lead: "Passed",
      mark: "waiting",
      rest: (
        <>
          , waiting for a maintainer&apos;s finish
          {decider === undefined ? null : (
            <>
              {" "}
              from <HandleLink handle={decider} />
            </>
          )}
        </>
      ),
      tone: "waiting",
    }),
    Checking: ({ stage: at }): Reading => ({
      after: after(),
      lead: "Checking",
      mark: "checking",
      rest: (
        <>
          {" at the "}
          <span data-term="">{stageNames(at).words}</span>
          {" stage"}
        </>
      ),
      tone: "checking",
    }),
    Landed: ({ sha }): Reading => ({
      after: [],
      lead: "Landed",
      mark: "landed",
      rest: (
        <>
          {" "}
          as{" "}
          <CodeLink
            to={project === undefined ? undefined : commitHref(project, sha)}
          >
            {shortSha(sha)}
          </CodeLink>
        </>
      ),
      tone: "landed",
    }),
    Refused: ({ refusals }): Reading => ({
      after: after(),
      lead: "Refused",
      mark: refusals[0].retryable ? "retry" : "refused",
      next: refusals[0].next,
      rest: (
        <>
          {stage === undefined ? (
            ": "
          ) : (
            <>
              {" at "}
              <span data-term="">{stageNames(stage).label}</span>
              {": "}
            </>
          )}
          <Code>{headline(refusals)}</Code>
        </>
      ),
      tone: "refused",
    }),
    WaitingOnParent: ({ ask }): Reading => ({
      after: after(),
      lead: "Passed",
      mark: "waiting",
      rest: (
        <>
          , waiting for{" "}
          <CodeLink
            to={project === undefined ? undefined : askPath(project, ask)}
          >
            {ask}
          </CodeLink>{" "}
          to land first
        </>
      ),
      tone: "waiting",
    }),
  });
};

const heldFor = (ask: Ask): readonly string[] => {
  if (ask.reserve === "newcomers") {
    return [
      ask.mentor === undefined
        ? "held for newcomers"
        : `held for newcomers, mentored by ${ask.mentor}`,
    ];
  }

  return ask.reserve === "people" ? ["held for people, not agents"] : [];
};

const waitingReading = (ask: Ask, blockers: Family | undefined): Reading => {
  if (blockers !== undefined && blockers.total > 0) {
    const remaining = blockers.total - blockers.landed;

    return remaining === 0
      ? {
          after: ["the platform's move"],
          lead: "Waiting",
          mark: "waiting",
          rest: ` to open: all ${blockers.total} children landed`,
          tone: "waiting",
        }
      : {
          after: ["the family's move"],
          lead: "Waiting",
          mark: "waiting",
          rest: ` for ${remaining} of ${blockers.total} ${
            blockers.total === 1 ? "child" : "children"
          } to land`,
          tone: "waiting",
        };
  }

  return {
    after: ["the family's move"],
    lead: "Waiting",
    mark: "waiting",
    rest:
      ask.blockedBy.length === 0 && ask.parent !== undefined ? (
        <>
          {" "}
          for{" "}
          <CodeLink to={askPath(ask.project, ask.parent)}>
            {ask.parent}
          </CodeLink>{" "}
          to land first
        </>
      ) : (
        " for the asks it waits on to land"
      ),
    tone: "waiting",
  };
};

const askReading = ({
  ask,
  blockers,
  claimant,
  latest,
  takeable,
}: Extract<StatusSubject, { readonly kind: "ask" }>): Reading => {
  if (latest !== undefined && Outcome.isAnyOf(["Landed"])(latest)) {
    return answerReading({ outcome: latest, project: ask.project });
  }

  if (ask.state === "closed") {
    return { after: [], lead: "Closed", mark: "notNeeded", tone: "ink" };
  }

  if (ask.state === "waitingOnParent") {
    return waitingReading(ask, blockers);
  }

  if (latest !== undefined) {
    return answerReading({ claimant, outcome: latest, project: ask.project });
  }

  if (ask.state === "claimed" || claimant !== undefined) {
    return {
      after: moveWords("answerer", { claimant }),
      lead: "Claimed",
      mark: "claimed",
      rest: (
        <>
          {claimant === undefined ? null : (
            <>
              {" "}
              by <HandleLink handle={claimant} />
            </>
          )}
          , no answer pushed yet
        </>
      ),
      tone: "ink",
    };
  }

  return !takeable && ask.blockedBy.length > 0
    ? { after: [], lead: "Waiting", mark: "waiting", tone: "waiting" }
    : {
        after: heldFor(ask),
        lead: takeable ? "Open to take" : "Open",
        mark: "open",
        tone: "muted",
      };
};

const chosen = {
  accept: { effect: true, word: "Accepted" },
  adopt: { effect: true, word: "Adopted" },
  decline: { effect: false, word: "Declined" },
  revert: { effect: true, word: "Reverted" },
} as const satisfies Record<
  Choice,
  { readonly effect: boolean; readonly word: string }
>;

const deciderMove = (decision: Decision, viewerDecides: boolean) => {
  if (viewerDecides) {
    return "your move";
  }

  const [only, ...others] = decision.deciders;

  return others.length === 0 ? `${only}'s move` : "a maintainer's move";
};

const decisionReading = ({
  decision,
  now,
  viewerDecides,
}: Extract<StatusSubject, { readonly kind: "decision" }>): Reading => {
  if (decision.decided !== undefined) {
    const { at, by, choice } = decision.decided;
    const { effect, word } = chosen[choice];

    return {
      after: [distanceInWords(at, now)],
      lead: word,
      mark: effect ? "landed" : "notNeeded",
      rest: (
        <>
          {" "}
          by <HandleLink handle={by} />
        </>
      ),
      tone: effect ? "landed" : "ink",
    };
  }

  const fallback = `default: ${decision.default}`;

  if (DateTime.isLessThanOrEqualTo(decision.expiresAt, now)) {
    return {
      after: [`the default applies: ${decision.default}`],
      lead: "Expired",
      mark: "default",
      rest: ` ${distanceInWords(decision.expiresAt, now)}`,
      tone: "ink",
    };
  }

  return {
    after: [fallback, deciderMove(decision, viewerDecides)],
    lead: "Expires",
    mark: "waiting",
    rest: ` ${distanceInWords(decision.expiresAt, now)}`,
    tone: "waiting",
  };
};

const proposalReading = (proposal: Proposal): Reading => {
  if (proposal.state === "accepted") {
    return { after: [], lead: "Accepted", mark: "landed", tone: "landed" };
  }

  if (proposal.state === "declined") {
    return { after: [], lead: "Declined", mark: "notNeeded", tone: "ink" };
  }

  if (proposal.state === "expired") {
    return { after: [], lead: "Expired", mark: "notNeeded", tone: "ink" };
  }

  const waiting: Reading = {
    after: ["a maintainer's move"],
    lead: "Waiting",
    mark: "waiting",
    rest: " for a maintainer to open it or decline it",
    tone: "waiting",
  };

  return proposal.draft === undefined
    ? waiting
    : DraftState.match(proposal.draft, {
        Drafting: ({ round }): Reading => ({
          after: ["the platform's move"],
          lead: "Drafting",
          mark: "checking",
          rest: round > 1 ? `, round ${round}` : undefined,
          tone: "checking",
        }),
        Failed: ({ attempts, refusal }): Reading => ({
          after: [],
          lead: "The draft failed",
          mark: "failed",
          rest: (
            <>
              {" "}
              after {attempts} {attempts === 1 ? "attempt" : "attempts"}:{" "}
              <Code>{refusal}</Code>
            </>
          ),
          tone: "ink",
        }),
        Ready: (): Reading => ({
          after: ["a maintainer's move"],
          lead: "Ready",
          mark: "waiting",
          rest: ", waits for a maintainer",
          tone: "waiting",
        }),
      });
};

export const readStatus: (subject: StatusSubject) => Reading =
  Match.type<StatusSubject>().pipe(
    Match.discriminator("kind")("answer", answerReading),
    Match.discriminator("kind")("ask", askReading),
    Match.discriminator("kind")("decision", decisionReading),
    Match.discriminator("kind")("proposal", ({ proposal }) =>
      proposalReading(proposal)
    ),
    Match.exhaustive
  );

const SIZE = {
  body: { line: "text-want", mark: "mt-1" },
  title: { line: "text-title", mark: "mt-[0.3rem]" },
} as const;

export interface StatusLineProps {
  readonly subject: StatusSubject;
  readonly command?: string | false;
  readonly compact?: boolean;
  readonly size?: keyof typeof SIZE;
  readonly stamp?: boolean;
}

export const StatusLine = ({
  command,
  compact = false,
  size = "body",
  stamp = false,
  subject,
}: StatusLineProps) => {
  const reading = readStatus(subject);
  const next = command === false ? undefined : (command ?? reading.next);

  if (compact) {
    return (
      <span
        className="text-ui inline-flex min-w-0 items-center gap-1.5"
        data-mark={reading.mark}
        data-tone={reading.tone}
      >
        <StateMarkIcon mark={reading.mark} stamp={stamp} />
        <strong className={`font-semibold ${leadTone[reading.tone]}`}>
          {reading.lead}
        </strong>
      </span>
    );
  }

  return (
    <p
      className={`flex min-w-0 items-start gap-2 ${SIZE[size].line}`}
      data-mark={reading.mark}
      data-tone={reading.tone}
    >
      <StateMarkIcon
        className={SIZE[size].mark}
        mark={reading.mark}
        stamp={stamp}
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <strong className={`font-semibold ${leadTone[reading.tone]}`}>
          {reading.lead}
        </strong>
        {reading.rest}
        {reading.after.map((part) => (
          <Fragment key={part}>
            <span aria-hidden="true" className="text-muted-foreground">
              {" · "}
            </span>
            <span className="text-muted-foreground">{part}</span>
          </Fragment>
        ))}
        {next === undefined ? null : (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {" · "}
            </span>
            <CommandChip command={next} />
          </>
        )}
      </span>
    </p>
  );
};
