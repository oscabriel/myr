/**
 * The Agents page's one source: how each agent connects (remote MCP, MCP
 * over stdio, the CLI, text to paste, skills), each channel with when to
 * use it and the snippets to copy. A pure function of the CLI's commands
 * and the two hosts' URLs; the web draws it as `/agents` and serves it as
 * `/agents.md`, and its MCP JSON is the object the plugin bundles carry.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { groups } from "@repo/protocol/refusal";
import { Array as Arr, Effect, Option, Schema } from "effect";

import {
  agentEndpoints,
  agentLimits,
  agentSetup,
  agentSetupMarkdown,
  synopsis,
} from "../src/agent-setup.ts";
import type { SetupChannel } from "../src/agent-setup.ts";
import type { CommandDoc } from "../src/command-doc.ts";
import { claudePlugin } from "../src/platform.ts";
import { commands as someCommands } from "./fixtures.ts";
import { expectGolden } from "./golden.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const login: CommandDoc = {
  flags: ["--url", "--json"],
  needsApproval: false,
  path: ["login"],
  positional: [],
  readOnly: false,
  source: "local",
  summary: "Sign in to a platform.",
};

const mcp: CommandDoc = {
  flags: [],
  needsApproval: false,
  path: ["mcp"],
  positional: [],
  readOnly: true,
  source: "local",
  summary: "Serve the platform's tools over MCP on stdio.",
};

const commands: readonly CommandDoc[] = [...someCommands, login, mcp];

const channels = agentSetup({ commands, platformUrl, webUrl });

/** The channel titled `title`; fails the test without one. */
const channel = (from: readonly SetupChannel[], title: string) =>
  Option.getOrThrow(Arr.findFirst(from, (each) => each.title === title));

/** The snippet labelled `label` in the channel titled `title`. */
const snippet = (title: string, label: string) =>
  Option.getOrThrow(
    Arr.findFirst(channel(channels, title).snippets, (each) =>
      each.label.startsWith(label)
    )
  );

/** A JSON object's text, decoded. */
const parsed = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
);

/** The `.mcp.json` the Claude Code plugin carries for the same platform. */
const pluginMcpJson = claudePlugin({ commands, platformUrl }).pipe(
  Effect.map((files) =>
    Option.getOrThrow(
      Arr.findFirst(files, ({ path }) => path.endsWith("/.mcp.json"))
    )
  )
);

describe("the Agents page's source", () => {
  it.effect("as Markdown, is the golden text", () =>
    expectGolden(
      "agent-setup",
      agentSetupMarkdown({ commands, platformUrl, webUrl })
    ).pipe(Effect.provide(NodeServices.layer))
  );

  it("lists every channel in order, each saying when to use it", () => {
    expect(channels.map(({ title }) => title)).toStrictEqual([
      "Remote MCP",
      "MCP over stdio",
      "The CLI",
      "Text for any agent",
      "Skills",
    ]);

    for (const each of channels) {
      expect(each.useWhen).not.toBe("");
      expect(each.snippets.length).toBeGreaterThan(0);
    }
  });

  it("adds the platform's MCP endpoint to Claude Code under the brand's slug", () => {
    expect(snippet("Remote MCP", "Claude Code").text).toBe(
      `claude mcp add --transport http ${Brand.slug} ${platformUrl}/mcp`
    );
  });

  it.effect(
    "gives VS Code the server the Claude Code plugin's .mcp.json carries",
    () =>
      Effect.gen(function* () {
        const plugin = yield* pluginMcpJson;
        const vscode = snippet("Remote MCP", "VS Code");

        expect(vscode.language).toBe("json");
        expect(parsed(vscode.text)).toStrictEqual({
          servers: parsed(plugin.content).mcpServers,
        });
        expect(parsed(vscode.text)).toStrictEqual({
          servers: {
            [Brand.slug]: { type: "http", url: `${platformUrl}/mcp` },
          },
        });
      })
  );

  it("gives Cursor its mcpServers entry with the endpoint's url", () => {
    const cursor = snippet("Remote MCP", "Cursor");

    expect(cursor.language).toBe("json");
    expect(parsed(cursor.text)).toStrictEqual({
      mcpServers: { [Brand.slug]: { url: `${platformUrl}/mcp` } },
    });
  });

  it("serves MCP over stdio through the CLI only when the CLI has mcp", () => {
    expect(snippet("MCP over stdio", "").text).toBe(`${Brand.cli} mcp`);

    const without = agentSetup({
      commands: commands.filter(({ path }) => path.join(" ") !== "mcp"),
      platformUrl,
      webUrl,
    });

    expect(without.map(({ title }) => title)).not.toContain("MCP over stdio");
  });

  it("installs the CLI from the web and signs in to the platform", () => {
    expect(
      channel(channels, "The CLI").snippets.map(({ text }) => text)
    ).toStrictEqual([
      `curl -fsSL ${webUrl}/install.sh | sh`,
      `${Brand.cli} login --url ${platformUrl}`,
    ]);
  });

  it("points any agent at llms.txt and each ask's Markdown", () => {
    const { text } = snippet("Text for any agent", "");

    expect(text).toContain(`${webUrl}/llms.txt`);
    expect(text).toContain(`${webUrl}/<project>/asks/<ask>.md`);
  });

  it("adds the skills from the web's index", () => {
    expect(snippet("Skills", "").text).toBe(`npx skills add ${webUrl}`);
    expect(channel(channels, "Skills").useWhen).toContain(
      `${webUrl}/.well-known/agent-skills/index.json`
    );
  });

  it("writes every snippet into the Markdown whole", () => {
    const text = agentSetupMarkdown({ commands, platformUrl, webUrl });

    for (const each of channels) {
      expect(text).toContain(`## ${each.title}`);

      for (const { text: body } of each.snippets) {
        expect(text).toContain(body);
      }
    }
  });
});

describe("the Agents page's reference sections", () => {
  it("gives every command one synopsis line, as typed, with its summary", () => {
    const lines = synopsis(commands);

    expect(lines.map(({ summary }) => summary)).toStrictEqual(
      commands.map(({ summary }) => summary)
    );

    for (const [index, command] of commands.entries()) {
      const line = lines[index]?.usage ?? "";

      expect(
        line.startsWith(`${Brand.cli} ${command.path.join(" ")}`)
      ).toBeTruthy();

      for (const name of command.positional) {
        expect(line).toContain(`<${name}>`);
      }
    }

    expect(synopsis([login])).toStrictEqual([
      {
        summary: login.summary,
        usage: `${Brand.cli} login [--url] [--json]`,
      },
    ]);
  });

  it("names every endpoint an agent reads, on the host that serves it", () => {
    const endpoints = agentEndpoints({ platformUrl, webUrl });

    expect(endpoints.map(({ url }) => url)).toStrictEqual([
      `${webUrl}/llms.txt`,
      `${webUrl}/llms-full.txt`,
      `${webUrl}/<project>/llms.txt`,
      `${webUrl}/<project>/asks/<ask>.md`,
      `${webUrl}/agents.md`,
      `${webUrl}/.well-known/mcp.json`,
      `${webUrl}/.well-known/agent-skills/index.json`,
      `${platformUrl}/mcp`,
      `${platformUrl}/<repo>.git`,
    ]);

    for (const { what } of endpoints) {
      expect(what).not.toBe("");
    }

    expect(
      endpoints.filter(({ readable }) => readable).map(({ url }) => url)
    ).toStrictEqual([
      `${webUrl}/llms.txt`,
      `${webUrl}/llms-full.txt`,
      `${webUrl}/agents.md`,
      `${webUrl}/.well-known/mcp.json`,
      `${webUrl}/.well-known/agent-skills/index.json`,
    ]);
  });

  it("states the limits a policy sets by default, as a person says them", () => {
    const values = agentLimits().map(({ value }) => value);

    expect(values).toStrictEqual([
      "3 by default",
      "2 by default; 0 takes none",
      "Warned after 2 hours, lapses after 1 day, by default",
      "5 by default",
      "2 weeks by default, then it takes its default",
      "A set number a minute; past it, CapReached says when to try again",
    ]);

    for (const { limit } of agentLimits()) {
      expect(limit).not.toBe("");
    }
  });

  it("writes the reference sections into the Markdown, in the page's order", () => {
    const text = agentSetupMarkdown({ commands, platformUrl, webUrl });
    const at = (heading: string) => text.indexOf(`\n## ${heading}\n`);

    const order = ["Synopsis", "Connect", "Endpoints", "Limits", "Refusals"];

    for (const heading of order) {
      expect(at(heading)).toBeGreaterThan(0);
    }

    expect(order.map(at)).toStrictEqual(
      order.map(at).toSorted((a, b) => a - b)
    );

    for (const group of groups) {
      for (const member of group.members) {
        expect(text).toContain(`\`${member.identifier}\``);
      }
    }

    expect(text).toContain(`${webUrl}/llms-full.txt`);
  });
});
