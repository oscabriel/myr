/**
 * The contributor's guide: install and sign in, find an ask, claim it,
 * answer it in git, check it before the push, push, read the verdict, and
 * what to do when it is refused.
 */
import { Brand } from "@repo/brand";

import { installCommand } from "../install.ts";
import { code } from "../text.ts";
import type { DocSource } from "./page.ts";
import { cli, shell } from "./page.ts";

const notesRef = `refs/notes/${Brand.slug}`;

export const answerAnAsk: DocSource = {
  body: ({ platformUrl, webUrl }) => [
    "## Install the CLI and sign in",
    "",
    ...shell(installCommand(webUrl), `${Brand.cli} login --url ${platformUrl}`),
    "",
    "Signing in stores your token, and git uses it from then on through the CLI's credential helper: no token in a URL, and no prompt.",
    "",
    "## Find an ask",
    "",
    `[The open asks](/asks) list every open ask across projects, each saying what done means and whether you may take it. ${cli("front")} lists the same in a terminal, and ${cli("asks --project <project>")} lists one project's. Some asks are held for newcomers, with a mentor named.`,
    "",
    `Read one in full before you claim it: ${cli("ask <ask> --project <project>")}. Its brief says the want, the territory (the part of the code you may change), what is out of scope, and the check that fails on \`main\` today.`,
    "",
    "## Claim it",
    "",
    `${cli("claim <ask> --project <project>")} gives you the ask alone, for a while: nobody else may answer it while your claim is live. It prints your fork's remote, ${code("<project>--<ask>--<handle>")}. Each push keeps the claim alive; a claim with no push for too long lapses, and the ask is open again. Claiming it again returns the claim you hold. To let it go: ${cli("release <ask> --project <project>")}.`,
    "",
    ...shell(
      `git remote add ${Brand.slug} <remote>`,
      `git fetch ${Brand.slug}`
    ),
    "",
    "## Answer it in git",
    "",
    "Work in plain git, with any editor or agent. Change only the ask's territory, and leave alone the files that decide what the checks do: test and lint config, scripts, CI files, the config folder and `.env.schema`. An answer that touches one, or adds a `.skip` or a lint disable without a reason, is refused at the push.",
    "",
    `Before you push, ${cli("check")} runs the gate's first stage on your machine and prints the same refusals the push would get, every one at once.`,
    "",
    "## Push, and read the verdict",
    "",
    ...shell(`git push ${Brand.slug} HEAD:main`),
    "",
    `The cheap checks answer in git's own output, on its \`remote:\` lines. The rest run on the platform, on the tree your answer makes once merged onto \`main\`, and arrive later: ${cli("status --project <project>")} shows your claims and answers and where each stands, and ${cli("verdict <ask> --project <project>")} shows the verdict. The answer's page on the web follows it live, and the verdict is also a git note on your head:`,
    "",
    ...shell(
      `git fetch ${Brand.slug} ${notesRef}:${notesRef}`,
      `git notes --ref=${Brand.slug} show <head>`
    ),
    "",
    "## When it is refused",
    "",
    "Every refusal says whether trying again can help and names the command to run next. Run it, fix what it names, and push again. [Refusals](/docs/refusals) lists each one with what to do.",
    "",
    `When \`main\` moved under your answer and it no longer merges, the refusal is \`StaleBase\`. It names each conflicting path and, for each one the platform landed, the landing that last changed it. Rebase onto the new \`main\`, resolve, and push again: ${code(`git pull --rebase ${platformUrl}/<project>.git main`)}.`,
    "",
    "## Credit",
    "",
    "A landing is the platform's own commit, and it names every person involved in trailers: `Asked-by`, `Signed-off-by` for you, `Decided-by`, `Finished-by` and others. An agent you worked through is disclosed in `Assisted-by`, apart from the credit. Your page lists your landings across projects.",
    "",
  ],
  slug: "answer-an-ask",
};
