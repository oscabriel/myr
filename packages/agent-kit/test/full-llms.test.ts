import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ExitCode } from "@repo/protocol/exit-code";
import { ProjectName } from "@repo/protocol/ids";
import { groups } from "@repo/protocol/refusal";
import { Effect } from "effect";

import type { CommandDoc } from "../src/command-doc.ts";
import { fullLlms } from "../src/full-llms.ts";
import { frontLlms } from "../src/host-doc.ts";
import { expectGolden } from "./golden.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

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

const commands: readonly CommandDoc[] = [
  row(["ask"], "Show one ask in full.", {
    flags: ["--project", "--json"],
    positional: ["ask"],
  }),
  row(["asks"], "List a project's open asks.", {
    flags: ["--project", "--json"],
  }),
  row(["check"], "Run the gate's checks on your answer locally.", {
    flags: ["--ask", "--project", "--json"],
    source: "local",
  }),
  row(["claim"], "Claim an ask.", {
    flags: ["--project", "--json", "--dry-run"],
    positional: ["ask"],
    readOnly: false,
  }),
  row(["credential"], "Answer git's credential helper.", {
    flags: [],
    positional: ["operation"],
    readOnly: false,
    source: "local",
  }),
  row(["front"], "List the open asks across every project."),
  row(["login"], "Sign in to a platform.", {
    flags: ["--url", "--json"],
    readOnly: false,
    source: "local",
  }),
  row(["status"], "Show your claims and answers.", {
    flags: ["--project", "--json"],
  }),
  row(["submit"], "Offer a commit as an answer to a claimed ask.", {
    flags: ["--base", "--head", "--project", "--requestId", "--json"],
    positional: ["ask"],
    readOnly: false,
  }),
  row(["verdict"], "Show the verdict on an answer to an ask.", {
    flags: ["--head", "--project", "--json"],
    positional: ["ask"],
  }),
];

const projects: readonly ProjectListing[] = [
  {
    openAsks: 3,
    posture: "open",
    project: ProjectName.make("oscabriel/datekit"),
  },
  {
    openAsks: 1,
    posture: "openWithSealedEvidence",
    project: ProjectName.make("oscabriel/burrow"),
  },
];

const input = { commands, platformUrl, projects, webUrl };

const text = fullLlms(input);

const lines = text.split("\n");

const section = (title: string) => {
  const start = lines.indexOf(`## ${title}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));

  expect(start, `no section ${title}`).toBeGreaterThanOrEqual(0);

  return end === -1 ? rest : rest.slice(0, end);
};

// Every event's tag, written out here so the test is not the code's own table.
const eventTags: readonly ProjectEvent["_tag"][] = [
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
];

describe(fullLlms, () => {
  it.effect("is the text the web serves at /llms-full.txt", () =>
    expectGolden("full-llms", text).pipe(Effect.provide(NodeServices.layer))
  );

  it("starts with the index's own text for the same input", () => {
    expect(text.startsWith(frontLlms(input))).toBeTruthy();
    expect(text.length).toBeGreaterThan(frontLlms(input).length);
  });

  it("has a row for every refusal of the union, in every group", () => {
    const refusals = section("Refusals");

    const missing = groups.flatMap((group) =>
      group.members
        .map((member) => member.identifier)
        .filter(
          (tag) =>
            !refusals.some((line) =>
              line.startsWith(`| \`${tag}\` | ${group.name} |`)
            )
        )
    );

    expect(missing).toStrictEqual([]);
  });

  it("gives the next command a refusal fixes when it is raised", () => {
    const refusals = section("Refusals");

    expect(refusals).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^\\| \`UnknownAsk\` \\| Lookup \\| no \\| 66 \\| \`${Brand.cli} asks\` \\| .+ \\|$`,
          "u"
        )
      )
    );
    expect(refusals).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^\\| \`DraftInProgress\` \\| Decision \\| yes \\| 75 \\| \`${Brand.cli} proposal <proposal>\` \\| .+ \\|$`,
          "u"
        )
      )
    );
  });

  it("lists every code the CLI exits with, once", () => {
    const listed = section("Exit codes").flatMap((line) => {
      const exit = /^\| (?<code>\d+) \|/u.exec(line)?.groups?.code;

      return exit === undefined ? [] : [Number(exit)];
    });

    expect(listed.toSorted((a, b) => a - b)).toStrictEqual(
      Object.values(ExitCode).toSorted((a, b) => a - b)
    );
  });

  it("has a line for every event a watcher hears", () => {
    const events = section("Events");

    expect(
      eventTags.filter(
        (tag) => !events.some((line) => line.startsWith(`- \`${tag}\`: `))
      )
    ).toStrictEqual([]);
  });

  it("names the repos a person meets by their patterns", () => {
    const git = section("Git here");

    expect(git).toContainEqual(expect.stringContaining("`<owner>/<name>`"));
    expect(git).toContainEqual(
      expect.stringContaining("`<owner>/<name>--<ask>--<handle>`")
    );
    expect(git).toContainEqual(
      expect.stringContaining("`<owner>/<name>--me--<handle>`")
    );
  });

  it("spells a project as <owner>/<name>, never <project>", () => {
    expect(text).not.toContain("<project>");
  });

  it("reads the verdict note with plain git", () => {
    const ref = `refs/notes/${Brand.slug}`;

    expect(lines).toContain(`git fetch ${Brand.slug} ${ref}:${ref}`);
    expect(lines).toContain(`git notes --ref=${Brand.slug} show <head>`);
  });

  it("says what the gateway answers when git is not let in", () => {
    const git = section("Git here");

    expect(git).toContainEqual(
      expect.stringContaining(
        `\`a push needs a signed-in person; sign in with ${Brand.cli} login\``
      )
    );
    expect(git).toContainEqual(expect.stringContaining("`no repo <repo>`"));
  });

  it("names only commands the catalog has in its guides", () => {
    const without = fullLlms({
      ...input,
      commands: commands.filter(({ path }) => path[0] !== "submit"),
    });

    expect(section("Guides").join("\n")).toContain(`${Brand.cli} submit`);
    expect(without).not.toContain(`${Brand.cli} submit`);
  });

  it("names no layer: only the refusal tags that say the word", () => {
    const tagged = text
      .replaceAll("`StaleLayer`", "")
      .replaceAll("`LayerContentInPublicTree`", "");

    expect(tagged).not.toMatch(/layer/iu);
  });
});
