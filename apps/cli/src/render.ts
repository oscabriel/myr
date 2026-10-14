import { IMPORTED_NOTE } from "@repo/agent-kit/docs/imported-note";
import { Brand } from "@repo/brand";
import type { View } from "@repo/protocol/cli";
import {
  Claim,
  Credits,
  Finish,
  FrontPage,
  LedgerOf,
  ListAsks,
  ListDiscussions,
  ListProjects,
  PolicyOf,
  PostDiscussion,
  ShowAsk,
  ShowDiscussion,
  Status,
  SubmitAnswer,
  TodayOf,
  VerdictOf,
  WhoAmI,
} from "@repo/protocol/contracts";
import type { Contract } from "@repo/protocol/contracts";
import { LandReceipt } from "@repo/protocol/domain/answer";
import type { AnswerReceipt } from "@repo/protocol/domain/answer";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Discussion } from "@repo/protocol/domain/discussion";
import { Outcome } from "@repo/protocol/domain/outcome";
import type {
  ImportSource,
  PolicyPending,
  PublicPolicy,
} from "@repo/protocol/domain/policy";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Refusal } from "@repo/protocol/refusal";
import { receiptLine } from "@repo/protocol/render";
import { DateTime, Option, Result, Schema } from "effect";
import type { Rpc } from "effect/rpc";

import { parseRemote, parseRepoName } from "./repo-context.ts";
import type { Remote } from "./repo-context.ts";

const short = (sha: string) => sha.slice(0, 7);

const when = (at: DateTime.Utc) => DateTime.formatIso(at);

const yesNo = (value: boolean) => (value ? "yes" : "no");

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/gu, " ");

const codeSpan = (text: string) => {
  const longest = Math.max(
    0,
    ...(text.match(/`+/gu) ?? []).map((run) => run.length)
  );

  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
};

/** Columns in `code` hold literal text (a glob, a path), shown as code so `**` never reads as emphasis. */
const table = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  empty: string,
  code: readonly number[] = []
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
      ...rows.map(
        (row) =>
          `| ${row
            .map((text, column) =>
              code.includes(column) ? cell(codeSpan(text)) : cell(text)
            )
            .join(" | ")} |`
      ),
    ].join("\n"),
    text: [
      padded(headers.map((header) => header.toUpperCase())),
      ...rows.map(padded),
    ].join("\n"),
  };
};

const fields = (rows: readonly (readonly [string, string])[]): View => {
  const width = Math.max(0, ...rows.map(([label]) => label.length));

  return {
    markdown: rows.map(([label, value]) => `- ${label}: ${value}`).join("\n"),
    text: rows
      .map(([label, value]) => `${label.padEnd(width)}  ${value}`)
      .join("\n"),
  };
};

const joined = (...parts: readonly View[]): View => ({
  markdown: parts.map(({ markdown }) => markdown).join("\n\n"),
  text: parts.map(({ markdown, text }) => text ?? markdown).join("\n\n"),
});

const prose = (text: string): View => ({ markdown: text });

const outcomeText = (outcome: Outcome) =>
  Outcome.match(outcome, {
    AwaitingDecision: ({ decision }) => `waits on decision ${decision}`,
    AwaitingFinish: () => "passed; waits for a maintainer's finish",
    Checking: ({ stage }) => `checking (${stage})`,
    Landed: ({ sha }) => `landed as ${short(sha)}`,
    Refused: ({ refusals }) =>
      `refused: ${refusals.map((refusal) => refusal._tag).join(", ")}`,
    WaitingOnParent: ({ ask }) => `passed; waits for ${ask} to land`,
  });

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

const discussionStates = {
  closed: "closed",
  open: "open",
  proposed: "became a proposal",
} as const satisfies Record<Discussion["state"], string>;

const discussions = viewOf(
  ListDiscussions.successSchema,
  ({ discussions: listed }) =>
    joined(
      table(
        ["discussion", "title", "opener", "posts", "last post", "state"],
        listed.map(
          ({ id, lastPostAt, opener, posts, proposal, state, title }) => [
            id,
            title,
            opener,
            String(posts),
            when(lastPostAt),
            proposal === undefined
              ? discussionStates[state]
              : `${discussionStates[state]} ${proposal}`,
          ]
        ),
        "No discussions yet."
      ),
      prose(
        `Read one with \`${Brand.cli} discussion <discussion>\`; open one with \`${Brand.cli} discussion post --title "<title>" --body "<post>"\`.`
      )
    )
);

const onward = (discussion: Discussion) => {
  if (discussion.state === "open") {
    return `Reply with \`${Brand.cli} discussion post ${discussion.id} --body "<post>"\`.`;
  }

  return discussion.proposal === undefined
    ? "This discussion is closed."
    : `This discussion became ${discussion.proposal}: read it with \`${Brand.cli} proposal ${discussion.proposal}\`.`;
};

const thread = (discussion: Discussion): View =>
  joined(
    prose(`# ${discussion.title}`),
    fields([
      ["Discussion", discussion.id],
      ["Opened by", `${discussion.opener} at ${when(discussion.openedAt)}`],
      [
        "State",
        discussion.proposal === undefined
          ? discussionStates[discussion.state]
          : `${discussionStates[discussion.state]} ${discussion.proposal}`,
      ],
    ]),
    ...discussion.posts.map(({ at, body, by }) =>
      prose(`**${by}** at ${when(at)}\n\n${body}`)
    ),
    prose(onward(discussion))
  );

const discussion = viewOf(
  ShowDiscussion.successSchema,
  ({ discussion: shown }) => thread(shown)
);

const posted = viewOf(PostDiscussion.successSchema, ({ discussion: shown }) =>
  thread(shown)
);

/** Where the receipt is read: in a clone of the project or not, and what the fork's remote may be called. */
export interface Place {
  readonly inClone: boolean;
  readonly remoteName: string;
  /** False when a remote of that name already points at the fork. */
  readonly addRemote: boolean;
}

const sameProject = (held: ClaimView, url: string) =>
  Option.exists(parseRemote(url), ({ repo }) =>
    Option.exists(parseRepoName(repo), (ref) => ref.project === held.project)
  );

/** Outside a repo, `remotes` is empty, so the receipt starts with a clone. */
export const placeOf = (held: ClaimView, remotes: readonly Remote[]): Place => {
  const named = remotes.find(({ name }) => name === Brand.slug);

  if (named === undefined) {
    return {
      addRemote: true,
      inClone: remotes.some(({ url }) => sameProject(held, url)),
      remoteName: Brand.slug,
    };
  }

  return named.url === held.remote
    ? { addRemote: false, inClone: true, remoteName: Brand.slug }
    : {
        addRemote: true,
        inClone: remotes.some(({ url }) => sameProject(held, url)),
        remoteName: `${Brand.slug}-${held.ask}`,
      };
};

const cloneOf = (held: ClaimView) =>
  Option.map(parseRemote(held.remote), ({ origin, repo }) => {
    const [canonical = repo] = repo.split("--");
    const folder = canonical.slice(canonical.lastIndexOf("/") + 1);

    return `git clone ${origin}/${canonical}.git && cd ${folder}`;
  });

export const claimReceipt = (held: ClaimView, place: Place): View => {
  const steps = [
    ...(place.inClone ? [] : Option.toArray(cloneOf(held))),
    ...(place.addRemote
      ? [`git remote add ${place.remoteName} ${held.remote}`]
      : []),
    `git fetch ${place.remoteName}`,
    `${Brand.cli} check`,
    `git push ${place.remoteName} HEAD:main`,
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
};

export const isClaimed = Schema.is(Claim.successSchema);

const whoami = viewOf(WhoAmI.successSchema, ({ handle }) =>
  prose(`Signed in as ${handle}.`)
);

const status = viewOf(Status.successSchema, ({ answers, claims, handle }) =>
  joined(
    prose(`Signed in as ${handle}.`),
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

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const today = viewOf(TodayOf.successSchema, (page) =>
  joined(
    prose(
      `Today for ${page.decider}: ${plural(page.decisions.length, "decision", "decisions")} waiting${page.expiringSoon.length === 0 ? "" : `, ${page.expiringSoon.length} due within a day`}; each takes its default if nobody decides first.`
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
            `Take one with \`${Brand.cli} decide --project <owner>/<name> --decision <decision> --choice <choice> --yes\`.`
          ),
        ])
  )
);

const countOf = (count: number) => (count === 0 ? "nobody" : `${count}`);

const HOUR_MS = 3_600_000;

const spanOf = (ms: number) => {
  if (ms % HOUR_MS !== 0) {
    return plural(Math.round(ms / 60_000), "minute", "minutes");
  }

  const hours = ms / HOUR_MS;

  return hours > 48 && hours % 24 === 0
    ? plural(hours / 24, "day", "days")
    : plural(hours, "hour", "hours");
};

const PROJECT_FILE = `${Brand.configDir}/project.ts`;

const vouchModes = {
  all: "For everything: claiming an ask, offering a sealed answer and proposing an ask all need a vouch.",
  bansOnly:
    "Bans only: nobody needs a vouch, but a denounced person still may not claim, push or propose.",
  forCode:
    "For code: claiming an ask or offering a sealed answer needs a vouch; anyone not denounced may propose an ask.",
} as const satisfies Record<PublicPolicy["vouch"]["mode"], string>;

const evaluated = (policy: PublicPolicy) => {
  const { agents, caps, claims, decisions, record, vouch, vouches } = policy;
  const denounced = vouches.filter((line) => line.denounced).length;

  return joined(
    prose(
      policy.source === "config"
        ? `As of ${short(policy.at)}, the landed commit, from ${PROJECT_FILE}.`
        : `As of ${short(policy.at)}, the landed commit. This project has no ${PROJECT_FILE}: the person who set it up decides everything, under the platform's defaults.`
    ),
    prose("Maintainers by path:"),
    table(
      ["paths", "maintainers"],
      policy.deciders.map(({ handles, paths }) => [paths, handles.join(", ")]),
      "Nobody decides.",
      [0]
    ),
    prose(
      `Vouching: ${vouchModes[vouch.mode]} ${vouch.file} vouches for ${countOf(vouches.length - denounced)} and denounces ${countOf(denounced)}.`
    ),
    prose("Limits:"),
    fields([
      [
        "Claims",
        `${plural(caps.claimsPerPerson, "claim", "claims")} at once for a person nobody has vouched for; a vouched person and a maintainer are never held`,
      ],
      [
        "Proposals",
        caps.proposalsPerPerson === 0
          ? "Proposals are off"
          : `${plural(caps.proposalsPerPerson, "proposal", "proposals")} open at once for a person nobody has vouched for`,
      ],
      [
        "Decisions",
        `an undecided one takes its default after ${plural(decisions.expireDays, "day", "days")}`,
      ],
      [
        "Claim timing",
        `warned after ${spanOf(claims.warnAfterMs)} without a push; lapses after ${spanOf(claims.lapseAfterMs)}`,
      ],
      [
        "Record",
        `a landing counts ${
          record.countsAfterDays === 0
            ? "from the day it lands"
            : `once it has stood ${plural(record.countsAfterDays, "day", "days")}`
        }, for ${plural(record.windowDays, "day", "days")}`,
      ],
    ]),
    prose(
      agents === "trailer"
        ? "Agents: each landing names the agents its people worked through, in an Assisted-by: trailer."
        : "Agents: landings carry no Assisted-by: trailer."
    )
  );
};

/** The view sees only the success, which names no project, so the command names it as `<owner>/<name>`. */
const pendingText = ({ at, reason }: PolicyPending) => {
  const notEvaluated = `The config at the landed commit ${short(at)} has not been evaluated`;

  return reason === "noConfig"
    ? [
        `${notEvaluated}: there is no ${Brand.configDir}/ folder, and no test command in the project's CI or package files.`,
        `Run \`${Brand.cli} init --project <owner>/<name> --dry-run\` in the project's repo to see the ${PROJECT_FILE} it proposes, then have a maintainer land it.`,
      ]
    : [
        `${notEvaluated}: ${Brand.configDir}/ at ${short(at)} did not evaluate.`,
        `Fix it by landing a change to ${Brand.configDir}/; it is evaluated again at every landing.`,
      ];
};

const importedText = ({ branch, url }: ImportSource) =>
  prose(
    `Imported from ${url}${branch === undefined ? "" : ` (branch ${branch})`}: this project is ${IMPORTED_NOTE}.`
  );

const policyText = (read: typeof PolicyOf.successSchema.Type): View => {
  if (read.policy !== undefined) {
    return evaluated(read.policy);
  }

  if (read.unevaluated === undefined) {
    return prose(
      "Nothing has landed yet. The config is evaluated at every landing."
    );
  }

  const lines = pendingText(read.unevaluated);

  return { markdown: lines.join("\n\n"), text: lines.join("\n") };
};

const policy = viewOf(PolicyOf.successSchema, (read) =>
  read.importedFrom === undefined
    ? policyText(read)
    : joined(importedText(read.importedFrom), policyText(read))
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

const receipt = (offered: AnswerReceipt) =>
  prose(
    Result.getOrElse(receiptLine(offered), () => `${offered.ask} was refused`)
  );

const submitted = viewOf(SubmitAnswer.successSchema, receipt);

const finished = viewOf(Finish.successSchema, receipt);

const isReceipt = Schema.is(LandReceipt);

/** `finish` and `land` refuse stages 0–1 inside a success's receipt; the command prints them as refusals and exits 1. */
export const refusalsIn = (
  success: Rpc.Success<Contract>
): readonly Refusal[] =>
  isReceipt(success) && Outcome.guards.Refused(success.outcome)
    ? success.outcome.refusals
    : [];

/** `claim`'s receipt looks at the repo it is printed in, so the CLI's surfaces add it. */
export const views = {
  credits,
  finish: finished,
  frontPage: front,
  ledger,
  listAsks: asks,
  listDiscussions: discussions,
  listProjects: projects,
  postDiscussion: posted,
  projectPolicy: policy,
  showAsk: ask,
  showDiscussion: discussion,
  status,
  submitAnswer: submitted,
  today,
  verdict,
  whoami,
} as const satisfies Readonly<
  Partial<
    Record<
      Contract["_tag"],
      (success: Rpc.Success<Contract>) => Option.Option<View>
    >
  >
>;
