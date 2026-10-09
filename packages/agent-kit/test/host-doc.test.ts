/**
 * The host's own Markdown, `frontLlms`: what the web serves at `/llms.txt`
 * and the platform at `/` for an agent. A pure function of the CLI's
 * commands, the listed projects and the two hosts' URLs; with no web app
 * it points only at what the platform serves itself.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";

import type { CommandDoc } from "../src/command-doc.ts";
import { frontLlms } from "../src/host-doc.ts";
import { expectGolden } from "./golden.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

/** A command row as the command list holds it. */
const row = (
  path: readonly [string, ...string[]],
  summary: string,
  more: Partial<CommandDoc> = {}
): CommandDoc => ({
  flags: ["--json"],
  needsApproval: false,
  path,
  positional: [],
  readOnly: true,
  source: "contract",
  summary,
  ...more,
});

/** The web's own `llms.test.ts` catalog, so the golden file is its former output. */
const commands: readonly CommandDoc[] = [
  row(
    ["ask"],
    "Show one ask in full, with its brief in Markdown for an answerer to read first.",
    { flags: ["--project", "--json"], positional: ["ask"] }
  ),
  row(["asks"], "List a project's open asks.", {
    flags: ["--project", "--json"],
  }),
  row(["check"], "Run the gate's checks on your answer locally.", {
    flags: ["--ask", "--project", "--json"],
    source: "local",
  }),
  row(["claim"], "Claim an ask: an exclusive, expiring right to answer it.", {
    flags: ["--project", "--json", "--dry-run"],
    positional: ["ask"],
    readOnly: false,
  }),
  row(["env", "set"], "Set a sensitive env item's value from stdin.", {
    flags: ["--project", "--yes"],
    needsApproval: true,
    positional: ["key"],
    readOnly: false,
    source: "local",
  }),
  row(["front"], "List the open asks across every project."),
  row(["login"], "Sign in to a platform.", {
    flags: ["--url", "--json"],
    readOnly: false,
    source: "local",
  }),
  row(["mcp"], "Serve the platform's tools over MCP on stdio.", {
    flags: [],
    source: "local",
  }),
  row(["verdict"], "Show the verdict on an answer to an ask.", {
    flags: ["--ask", "--head", "--project", "--json"],
  }),
];

const projects: readonly ProjectListing[] = [
  { openAsks: 3, posture: "open", project: ProjectName.make("datekit") },
  {
    openAsks: 1,
    posture: "openWithSealedEvidence",
    project: ProjectName.make("burrow"),
  },
];

const linesOf = (text: string) => text.split("\n");

describe("the host's Markdown", () => {
  it.effect("with a web app, is the text the web served at /llms.txt", () =>
    expectGolden(
      "host-doc",
      frontLlms({ commands, platformUrl, projects, webUrl })
    ).pipe(Effect.provide(NodeServices.layer))
  );

  describe("without a web app", () => {
    const text = frontLlms({ commands, platformUrl, projects });
    const lines = linesOf(text);

    it("installs the CLI and finds the skills on the platform itself", () => {
      expect(lines).toContain(`curl -fsSL ${platformUrl}/install.sh | sh`);
      expect(lines).toContain(
        `- Skills: ${platformUrl}/.well-known/agent-skills/index.json lists each project's contribute skill, with its digest.`
      );
      expect(lines).toContain(
        `- Endpoint: ${platformUrl}/mcp (streamable HTTP, MCP 2026-07-28).`
      );
    });

    it("gives each project's clone URL in place of a web page", () => {
      expect(lines).toContain(
        `- datekit: Open, 3 open asks. Clone: \`git clone ${platformUrl}/datekit.git\`.`
      );
      expect(lines).toContain(
        `- burrow: Open with sealed evidence, 1 open ask. Clone: \`git clone ${platformUrl}/burrow.git\`.`
      );
    });

    it("names no page only a web app serves", () => {
      expect(text).not.toContain("llms.txt");
      expect(text).not.toContain("mcp.json");
      expect(text).not.toContain(".md");
    });

    it("still opens with the name and lists every command", () => {
      expect(lines[0]).toBe(`# ${Brand.name}`);
      expect(
        lines.filter((line) => line.startsWith(`- \`${Brand.cli} `))
      ).toHaveLength(commands.length);
    });
  });
});
