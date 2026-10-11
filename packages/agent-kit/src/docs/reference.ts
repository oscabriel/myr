/**
 * The reference: each page read from what defines it, never copied. The
 * commands from the CLI's one list, the refusals from the closed union,
 * git, landings and events from the text `/llms-full.txt` serves, the MCP
 * tools from the contracts served over MCP, and the imported projects from
 * the copy of the import plan.
 */
import { Brand } from "@repo/brand";
import {
  Contracts,
  Description,
  ReadOnly,
  Surfaces,
} from "@repo/protocol/contracts";
import { Context } from "effect";

import type { CommandDoc } from "../command-doc.ts";
import { events, gitHere, landing, refusals } from "../llms-sections.ts";
import { exitCodeSection } from "../refusals.ts";
import { code, table } from "../text.ts";
import { IMPORTED_NOTE } from "./imported-note.ts";
import { importedProjects } from "./imported.ts";
import type { DocSource } from "./page.ts";
import { withoutHeading } from "./page.ts";

/** A command as typed: its words, then its positionals in angle brackets. */
const usage = ({ path, positional }: CommandDoc) =>
  code(
    [Brand.cli, ...path, ...positional.map((name) => `<${name}>`)].join(" ")
  );

export const commandsPage: DocSource = {
  body: ({ commands }) => [
    "Every command the CLI has, from the one list the CLI, its skill and `llms.txt` all read. A command that lists `--json` prints JSON for an agent; one that writes takes `--dry-run`, and one that needs your approval takes `--yes`.",
    "",
    ...table(
      ["Command", "What it does", "Flags", "Only reads"],
      commands.map((command) => [
        usage(command),
        command.summary,
        command.flags.map(code).join(" "),
        command.readOnly ? "yes" : "no",
      ])
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

/** Each contract served over MCP: its tool name, what it does, and whether it only reads. */
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
    `The platform serves its contracts as MCP tools at ${code(`${platformUrl}/mcp`)} over streamable HTTP, signed in with its own OAuth; ${code(`${Brand.cli} mcp`)} serves the same tools over stdio. A refusal comes back as the tool's error, its \`_tag\` intact. [For agents](/agents) has each client's setup.`,
    "",
    ...table(["Tool", "What it does", "Only reads"], mcpTools()),
    "",
  ],
  slug: "mcp",
};

export const importedPage: DocSource = {
  body: () => [
    `These projects were imported so you can read code you know on the platform. Each is ${IMPORTED_NOTE}; its history, with its authors, came with it, and why each line is there reads as before adoption. Each stays under its own licence.`,
    "",
    ...table(
      ["Project", "Source", "Licence", "What it is"],
      importedProjects.map(({ kind, licence, project, url }) => [
        `[${project}](/${project})`,
        url,
        licence,
        kind,
      ])
    ),
    "",
  ],
  slug: "imported",
};
