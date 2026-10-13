// The Install page's one source: every way to reach the platform, with the snippets `agentSetup` gives where a way is
// one of its channels, so the page and `/agents.md` never disagree on a command.
import { Brand } from "@repo/brand";

import {
  anyAgent,
  hasCommand,
  installScript,
  remoteMcp,
  signIn,
  skills,
  stdioMcp,
} from "./agent-setup.ts";
import type { SetupInput, SetupSnippet } from "./agent-setup.ts";

/** A page of the web (`page`), or a file it serves, such as `/llms.txt`. */
export interface InstallLink {
  readonly label: string;
  readonly path: string;
  readonly page: boolean;
}

export interface InstallChannel {
  /** The channel's anchor on the page. */
  readonly id: string;
  readonly title: string;
  /** Who or what it is for, in a word or two. */
  readonly audience: string;
  readonly summary: string;
  /** One snippet shown at a time, chosen by its name. */
  readonly tabbed: boolean;
  readonly snippets: readonly SetupSnippet[];
  readonly links: readonly InstallLink[];
  /** Not built yet: it says so, and carries no command. */
  readonly planned: boolean;
}

const channel = (
  fields: Pick<InstallChannel, "audience" | "id" | "summary" | "title"> &
    Partial<Pick<InstallChannel, "links" | "planned" | "snippets" | "tabbed">>
): InstallChannel => ({
  links: [],
  planned: false,
  snippets: [],
  tabbed: false,
  ...fields,
});

const npm: SetupSnippet = {
  label: "Or from npm",
  language: "sh",
  name: "npm",
  text: `npm install -g ${Brand.cliPackage}`,
};

/** The script's snippet, said for the machines it has a build for, then npm beside it. */
const cli = (input: SetupInput) =>
  channel({
    audience: "Terminal",
    id: "cli",
    links: [{ label: "Every command", page: true, path: "/docs/commands" }],
    snippets: [
      {
        ...installScript(input),
        label: "The script, for Linux on x64 and macOS on Apple silicon",
      },
      npm,
      ...signIn(input),
    ],
    summary:
      "Find and claim asks, check an answer on your machine with the gate's first stage before you push, and read verdicts. You push with plain git.",
    title: "The CLI",
  });

const mcp = (input: SetupInput) =>
  channel({
    audience: "Agents",
    id: "mcp",
    links: [{ label: "MCP tools", page: true, path: "/docs/mcp" }],
    snippets: [
      ...remoteMcp(input).snippets,
      ...(hasCommand(input.commands, "mcp") ? stdioMcp().snippets : []),
    ],
    summary: `Remote at ${input.platformUrl}/mcp, signed in over OAuth: the client opens a browser once and you sign in. A client that starts its servers as local commands runs the same tools over stdio through the CLI. Either way the agent acts as you.`,
    tabbed: true,
    title: "MCP server",
  });

const skillsChannel = (input: SetupInput) =>
  channel({
    audience: "Agents",
    id: "skills",
    links: [
      {
        label: "The index, with each skill's digest",
        page: false,
        path: "/.well-known/agent-skills/index.json",
      },
    ],
    snippets: skills(input).snippets,
    summary:
      "Each project's contribute skill, made from how the project takes changes, so the agent's own check matches the gate's.",
    title: "Skills",
  });

const text = (input: SetupInput) =>
  channel({
    audience: "Any agent",
    id: "text",
    links: [
      { label: "llms.txt", page: false, path: "/llms.txt" },
      { label: "llms-full.txt", page: false, path: "/llms-full.txt" },
      { label: "agents.md", page: false, path: "/agents.md" },
      { label: "Limits and endpoints", page: true, path: "/docs/limits" },
    ],
    snippets: [
      ...anyAgent(input).snippets,
      {
        label: "A project's page, asked for as Markdown",
        language: "sh",
        name: "Markdown",
        text: `curl -H 'Accept: text/markdown' ${input.webUrl}/<owner>/<name>`,
      },
    ],
    summary:
      "Start any agent that can fetch a URL at llms.txt: it says how to take an ask and lists every command and project, and llms-full.txt holds the rest. The front page, each project and each ask also answer as Markdown when asked with Accept: text/markdown.",
    title: "Text for agents",
  });

const git = ({ platformUrl }: SetupInput) =>
  channel({
    audience: "Git",
    id: "git",
    links: [{ label: "Git here", page: true, path: "/docs/git" }],
    snippets: [
      {
        label: "Clone any project",
        language: "sh",
        name: "Clone",
        text: `git clone ${platformUrl}/<owner>/<name>.git`,
      },
    ],
    summary:
      "Git reaches every repo over HTTPS. Signing in with the CLI makes it git's credential helper for the platform, so a push carries your token: no token in a URL, no prompt, and no SSH keys to manage.",
    title: "Git over HTTPS",
  });

const web = () =>
  channel({
    audience: "Browser",
    id: "web",
    links: [{ label: "Sign in", page: false, path: "/auth/signin" }],
    summary:
      "Sign in to read your inbox, take a maintainer's decisions and propose asks. A list of the CLI sessions you have signed in and the agents you have connected is planned.",
    title: "The web",
  });

const pi = () =>
  channel({
    audience: "Harness",
    id: "pi",
    planned: true,
    summary: "Planned. Until then, pi works through the MCP server or skills.",
    title: "Pi extension",
  });

export const installChannels = (
  input: SetupInput
): readonly InstallChannel[] => [
  cli(input),
  mcp(input),
  skillsChannel(input),
  text(input),
  git(input),
  web(),
  pi(),
];
