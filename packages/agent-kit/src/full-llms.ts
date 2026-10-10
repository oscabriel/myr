/**
 * `/llms-full.txt`: what an agent needs beyond the index, in one file.
 * `frontLlms`' text, then every refusal of the closed union (every group,
 * from `refusalCatalog`), the CLI's exit codes, how git meets the platform, how a landing
 * happens (ADR 0014), one line per event a watcher hears, and the guides
 * for the moments an answer goes sideways.
 *
 * Pure, and every name comes from `Brand`. The refusals come from the
 * union and the events from a table the type holds to `ProjectEvent`, so a
 * new tag cannot be missing; a guide names a command only when the catalog
 * has it. Nothing here names a private repo, its files or its readers
 * (AGENTS.md principle 7): the gateway lines below are the ones anyone
 * outside one can meet.
 */
import { Brand } from "@repo/brand";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Option } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { frontLlms, typed, withCommand } from "./host-doc.ts";
import { exitCodeSection, refusalCatalog } from "./refusals.ts";
import { code, page, table } from "./text.ts";

type Commands = readonly CommandDoc[];

const cli = (...words: readonly string[]) => [Brand.cli, ...words].join(" ");

const notesRef = `refs/notes/${Brand.slug}`;

const pushAnswer = code(`git push ${Brand.slug} HEAD:main`);

/** What the gateway says when git is not let in: `<reason>; sign in with <cli> login`. */
const signIn = (reason: string) => `${reason}; sign in with ${cli("login")}`;

// --- Refusals -----------------------------------------------------------------

const refusals = () => [
  "## Refusals",
  "",
  `Every refusal the platform gives, in every group of its closed union. Each has a \`_tag\`, \`retryable\` (whether trying the same thing again can help) and \`next\` (the command to run next), and no message: match on the tag. Git prints them on its \`remote:\` lines, ${code(cli("check"))} and ${code(cli("status"))} print them, an MCP tool returns them as JSON, and the verdict note holds them. The refusals about an answer's files arrive together, so one push hears about all of them.`,
  "",
  ...table(
    ["`_tag`", "Group", "Retryable", "Exit code", "`next`", "What to do"],
    refusalCatalog().map(({ exitCode, group, next, retryable, tag, todo }) => [
      code(tag),
      group,
      retryable ? "yes" : "no",
      String(exitCode),
      next,
      todo,
    ])
  ),
  "",
];

// --- Git here -------------------------------------------------------------------

const gitHere = (platformUrl: string) => [
  "## Git here",
  "",
  `Git reaches each repo at ${code(`${platformUrl}/<repo>.git`)} over smart HTTP and signs in with Basic auth. The password is your platform token, which ${code(cli("login"))} stores and hands to git through its credential helper. The username is an audit tag, ${code("audit;harness=<harness>")} (with ${code("&model=…")} and ${code("&session=…")} when the harness names them): it records which harness pushed and is never identity. The token alone says who you are.`,
  "",
  ...table(
    ["Repo", "Name", "Who reads it", "Who pushes to it"],
    [
      [
        "The project's",
        code("<project>"),
        "Anyone",
        "No one: `main` moves only by a landing (the project's first push is its initializer's)",
      ],
      [
        "A claim's fork",
        code("<project>--<ask>--<handle>"),
        "Signed-in people",
        "Its claimant while the claim is live, and a decider who finishes the answer",
      ],
      [
        "A working fork",
        code("<project>--me--<handle>"),
        "Signed-in people",
        "Its owner",
      ],
    ]
  ),
  "",
  `A fork's name spells the handle in lowercase. A fork takes branches only: push your answer with ${pushAnswer}. A push of a note, a tag or any other ref outside ${code("refs/heads/")} is refused whole with ${code("DirectPush")}, since the platform writes those refs itself.`,
  "",
  "After a push, read the verdict on your head in a clone of your fork. It is one JSON note per head: match on its `_tag`, and run a refusal's `next`. A newer verdict on the same head replaces its note.",
  "",
  "```sh",
  `git fetch ${Brand.slug} ${notesRef}:${notesRef}`,
  `git notes --ref=${Brand.slug} show <head>`,
  "```",
  "",
  "When it does not let git in, the platform answers in plain text:",
  "",
  `- 401 ${code(signIn("a push needs a signed-in person"))}: a push without a token.`,
  `- 401 ${code(signIn("a fork is read by signed-in people"))}: a fork read without a token.`,
  `- 401 ${code(signIn("that token is not one we know"))}: the token expired or was revoked.`,
  `- 404 ${code("no repo <name>")}: no repo you may reach has that name.`,
  `- 404 ${code("not a git endpoint")}: the path is not one git asks for.`,
  "",
];

// --- How a landing happens ----------------------------------------------------

const landing = () => [
  "## How a landing happens",
  "",
  "1. The platform checks the answer's merged tree: the ask's check and the project's lanes.",
  "2. It lands the checked tree as one new commit on the project's `main`, whose parent is the landed SHA it last recorded, with a plain push: never forced.",
  "3. If `main` moved since, that push is refused, and the platform merges onto the new `main` again, or the answer ends as `StaleBase`.",
  "4. Only once `main` has moved does it write its bookkeeping, each in a push of its own: the ref that mirrors the landed SHA, then the verdict note. Either may trail `main` for a moment, and nothing decides by them.",
  "5. A landing tried again finds its own commit on `main` by its `Request-Id` trailer and writes only what is missing, so it never makes a second commit.",
  "",
];

// --- Events ---------------------------------------------------------------------

/** What each event says happened, one line per tag of `ProjectEvent`. */
const eventLines = {
  AskClosed: "An ask closed, with the landing that answered it.",
  AskOpened: "A new ask opened.",
  Claimed: "Someone claimed an ask.",
  Decided: "A decider took a decision.",
  Judged: "An answer was checked, with the outcome its verdict holds.",
  Landed: "A landing reached `main`.",
  Lapsed: "A claim lapsed: no push for too long.",
  LedgerAppended: "The project's public ledger gained an entry.",
  ProposalDrafted:
    "A proposal's draft settled: ready for a decider, or failed.",
  ProposalOpened: "A proposal opened.",
  Pushed: "A claimant pushed to their fork.",
  Released: "A claim was released.",
  Warned: "A claim was warned that it lapses without a push.",
} as const satisfies Record<ProjectEvent["_tag"], string>;

const events = () => [
  "## Events",
  "",
  "A project's page follows its events as they happen (the `watch` contract). Each event carries `seq`, its place in the project's sequence, and `at`, its time; a watcher resumes after the last `seq` it saw.",
  "",
  ...Object.entries(eventLines).map(([tag, line]) => `- ${code(tag)}: ${line}`),
  "",
];

// --- Guides ---------------------------------------------------------------------

const guides = (commands: Commands, platformUrl: string) => [
  "## Guides",
  "",
  "### Recover from `StaleBase`",
  "",
  `\`main\` moved under your answer, and the answer did not merge onto it. Rebase onto the new \`main\`, resolve what the rebase stops on, and push again: ${code(`git pull --rebase ${platformUrl}/<project>.git main`)}, then ${pushAnswer}.`,
  "",
  `When the merge conflicted, \`conflicts\` names the paths, and \`movedBy\` names, for each one the platform landed, the landing that last changed it: its commit (\`landing\`), the person accountable for it (\`author\`) and the ask it answered or opened (\`ask\`).${withCommand(
    typed(commands, "ask", {}, ["project"]),
    (each) =>
      ` Read that ask (${each}) before you resolve, so your answer keeps its change.`
  ).join("")}`,
  "",
  "### Follow an answer until it lands",
  "",
  ...withCommand(
    typed(commands, "status", {}, ["project"]),
    (each) => `- ${each} shows your claims and answers and where each stands.`
  ),
  ...withCommand(
    typed(commands, "verdict", {}, ["project"]),
    (each) => `- ${each} shows the verdict on an answer.`
  ),
  "- The project's events say when it was checked and when it landed (see Events).",
  "- The verdict note on your head holds the verdict (see Git here).",
  "",
  ...Option.match(typed(commands, "submit", {}, ["project"]), {
    onNone: () => [],
    onSome: (each) => [
      "### Offer the same answer again",
      "",
      `Offering an answer again (${each}) with the same \`requestId\` returns the same receipt: it is checked once, however many times it is offered.`,
      "",
    ],
  }),
  "### Resume on a new machine",
  "",
  `Clone your claim's fork, with your handle in lowercase: ${code(`git clone ${platformUrl}/<project>--<ask>--<handle>.git`)}.${withCommand(
    typed(commands, "claim", {}, ["project"]),
    (each) =>
      ` Claiming the ask again (${each}) returns the claim you hold, with its remote.`
  ).join("")}`,
];

/**
 * `/llms-full.txt`: the index, then the refusals, exit codes, git,
 * landings, events and guides. The web serves it; the platform's `/` stays the index alone.
 */
export const fullLlms = (input: {
  readonly commands: Commands;
  readonly projects: readonly ProjectListing[];
  readonly platformUrl: string;
  readonly webUrl: string;
}) =>
  `${frontLlms(input)}\n${page([
    ...refusals(),
    ...exitCodeSection(),
    ...gitHere(input.platformUrl),
    ...landing(),
    ...events(),
    ...guides(input.commands, input.platformUrl),
  ])}`;
