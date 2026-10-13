import { Option } from "effect";

export type DocPart = "guide" | "reference";

export interface DocEntry {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly part: DocPart;
}

export const docEntries = [
  {
    part: "guide",
    slug: "start-here",
    summary:
      "What the platform is, the four words a contributor meets, and how a change reaches main.",
    title: "Start here",
  },
  {
    part: "guide",
    slug: "answer-an-ask",
    summary:
      "Find an ask, claim it, answer it in plain git, and read the verdict.",
    title: "Answer an ask",
  },
  {
    part: "guide",
    slug: "run-a-project",
    summary:
      "Make a project, write how it takes changes, open asks, and spend the day's decisions.",
    title: "Run a project",
  },
  {
    part: "guide",
    slug: "held-back-checks",
    summary:
      "What a project may keep back, how its held-back checks judge an answer, and what anyone can read of it.",
    title: "Held-back checks and layers",
  },
  {
    part: "guide",
    slug: "connect-an-agent",
    summary:
      "The ways an agent reaches the platform, and what holds for every agent.",
    title: "Connect an agent",
  },
  {
    part: "reference",
    slug: "commands",
    summary:
      "Every command the CLI has, with what it does and the flags it takes.",
    title: "Commands",
  },
  {
    part: "reference",
    slug: "refusals",
    summary:
      "Every refusal the platform gives, whether trying again can help, and what to do.",
    title: "Refusals",
  },
  {
    part: "reference",
    slug: "git",
    summary:
      "How git reaches the platform's repos, who may read and push each, and what it says when it refuses.",
    title: "Git here",
  },
  {
    part: "reference",
    slug: "landing",
    summary: "How a checked answer becomes the platform's own commit on main.",
    title: "How a landing happens",
  },
  {
    part: "reference",
    slug: "events",
    summary:
      "Every event a watcher of a project hears, in the project's order.",
    title: "Events",
  },
  {
    part: "reference",
    slug: "mcp",
    summary: "Every tool the platform serves over MCP, with what it does.",
    title: "MCP tools",
  },
  {
    part: "reference",
    slug: "limits",
    summary:
      "The limits a project's policy sets by default, and every address an agent reads.",
    title: "Limits and endpoints",
  },
  {
    part: "reference",
    slug: "imported",
    summary:
      "The open-source projects copied here for reading, each with its source and licence.",
    title: "Imported projects",
  },
] as const satisfies readonly DocEntry[];

export type DocSlug = (typeof docEntries)[number]["slug"];

export const docEntry = (slug: string): Option.Option<DocEntry> =>
  Option.fromUndefinedOr(docEntries.find((entry) => entry.slug === slug));
