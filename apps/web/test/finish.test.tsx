/**
 * Finishing an answer from its diff: a `Finish` decision's page shows the
 * answer's diff (drawn by `@pierre/diffs`), beside the ask's want and the
 * verdict, and the git lines that fetch the head and finish it locally. The
 * diff comes only from the decision's own `patch` evidence; without one the
 * page shows the lines and no diff. Rendered with `react-dom/server`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CheckVersion,
  CommitSha,
  DecisionId,
  Handle,
  KindName,
  LandedSha,
  LaneName,
  PatchId,
  ProjectName,
  ProposalId,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { DateTime, Option } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FinishView } from "../src/features/finish/finish-view.tsx";
import type { FinishDecision } from "../src/features/finish/finish-view.tsx";
import { PatchDiffs } from "../src/features/finish/patch-diff.tsx";
import { changedFiles, patchOf } from "../src/features/finish/patch.ts";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const datekit = ProjectName.make("datekit");

const parseIso = AskId.make("parse-iso");

const head = CommitSha.make("e".repeat(40));

const base = CommitSha.make("1".repeat(40));

const okonkwo = Handle.make("okonkwo");

/** Two files changed, one added, one removed, one renamed. */
const PATCH = [
  "diff --git a/src/parse.ts b/src/parse.ts",
  "index 1111111..2222222 100644",
  "--- a/src/parse.ts",
  "+++ b/src/parse.ts",
  "@@ -1,2 +1,2 @@",
  "-export const parse = (text: string) => new Date(text);",
  "+export const parse = (text: string) => fromIso(text);",
  " export const format = String;",
  "diff --git a/test/parse.test.ts b/test/parse.test.ts",
  "index 3333333..4444444 100644",
  "--- a/test/parse.test.ts",
  "+++ b/test/parse.test.ts",
  "@@ -1 +1,2 @@",
  ' import { parse } from "../src/parse.ts";',
  '+test("leap day", () => parse("2028-02-29"));',
  "diff --git a/src/iso.ts b/src/iso.ts",
  "new file mode 100644",
  "index 0000000..5555555",
  "--- /dev/null",
  "+++ b/src/iso.ts",
  "@@ -0,0 +1 @@",
  "+export const fromIso = (text: string) => text;",
  "diff --git a/src/legacy.ts b/src/legacy.ts",
  "deleted file mode 100644",
  "index 6666666..0000000",
  "--- a/src/legacy.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-export const legacy = true;",
  "diff --git a/docs/old.md b/docs/new.md",
  "similarity index 100%",
  "rename from docs/old.md",
  "rename to docs/new.md",
  "",
].join("\n");

const FILES = [
  "src/parse.ts",
  "test/parse.test.ts",
  "src/iso.ts",
  "src/legacy.ts",
  "docs/new.md",
];

const finishOf = (evidence: Decision["evidence"]): FinishDecision => ({
  deciders: [okonkwo],
  default: "decline",
  evidence,
  expiresAt: DateTime.makeUnsafe("2026-10-09T12:00:00Z"),
  id: DecisionId.make("dec-000007"),
  openedAt: DateTime.makeUnsafe("2026-10-07T09:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.Finish.make({ ask: parseIso, head }),
});

const withPatch = finishOf([
  { label: "answer", value: `ines-v at ${head}` },
  { label: "patch", value: PATCH },
]);

const withoutPatch = finishOf([
  { label: "answer", value: `ines-v at ${head}` },
]);

const ask: Ask = {
  askedBy: okonkwo,
  blockedBy: [],
  brief: { want: "An ISO date with a leap day parses to that day." },
  check: CheckSpec.cases.RedThenGreen.make({
    path: RepoPath.make("test/parse.test.ts"),
  }),
  file: RepoPath.make(`${Brand.configDir}/asks/parse-iso.ask.ts`),
  id: parseIso,
  kind: KindName.make("fix"),
  openedAt: DateTime.makeUnsafe("2026-10-05T09:00:00Z"),
  openedIn: LandedSha.make("9".repeat(40)),
  project: datekit,
  state: "claimed",
  territory: { module: "datekit", paths: [Glob.make("src/**")] },
};

const verdict: Verdict = {
  ask: parseIso,
  at: DateTime.makeUnsafe("2026-10-07T08:00:00Z"),
  base,
  checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
  head,
  heldBack: [],
  lanes: [
    {
      command: "bun test",
      durationMs: 1200,
      lane: LaneName.make("unit"),
      result: "passed",
    },
  ],
  outcome: Outcome.cases.AwaitingFinish.make({ decider: okonkwo }),
  patchId: PatchId.make("2".repeat(64)),
  project: datekit,
  stage: "human",
  tree: TreeSha.make("3".repeat(40)),
  verifier: "platform",
};

const drawn = (patch: string) => <PatchDiffs patch={patch} />;

describe(FinishView, () => {
  it("draws the answer's diff with @pierre/diffs, one view per changed file, named", () => {
    const element = (
      <FinishView
        decision={withPatch}
        diff={drawn}
        platformUrl={PLATFORM_URL}
      />
    );

    // Each file's view, by the name it carries: the region around one
    // `<diffs-container>`.
    const views = [
      ...markupOf(element).matchAll(
        /<section aria-label="(?<file>[^"]+)"><diffs-container\b/gu
      ),
    ].map((view) => view.groups?.file);

    expect(views).toStrictEqual(FILES);
  });

  it("names the changed files on the server and leaves the drawing to the browser", () => {
    const element = (
      <FinishView decision={withPatch} platformUrl={PLATFORM_URL} />
    );

    expect(markupOf(element)).not.toContain("<diffs-container");

    for (const file of FILES) {
      expect(textOf(element)).toContain(file);
    }
  });

  it("without a patch, shows the lines that fetch the head and finish it, and no diff", () => {
    const element = (
      <FinishView decision={withoutPatch} platformUrl={PLATFORM_URL} />
    );

    const text = textOf(element);

    expect(text).toContain(`git fetch ${PLATFORM_URL}/`);
    expect(text).toContain(` ${head}`);
    expect(text).toContain(
      `${Brand.cli} finish --project datekit --ask parse-iso`
    );
    expect(markupOf(element)).not.toContain("<diffs-container");
    expect(markupOf(element)).not.toContain('data-diff="');
  });

  it("fetches from the answer's fork when the decision names it, and finishes from the verdict's base", () => {
    const named = finishOf([
      ...withoutPatch.evidence,
      { label: "fork", value: "datekit--parse-iso--ines-v" },
    ]);

    const text = textOf(
      <FinishView
        decision={named}
        platformUrl={PLATFORM_URL}
        verdict={verdict}
      />
    );

    expect(text).toContain(
      `git fetch ${PLATFORM_URL}/datekit--parse-iso--ines-v.git ${head}`
    );
    expect(text).toContain(`--base ${base}`);
  });

  it("shows the ask's want and the verdict beside the diff", () => {
    const element = (
      <FinishView
        ask={ask}
        decision={withPatch}
        platformUrl={PLATFORM_URL}
        verdict={verdict}
      />
    );

    expect(textOf(element)).toContain(
      "An ISO date with a leap day parses to that day."
    );
    expect(markupOf(element)).toContain('data-outcome="AwaitingFinish"');
  });
});

describe(patchOf, () => {
  it("gives the diff a Finish decision carries, and nothing for one without", () => {
    expect(patchOf(withPatch)).toStrictEqual(Option.some(PATCH));
    expect(patchOf(withoutPatch)).toStrictEqual(Option.none());
  });

  it("never gives a diff for another subject, whatever its evidence says", () => {
    const proposal: Decision = {
      ...withPatch,
      subject: DecisionSubject.cases.OpenProposal.make({
        proposal: ProposalId.make("prop-000001"),
      }),
    };

    expect(patchOf(proposal)).toStrictEqual(Option.none());
  });
});

describe(changedFiles, () => {
  it("lists each file a diff changes, by where it ends up, or where it was when deleted", () => {
    expect(changedFiles(PATCH)).toStrictEqual(FILES);
  });

  it("names a path with a space without the tab git ends its file lines with", () => {
    // git ends `---`/`+++` with a tab when the path holds a space.
    const spaced = [
      "diff --git a/docs/read me.md b/docs/read me.md",
      "index 1111111..2222222 100644",
      "--- a/docs/read me.md\t",
      "+++ b/docs/read me.md\t",
      "@@ -1 +1 @@",
      "-Old.",
      "+New.",
      "diff --git a/old notes.md b/old notes.md",
      "deleted file mode 100644",
      "index 3333333..0000000",
      "--- a/old notes.md\t",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-Gone.",
      "",
    ].join("\n");

    expect(changedFiles(spaced)).toStrictEqual([
      "docs/read me.md",
      "old notes.md",
    ]);
  });
});
