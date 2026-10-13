import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Array as Arr, Option } from "effect";

import { agentSetup } from "../src/agent-setup.ts";
import type { CommandDoc } from "../src/command-doc.ts";
import { installChannels } from "../src/install-channels.ts";
import type { InstallChannel } from "../src/install-channels.ts";
import { commands as someCommands } from "./fixtures.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const local = (path: string, summary: string): CommandDoc => ({
  flags: [],
  needsApproval: false,
  path: [path],
  positional: [],
  readOnly: false,
  source: "local",
  summary,
});

const commands: readonly CommandDoc[] = [
  ...someCommands,
  local("login", "Sign in to a platform."),
  local("mcp", "Serve the platform's tools over MCP on stdio."),
];

const channels = installChannels({ commands, platformUrl, webUrl });

const channel = (id: string, from: readonly InstallChannel[] = channels) =>
  Option.getOrThrow(Arr.findFirst(from, (each) => each.id === id));

const textsOf = ({ snippets }: InstallChannel) =>
  snippets.map(({ text }) => text);

describe("the Install page's channels", () => {
  it("are every way in, in order, each saying what it is for", () => {
    expect(channels.map(({ id }) => id)).toStrictEqual([
      "cli",
      "mcp",
      "skills",
      "text",
      "git",
      "web",
      "pi",
    ]);

    for (const each of channels) {
      expect([each.id, each.title, each.audience, each.summary]).not.toContain(
        ""
      );
    }
  });

  it("install the CLI by script or from npm, then sign in to the platform", () => {
    expect(textsOf(channel("cli"))).toStrictEqual([
      `curl -fsSL ${webUrl}/install.sh | sh`,
      `npm install -g ${Brand.cliPackage}`,
      `${Brand.cli} login --url ${platformUrl}`,
    ]);
  });

  it("give MCP one tab per client and stdio, with the snippets agentSetup gives", () => {
    const mcp = channel("mcp");

    const setup = agentSetup({ commands, platformUrl, webUrl }).filter(
      ({ title }) => title === "Remote MCP" || title === "MCP over stdio"
    );

    expect(mcp.tabbed).toBeTruthy();
    expect(mcp.snippets.map(({ name }) => name)).toStrictEqual([
      "Claude Code",
      "Cursor",
      "VS Code",
      "stdio",
    ]);
    expect(textsOf(mcp)).toStrictEqual(
      setup.flatMap(({ snippets }) => snippets.map(({ text }) => text))
    );
  });

  it("leave out stdio when the CLI has no mcp command", () => {
    const without = installChannels({
      commands: commands.filter(({ path }) => path.join(" ") !== "mcp"),
      platformUrl,
      webUrl,
    });

    expect(channel("mcp", without).snippets.map(({ name }) => name)).toStrictEqual(
      ["Claude Code", "Cursor", "VS Code"]
    );
  });

  it("point any agent at llms.txt, llms-full.txt and Markdown by Accept", () => {
    const text = channel("text");

    expect(text.links.map(({ path }) => path)).toStrictEqual(
      expect.arrayContaining(["/llms.txt", "/llms-full.txt"])
    );
    expect(textsOf(text)).toContain(
      `curl -H 'Accept: text/markdown' ${webUrl}/<owner>/<name>`
    );
    expect(textsOf(channel("skills"))).toStrictEqual([
      `npx skills add ${webUrl}`,
    ]);
  });

  it("run git over HTTPS with the CLI as its credential helper, never SSH", () => {
    const git = channel("git");

    expect(textsOf(git)).toStrictEqual([
      `git clone ${platformUrl}/<owner>/<name>.git`,
    ]);
    expect(git.summary).toContain("HTTPS");
    expect(git.summary).toContain("credential helper");
    expect(
      channels.flatMap(textsOf).filter((each) => /ssh:|git@|ssh-/iu.test(each))
    ).toStrictEqual([]);
  });

  it("show the web and the pi extension with no command, the extension as planned", () => {
    const pi = channel("pi");

    expect(
      channels.filter(({ planned }) => planned).map(({ id }) => id)
    ).toStrictEqual(["pi"]);
    expect([pi.snippets, channel("web").snippets]).toStrictEqual([[], []]);
    expect(pi.summary).toContain("MCP");
    expect(pi.summary).toContain("skills");
  });
});
