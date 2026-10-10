/**
 * The first guide: what the platform is, the four words a contributor
 * meets, the loop a change takes to `main`, and what a refusal looks like.
 */
import { Brand } from "@repo/brand";

import type { DocSource } from "./page.ts";
import { cli } from "./page.ts";

export const startHere: DocSource = {
  body: () => [
    `${Brand.name} is a git platform. Everything a project ships is public, the way a project takes changes is typed code on its \`main\`, and a change lands only by passing a typed gate. A project says what it wants; anyone, or an agent working for someone, may answer; an answer that passes its check lands with credit for every person involved. Work nobody asked for has nowhere to go.`,
    "",
    "## Four words",
    "",
    "- An **ask** is a file on `main` stating one change the project wants: what should be true, the part of the code an answer may change (its territory), and a check that fails on `main` today.",
    "- An **answer** is a commit in the claimant's fork, offered for one ask.",
    "- A **check** judges the answer: the ask's own check and the project's checks, run by the platform on the exact tree the answer would make.",
    "- A **refusal** is what the platform gives instead of landing: a member of one closed, typed union, with whether trying again can help and the command to run next.",
    "",
    "## How a change reaches `main`",
    "",
    `1. A decider opens an ask. It opens only once its check fails on \`main\` twice the same way, by an assertion.`,
    `2. A contributor claims it with ${cli("claim <ask> --project <project>")} and gets a fork of their own. A claim is exclusive and expires unless they push.`,
    "3. They work in plain git, with any editor or agent, and push to the fork through the platform.",
    "4. The push is checked against the claim, the territory and the files that decide what the checks do, and refused in `git push`'s own output if it strays.",
    "5. The platform merges the answer onto `main` and runs the ask's check, the project's checks and any held-back checks on that exact tree.",
    "6. It lands the checked tree on `main` as its own commit, crediting every person, or answers with a refusal.",
    "",
    "## What a refusal looks like",
    "",
    "An answer that changes a file outside its ask's territory never reaches `main`:",
    "",
    "```",
    "$ git push",
    "remote: OutOfScope: changes paths outside the ask's territory: README.md; put those files back, or flag the ask if the want needs them",
    `remote:   next: ${Brand.cli} check`,
    "remote:   retryable: no",
    "To https://<platform>/datekit--parse-iso--alice.git",
    " ! [remote rejected] HEAD -> main (OutOfScope)",
    "```",
    "",
    "## Where next",
    "",
    "- [The open asks](/asks), across every project.",
    "- [Answer an ask](/docs/answer-an-ask), from finding one to reading its verdict.",
    "- [Run a project](/docs/run-a-project): make one, write its config folder, open asks and decide.",
    "- [Connect an agent](/docs/connect-an-agent) over MCP, the CLI or a skill.",
    "- [Refusals](/docs/refusals): every one, and what to do about it.",
    "",
  ],
  slug: "start-here",
};
