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
  local("hook", "Answer a harness hook."),
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
    ]);

    for (const each of channels) {
      expect([each.id, each.title, each.audience, each.summary]).not.toContain(
        ""
      );
    }
  });

  it("install the CLI by the script alone, then sign in to the platform, then the hooks", () => {
    expect(textsOf(channel("cli")).slice(0, 2)).toStrictEqual([
      `curl -fsSL ${webUrl}/install.sh | sh`,
      `${Brand.cli} login --url ${platformUrl}`,
    ]);
    expect(
      channels.flatMap(textsOf).filter((each) => /\bnpm install\b/u.test(each))
    ).toStrictEqual([]);
  });

  it("sign in with a bare login on the platform itself, which login defaults to", () => {
    expect(
      textsOf(
        channel(
          "cli",
          installChannels({ commands, platformUrl: Brand.platformUrl, webUrl })
        )
      )[1]
    ).toBe(`${Brand.cli} login`);
  });

  it("give Claude Code's settings.json a hook for each event the CLI answers, the edit tools guarded", () => {
    const hooks = channel("cli").snippets.find(({ name }) => name === "Hooks");

    expect(hooks?.language).toBe("json");
    expect(JSON.parse(hooks?.text ?? "{}")).toStrictEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                command: `${Brand.cli} hook pre-tool-use --json`,
                type: "command",
              },
            ],
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
          },
        ],
        SessionStart: [
          {
            hooks: [
              {
                command: `${Brand.cli} hook session-start --json`,
                type: "command",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              { command: `${Brand.cli} hook stop --json`, type: "command" },
            ],
          },
        ],
      },
    });
    expect(
      channel(
        "cli",
        installChannels({
          commands: commands.filter(({ path }) => path.join(" ") !== "hook"),
          platformUrl,
          webUrl,
        })
      ).snippets
    ).toHaveLength(2);
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

    expect(
      channel("mcp", without).snippets.map(({ name }) => name)
    ).toStrictEqual(["Claude Code", "Cursor", "VS Code"]);
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

  it("show the web with no command, and no channel says it is planned", () => {
    expect(channel("web").snippets).toStrictEqual([]);
    expect(
      channels
        .flatMap(({ summary, title }) => [summary, title])
        .filter((each) => /\bplanned\b|\bnot yet\b|\buntil then\b/iu.test(each))
    ).toStrictEqual([]);
  });
});
