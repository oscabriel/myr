/**
 * The docs: guides written for people, then a reference read from the
 * sources that define it (the CLI's commands, the refusal union, the
 * events, the MCP tools and the import plan's copy). Every command a page
 * names is one the CLI has, with flags it takes, and every link between
 * pages names a page that exists.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts, Surfaces } from "@repo/protocol/contracts";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { groups } from "@repo/protocol/refusal";
import { Context, Option } from "effect";

import { commandDocs } from "../src/command-doc.ts";
import { importedProjects } from "../src/docs/imported.ts";
import { docEntries, docPage, docPages } from "../src/docs/index.ts";

const commands = commandDocs(Contracts);

const input = {
  commands,
  platformUrl: "https://platform-test.example.workers.dev",
  webUrl: "https://web-test.example.workers.dev",
};

const pages = docPages(input);

const markdownOf = (slug: string) =>
  Option.match(docPage(input, slug), {
    onNone: () => "",
    onSome: ({ markdown }) => markdown,
  });

/** Every code span and shell line in `markdown` that runs the CLI, as its words. */
const cliSpans = (markdown: string) =>
  [
    ...[...markdown.matchAll(/`(?<span>[^`\n]+)`/gu)].map(
      (found) => found.groups?.span ?? ""
    ),
    ...markdown.split("\n"),
  ].flatMap((span) =>
    span.startsWith(`${Brand.cli} `)
      ? [span.slice(Brand.cli.length + 1).split(/\s+/u)]
      : []
  );

/** The catalog's command these words run: the longest path they start with. */
const commandOf = (words: readonly string[]) =>
  commands
    .filter(({ path }) => path.every((word, at) => words[at] === word))
    .toSorted((a, b) => b.path.length - a.path.length)[0];

describe("the docs", () => {
  it("are five guides, then the reference, each with a title and a one-line summary", () => {
    expect(
      pages.map(({ part, slug, title }) => [part, slug, title])
    ).toStrictEqual([
      ["guide", "start-here", "Start here"],
      ["guide", "answer-an-ask", "Answer an ask"],
      ["guide", "run-a-project", "Run a project"],
      ["guide", "held-back-checks", "Held-back checks and layers"],
      ["guide", "connect-an-agent", "Connect an agent"],
      ["reference", "commands", "Commands"],
      ["reference", "refusals", "Refusals"],
      ["reference", "git", "Git here"],
      ["reference", "landing", "How a landing happens"],
      ["reference", "events", "Events"],
      ["reference", "mcp", "MCP tools"],
      ["reference", "imported", "Imported projects"],
    ]);

    for (const { markdown, summary, title } of pages) {
      expect(summary).toMatch(/^[A-Z].+\.$/u);
      expect(summary).not.toContain("\n");
      expect(markdown.startsWith(`# ${title}\n\n${summary}\n`)).toBeTruthy();
    }
  });

  it("name only commands the CLI has, with flags each one takes", () => {
    const named = pages.flatMap(({ markdown, slug }) =>
      cliSpans(markdown).map((words) => ({ slug, words }))
    );

    expect(named.length).toBeGreaterThan(20);

    const wrong = named.flatMap(({ slug, words }) => {
      const command = commandOf(words);

      if (command === undefined) {
        return [`${slug}: ${words.join(" ")} is no command`];
      }

      return words
        .filter((word) => word.startsWith("--"))
        .map((flag) => flag.split("=")[0] ?? flag)
        .filter((flag) => !command.flags.includes(flag))
        .map((flag) => `${slug}: ${command.path.join(" ")} takes no ${flag}`);
    });

    expect(wrong).toStrictEqual([]);
  });

  it("link only to pages that exist", () => {
    const slugs = new Set(pages.map(({ slug }) => slug));

    const broken = pages.flatMap(({ markdown, slug }) =>
      [...markdown.matchAll(/\]\(\/docs\/(?<target>[^)#]+)/gu)].flatMap(
        (found) => {
          const target = found.groups?.target ?? "";

          return slugs.has(target) ? [] : [`${slug} → ${target}`];
        }
      )
    );

    expect(broken).toStrictEqual([]);
  });

  it("are written for every entry the index and the heads name, in its order", () => {
    expect(
      pages.map(({ part, slug, summary, title }) => ({
        part,
        slug,
        summary,
        title,
      }))
    ).toStrictEqual(docEntries);
  });

  it("find a page by its slug, and none by another", () => {
    expect(
      Option.map(docPage(input, "events"), ({ title }) => title)
    ).toStrictEqual(Option.some("Events"));
    expect(docPage(input, "nope")).toStrictEqual(Option.none());
  });
});

describe("the reference", () => {
  it("lists every command the CLI has, with what it does", () => {
    const markdown = markdownOf("commands");

    expect(
      commands.flatMap(({ path, summary }) =>
        markdown.includes(`${Brand.cli} ${path.join(" ")}`) &&
        markdown.includes(summary)
          ? []
          : [path.join(" ")]
      )
    ).toStrictEqual([]);
  });

  it("lists every refusal of the closed union", () => {
    const markdown = markdownOf("refusals");

    const tags = groups.flatMap((group) =>
      group.members.map((member) => member.identifier)
    );

    expect(tags.length).toBeGreaterThan(20);
    expect(
      tags.filter((tag) => !markdown.includes(`\`${tag}\``))
    ).toStrictEqual([]);
  });

  it("lists every event a watcher hears", () => {
    const markdown = markdownOf("events");

    const tags = [
      "AskClosed",
      "AskOpened",
      "Claimed",
      "Decided",
      "Judged",
      "Landed",
      "Lapsed",
      "LedgerAppended",
      "ProposalDrafted",
      "ProposalOpened",
      "Pushed",
      "Released",
      "Warned",
    ] as const satisfies readonly ProjectEvent["_tag"][];

    expect(
      tags.filter((tag) => !markdown.includes(`\`${tag}\``))
    ).toStrictEqual([]);
  });

  it("lists every contract served over MCP, by its tool name", () => {
    const markdown = markdownOf("mcp");

    const served = [...Contracts.requests.values()].flatMap(
      ({ _tag, annotations }) =>
        Context.get(annotations, Surfaces).includes("mcp") ? [_tag] : []
    );

    expect(served).toContain("readFile");
    expect(
      served.filter((tag) => !markdown.includes(`\`${tag}\``))
    ).toStrictEqual([]);
  });

  it("names each imported project's source and licence", () => {
    const markdown = markdownOf("imported");

    expect(
      importedProjects
        .filter(
          ({ licence, name, url }) =>
            !markdown.includes(`[${name}](/${name})`) ||
            !markdown.includes(url) ||
            !markdown.includes(licence)
        )
        .map(({ name }) => name)
    ).toStrictEqual([]);
  });
});
