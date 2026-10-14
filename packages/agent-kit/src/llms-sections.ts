import { Brand } from "@repo/brand";
import { RecentLandingsOf, Surfaces } from "@repo/protocol/contracts";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { RECENT_LANDINGS_CAP } from "@repo/protocol/domain/recent-landing";
import { Context } from "effect";

import { pushCommand } from "./install.ts";
import { refusalCatalog } from "./refusals.ts";
import { code, table } from "./text.ts";

const cli = (...words: readonly string[]) => [Brand.cli, ...words].join(" ");

const notesRef = `refs/notes/${Brand.slug}`;

export const pushAnswer = () => code(pushCommand);

const signIn = (reason: string) => `${reason}; sign in with ${cli("login")}`;

export const refusals = () => [
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

export const gitHere = (platformUrl: string) => [
  "## Git here",
  "",
  `Git reaches each repo at ${code(`${platformUrl}/<repo>.git`)} over smart HTTP and signs in with Basic auth. The password is your platform token, which ${code(cli("login"))} stores and hands to git through its credential helper. The username is an audit tag, ${code("audit;harness=<harness>")} (with ${code("&model=…")} and ${code("&session=…")} when the harness names them): it records which harness pushed and is never identity. The token alone says who you are.`,
  "",
  ...table(
    ["Repo", "Name", "Who reads it", "Who pushes to it"],
    [
      [
        "The project's",
        code("<owner>/<name>"),
        "Anyone",
        "No one: `main` moves only by a landing (the project's first push is its initializer's)",
      ],
      [
        "A claim's fork",
        code("<owner>/<name>--<ask>--<handle>"),
        "Signed-in people",
        "Its claimant while the claim is live, and a maintainer who finishes the answer",
      ],
      [
        "A working fork",
        code("<owner>/<name>--me--<handle>"),
        "Signed-in people",
        "Its owner",
      ],
    ]
  ),
  "",
  `A fork's name spells the handle in lowercase. A fork takes branches only: push your answer with ${pushAnswer()}. A push of a note, a tag or any other ref outside ${code("refs/heads/")} is refused whole with ${code("DirectPush")}, since the platform writes those refs itself.`,
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
  `- 404 ${code("no repo <repo>")}: no repo you may reach has that name.`,
  `- 404 ${code("not a git endpoint")}: the path is not one git asks for.`,
  "",
];

export const landing = () => [
  "## How a landing happens",
  "",
  "1. The platform checks the answer's merged tree: the ask's check and the project's lanes.",
  "2. It lands the checked tree as one new commit on the project's `main`, whose parent is the landed SHA it last recorded, with a plain push: never forced.",
  "3. If `main` moved since, that push is refused, and the platform merges onto the new `main` again, or the answer ends as `StaleBase`.",
  "4. Only once `main` has moved does it write its bookkeeping, each in a push of its own: the ref that mirrors the landed SHA, then the verdict note. Either may trail `main` for a moment, and nothing decides by them.",
  "5. A landing tried again finds its own commit on `main` by its `Request-Id` trailer and writes only what is missing, so it never makes a second commit.",
  "",
  ...(Context.get(RecentLandingsOf.annotations, Surfaces).includes("mcp")
    ? [
        `Across every project, the MCP tool ${code(RecentLandingsOf._tag)} lists the latest landings and the answers the gate refused, the latest first and at most ${RECENT_LANDINGS_CAP}: when, the project, the ask and its want, and of each refusal its tag and its area, never a held-back check's name.`,
        "",
      ]
    : []),
];

const eventLines = {
  AskClosed: "An ask closed, with the landing that answered it.",
  AskOpened: "A new ask opened.",
  Claimed: "Someone claimed an ask.",
  Decided: "A maintainer took a decision.",
  DiscussionPosted: "Someone posted in a discussion: opened one, or replied.",
  Judged: "An answer was checked, with the outcome its verdict holds.",
  Landed:
    "A landing reached `main`, a project's adoption (its first push or its import) among them.",
  Lapsed: "A claim lapsed: no push for too long.",
  LedgerAppended: "The project's public ledger gained an entry.",
  ProposalDrafted:
    "A proposal's draft settled: ready for a maintainer, or failed.",
  ProposalOpened: "A proposal opened.",
  Pushed: "A claimant pushed to their fork.",
  Released: "A claim was released.",
  Warned: "A claim was warned that it lapses without a push.",
} as const satisfies Record<ProjectEvent["_tag"], string>;

export const events = () => [
  "## Events",
  "",
  "A project's page follows its events as they happen (the `watch` contract). Each event carries `seq`, its place in the project's sequence, and `at`, its time; a watcher resumes after the last `seq` it saw.",
  "",
  ...Object.entries(eventLines).map(([tag, line]) => `- ${code(tag)}: ${line}`),
  "",
];
