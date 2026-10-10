/**
 * `/llms-full.txt`: what an agent needs beyond the index, in one file.
 * `frontLlms`' text, then every refusal of the closed union (every group,
 * from `refusalCatalog`), the CLI's exit codes, how git meets the platform, how a landing
 * happens (ADR 0014), one line per event a watcher hears (those four from
 * `llms-sections.ts`, which the docs show too), and the guides for the
 * moments an answer goes sideways.
 *
 * Pure, and every name comes from `Brand`; a guide names a command only
 * when the catalog has it.
 */
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Option } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { frontLlms, typed, withCommand } from "./host-doc.ts";
import {
  events,
  gitHere,
  landing,
  pushAnswer,
  refusals,
} from "./llms-sections.ts";
import { exitCodeSection } from "./refusals.ts";
import { code, page } from "./text.ts";

type Commands = readonly CommandDoc[];

// --- Guides ---------------------------------------------------------------------

const guides = (commands: Commands, platformUrl: string) => [
  "## Guides",
  "",
  "### Recover from `StaleBase`",
  "",
  `\`main\` moved under your answer, and the answer did not merge onto it. Rebase onto the new \`main\`, resolve what the rebase stops on, and push again: ${code(`git pull --rebase ${platformUrl}/<project>.git main`)}, then ${pushAnswer()}.`,
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
