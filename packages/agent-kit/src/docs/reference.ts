import { Brand } from "@repo/brand";
import {
  Contracts,
  Description,
  ReadOnly,
  Surfaces,
} from "@repo/protocol/contracts";
import { Context } from "effect";

import { endpointLines, limitLines, synopsisLine } from "../agent-setup.ts";
import { events, gitHere, landing, refusals } from "../llms-sections.ts";
import { exitCodeSection } from "../refusals.ts";
import { code, table } from "../text.ts";
import { IMPORTED_NOTE } from "./imported-note.ts";
import { importedProjects } from "./imported.ts";
import type { DocSource } from "./page.ts";
import { withoutHeading } from "./page.ts";

export const commandsPage: DocSource = {
  body: ({ commands }) => [
    "Every command the CLI has, as its synopsis, from the one list the CLI, its skill and `llms.txt` all read. A command that lists `--json` prints JSON for an agent; one that writes takes `--dry-run`, and one that needs your approval takes `--yes`.",
    "",
    ...table(
      ["Command", "What it does", "Only reads"],
      commands.map((command) => {
        const { summary, usage } = synopsisLine(command);

        return [code(usage), summary, command.readOnly ? "yes" : "no"];
      })
    ),
    "",
  ],
  slug: "commands",
};

export const refusalsPage: DocSource = {
  body: () => [...withoutHeading(refusals()), ...exitCodeSection()],
  slug: "refusals",
};

export const gitPage: DocSource = {
  body: ({ platformUrl }) => withoutHeading(gitHere(platformUrl)),
  slug: "git",
};

export const landingPage: DocSource = {
  body: () => withoutHeading(landing()),
  slug: "landing",
};

export const eventsPage: DocSource = {
  body: () => withoutHeading(events()),
  slug: "events",
};

const mcpTools = () =>
  [...Contracts.requests.values()].flatMap(({ _tag, annotations }) =>
    Context.get(annotations, Surfaces).includes("mcp")
      ? [
          [
            code(_tag),
            Context.get(annotations, Description),
            Context.get(annotations, ReadOnly) ? "yes" : "no",
          ],
        ]
      : []
  );

export const mcpPage: DocSource = {
  body: ({ platformUrl }) => [
    `The platform serves its contracts as MCP tools at ${code(`${platformUrl}/mcp`)} over streamable HTTP, signed in with its own OAuth; ${code(`${Brand.cli} mcp`)} serves the same tools over stdio. A refusal comes back as the tool's error, its \`_tag\` intact. [Install](/install) has each client's setup.`,
    "",
    ...table(["Tool", "What it does", "Only reads"], mcpTools()),
    "",
  ],
  slug: "mcp",
};

export const limitsPage: DocSource = {
  body: (input) => [
    "These are the defaults: a project's policy can change any of them, and each project shows its own. Past a cap the platform refuses with `CapReached` (see [Refusals](/docs/refusals)).",
    "",
    ...limitLines(),
    ...endpointLines(input),
  ],
  slug: "limits",
};

export const importedPage: DocSource = {
  body: () => [
    `These projects were imported so you can read code you know on the platform. Each is ${IMPORTED_NOTE}; its history, with its authors, came with it, and why each line is there reads as before adoption. Each stays under its own licence.`,
    "",
    ...table(
      ["Project", "Source", "Licence", "What it is"],
      importedProjects.map(({ kind, licence, name, url }) => [
        `[${name}](/${name})`,
        url,
        licence,
        kind,
      ])
    ),
    "",
  ],
  slug: "imported",
};
