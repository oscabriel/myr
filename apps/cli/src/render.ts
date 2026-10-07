/**
 * The CLI's prose for the contracts' results: Markdown for an agent (and a
 * script), and plain text for a person where a table reads better padded.
 * A contract without a view here prints its encoded JSON in a fenced block.
 */
import { Brand } from "@repo/brand";
import type { View } from "@repo/protocol/cli";
import {
  Claim,
  Credits,
  Finish,
  FrontPage,
  LedgerOf,
  ListAsks,
  ListProjects,
  ShowAsk,
  Status,
  SubmitAnswer,
  TodayOf,
  VerdictOf,
} from "@repo/protocol/contracts";
import type { Contract } from "@repo/protocol/contracts";
import { LandReceipt } from "@repo/protocol/domain/answer";
import type { AnswerReceipt } from "@repo/protocol/domain/answer";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Refusal } from "@repo/protocol/refusal";
import { receiptLine } from "@repo/protocol/render";
import { DateTime, Option, Result, Schema } from "effect";
import type { Rpc } from "effect/rpc";

const short = (sha: string) => sha.slice(0, 7);

const when = (at: DateTime.Utc) => DateTime.formatIso(at);

const yesNo = (value: boolean) => (value ? "yes" : "no");

/** A cell's text, safe inside a Markdown table row. */
const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/gu, " ");

/**
 * Rows as a Markdown table, and as a padded plain table for a person.
 * `empty` stands in for both when there are no rows.
 */
const table = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  empty: string
): View => {
  if (rows.length === 0) {
    return { markdown: empty, text: empty };
  }

  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length))
  );

  const padded = (row: readonly string[]) =>
    row
      .map((text, column) => text.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return {
    markdown: [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    ].join("\n"),
    text: [
      padded(headers.map((header) => header.toUpperCase())),
      ...rows.map(padded),
    ].join("\n"),
  };
};

/** Views one after another, as sections. */
const joined = (...parts: readonly View[]): View => ({
  markdown: parts.map(({ markdown }) => markdown).join("\n\n"),
  text: parts.map(({ markdown, text }) => text ?? markdown).join("\n\n"),
});

/** The same words for every reader. */
const prose = (text: string): View => ({ markdown: text });

/** Where an answer stands, in a few words. */
const outcomeText = (outcome: Outcome) =>
  Outcome.match(outcome, {
    AwaitingDecision: ({ decision }) => `waits on decision ${decision}`,
    AwaitingFinish: () => "passed; waits for a decider's finish",
    Checking: ({ stage }) => `checking (${stage})`,
    Landed: ({ sha }) => `landed as ${short(sha)}`,
    Refused: ({ refusals }) =>
      `refused: ${refusals.map((refusal) => refusal._tag).join(", ")}`,
    WaitingOnParent: ({ ask }) => `passed; waits for ${ask} to land`,
  });

/** What a decision is about, in a few words. */
const subjectText = (subject: DecisionSubject) =>
  DecisionSubject.match(subject, {
    Finish: ({ ask, head }) => `finish the answer to ${ask} at ${short(head)}`,
    OpenProposal: ({ proposal }) =>
      `open the ask proposal ${proposal} asks for`,
    PostureChange: ({ from, to }) => `change the posture from ${from} to ${to}`,
    ProxyWidened: ({ hosts, item }) =>
      `let ${item}'s placeholder reach ${hosts.join(", ")}`,
    RaiseRatchet: ({ after, before, ratchet, territory }) =>
      `raise the ${ratchet} ratchet in ${territory} from ${before} to ${after}`,
    SecretInTree: ({ ask, item }) =>
      `${item}'s write-only value showed up in an answer to ${ask}`,
    StrayPush: ({ after, before, ref }) =>
      `${ref} moved from ${short(before)} to ${short(after)} without a landing`,
    Vouch: ({ handle }) => `vouch for ${handle}`,
    Waiver: ({ at, marker, reason }) =>
      `allow ${marker} at ${at.path}:${at.line} ("${reason}")`,
  });

/** One ledger entry, in a few words. */
const entryText = (entry: LedgerEntry) =>
  LedgerEntry.match(entry, {
    Admitted: ({ area, knownBadCaught, mainRuns, suite }) =>
      `held-back suite ${suite} admitted in ${area} after ${mainRuns} runs on main, catching ${knownBadCaught} known-bad trees`,
    CommitmentPublished: ({ area, authors, checks, suite }) =>
      `commitment ${suite} published for ${area}: ${checks} checks by ${authors} authors`,
    CountChanged: ({ area, count, layer }) =>
      `${layer} holds ${count} in ${area}`,
    LayerDeclared: ({ disclose, kinds, layer }) =>
      `layer ${layer} declared, holding ${kinds.join(", ")}, disclosing ${disclose}`,
    PostureChanged: ({ decision, from, to }) =>
      `posture changed from ${from} to ${to} by decision ${decision}`,
    Released: ({ by, landing, layer, paths }) =>
      `${by} released ${paths} paths from ${layer} in ${short(landing)}`,
    ValueSet: ({ by, key }) => `${by} set the write-only value of ${key}`,
  });

/** A view that renders a success it can read, and none for anything else. */
const viewOf = <S extends Schema.Top>(
  schema: S,
  render: (success: S["Type"]) => View
) => {
  const is = Schema.is(schema);

  return (success: Rpc.Success<Contract>): Option.Option<View> =>
    is(success) ? Option.some(render(success)) : Option.none();
};

const asks = viewOf(ListAsks.successSchema, ({ asks: listed }) =>
  joined(
    table(
      ["ask", "kind", "territory", "want", "claimed"],
      listed.map(
        ({ ask, blockedBy, claimed, kind, reserve, territory, want }) => [
          ask,
          reserve === undefined ? kind : `${kind} (for ${reserve})`,
          territory,
          blockedBy.length === 0
            ? want
            : `${want} (waits on ${blockedBy.join(", ")})`,
          yesNo(claimed),
        ]
      ),
      "No open asks."
    ),
    prose(
      `Read one with \`${Brand.cli} ask <ask>\`; take one with \`${Brand.cli} claim <ask>\`.`
    )
  )
);

const ask = viewOf(ShowAsk.successSchema, ({ brief }) => prose(brief));

const claim = viewOf(Claim.successSchema, ({ claim: held }) => {
  const steps = [
    `git remote add ${Brand.slug} ${held.remote}`,
    `${Brand.cli} check`,
    `git push ${Brand.slug} HEAD:main`,
  ];

  return {
    markdown: [
      `You hold the claim on \`${held.ask}\` in ${held.project} until ${when(held.lapsesAt)}; only a push keeps it alive.`,
      "",
      `Its fork: ${held.remote}`,
      "",
      "Next:",
      "",
      "```sh",
      ...steps,
      "```",
      "",
      `\`${Brand.cli} check\` runs \`${held.checkCommand}\` and the gate's checks locally, before you push.`,
    ].join("\n"),
    text: [
      `You hold the claim on ${held.ask} in ${held.project} until ${when(held.lapsesAt)}; only a push keeps it alive.`,
      `Its fork: ${held.remote}`,
      "Next:",
      ...steps.map((step) => `  ${step}`),
    ].join("\n"),
  };
});

const status = viewOf(Status.successSchema, ({ answers, claims }) =>
  joined(
    prose("Claims:"),
    table(
      ["ask", "project", "state", "lapses", "fork"],
      claims.map((held) => [
        held.ask,
        held.project,
        held.state,
        when(held.lapsesAt),
        held.remote,
      ]),
      "No claims."
    ),
    prose("Answers:"),
    table(
      ["ask", "head", "outcome", "at"],
      answers.map((answer) => [
        answer.ask,
        short(answer.head),
        outcomeText(answer.outcome),
        when(answer.at),
      ]),
      "No answers."
    )
  )
);

const verdict = viewOf(VerdictOf.successSchema, ({ verdict: found }) => {
  if (found === undefined) {
    return prose("No verdict yet.");
  }

  return joined(
    prose(
      `${found.ask} at ${short(found.head)}: ${outcomeText(found.outcome)} (furthest stage: ${found.stage}).`
    ),
    table(
      ["lane", "result", "command", "ms"],
      found.lanes.map((lane) => [
        lane.lane,
        lane.result,
        lane.command,
        String(lane.durationMs),
      ]),
      "No lanes ran."
    ),
    ...(found.heldBack.length === 0
      ? []
      : [
          table(
            ["area", "held back", "suite"],
            found.heldBack.map((area) => [
              area.area,
              `${area.passed}/${area.total}`,
              area.suite,
            ]),
            ""
          ),
        ])
  );
});

const today = viewOf(TodayOf.successSchema, (page) =>
  joined(
    prose(
      `Today for ${page.decider}: ${page.budget.used} of ${page.budget.total} decisions used${page.overflow === 0 ? "" : `; ${page.overflow} more wait beyond the budget`}.`
    ),
    table(
      ["decision", "project", "about", "default", "expires"],
      page.decisions.map((decision) => [
        decision.id,
        decision.project,
        subjectText(decision.subject),
        decision.default,
        when(decision.expiresAt),
      ]),
      "Nothing to decide."
    ),
    ...(page.decisions.length === 0
      ? []
      : [
          prose(
            `Take one with \`${Brand.cli} decide --project <project> --decision <decision> --choice <choice> --yes\`.`
          ),
        ])
  )
);

const ledger = viewOf(LedgerOf.successSchema, (book) =>
  joined(
    prose(`${book.project}: ${book.postureLabel}.`),
    table(
      ["#", "at", "entry"],
      book.entries.map((entry) => [
        String(entry.seq),
        when(entry.at),
        entryText(entry),
      ]),
      "The ledger is empty."
    )
  )
);

const credits = viewOf(Credits.successSchema, ({ credits: counted }) =>
  table(
    ["project", "area", "role", "count"],
    counted.map((credit) => [
      credit.project,
      credit.area,
      credit.role,
      String(credit.count),
    ]),
    "No credits yet."
  )
);

const projects = viewOf(ListProjects.successSchema, ({ projects: listed }) =>
  table(
    ["project", "posture", "open asks", "landed"],
    listed.map((listing) => [
      listing.project,
      listing.posture,
      String(listing.openAsks),
      listing.landedAt === undefined ? "never" : when(listing.landedAt),
    ]),
    "No projects yet."
  )
);

const front = viewOf(FrontPage.successSchema, ({ entries }) =>
  table(
    ["project", "ask", "kind", "want", "takeable"],
    entries.map((entry) => [
      entry.project,
      entry.ask.ask,
      entry.ask.kind,
      entry.ask.want,
      yesNo(entry.takeable),
    ]),
    "No open asks anywhere."
  )
);

/**
 * Where an offered answer stands, in the line git's `remote:` output gives a
 * push of the same answer. A refused one never reaches its view: its
 * refusals print as refusals (`refusalsIn`).
 */
const receipt = (offered: AnswerReceipt) =>
  prose(
    Result.getOrElse(receiptLine(offered), () => `${offered.ask} was refused`)
  );

const submitted = viewOf(SubmitAnswer.successSchema, receipt);

const finished = viewOf(Finish.successSchema, receipt);

/** Any receipt: an answer's (`submit`, `finish`) has a landing's fields too. */
const isReceipt = Schema.is(LandReceipt);

/**
 * The refusals a contract's success carries in place of a result: a refused
 * receipt's (`finish` and `land` refuse at stages 0–1 that way, and `submit`
 * gives a refused request's receipt back again). The command prints them as
 * refusals, once, and exits 1.
 */
export const refusalsIn = (
  success: Rpc.Success<Contract>
): readonly Refusal[] =>
  isReceipt(success) && Outcome.guards.Refused(success.outcome)
    ? success.outcome.refusals
    : [];

/** Each contract's view, by tag. */
export const views = {
  claim,
  credits,
  finish: finished,
  frontPage: front,
  ledger,
  listAsks: asks,
  listProjects: projects,
  showAsk: ask,
  status,
  submitAnswer: submitted,
  today,
  verdict,
} as const satisfies Readonly<
  Partial<
    Record<
      Contract["_tag"],
      (success: Rpc.Success<Contract>) => Option.Option<View>
    >
  >
>;
