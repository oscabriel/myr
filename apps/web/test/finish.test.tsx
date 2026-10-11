/**
 * Finishing an answer from its diff: a `Finish` decision's page lays the
 * answer's diff out as the code browser does. The server sends it as plain
 * text (the browser draws it over in place), its files with the ask's
 * territory first, then tests, then the rest; a refusal from an earlier
 * round sits under the line it pointed at; each file can be marked read in
 * this browser alone; a newer head says so above the diff; and the three
 * lines that fetch the head and finish it are numbered. The diff comes only
 * from the decision's own `patch` evidence; without one the page shows the
 * lines and no diff. Rendered with `react-dom/server`.
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
import { Weakened } from "@repo/protocol/refusal";
import { DateTime, Option } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PlacedRefusal } from "../src/features/finish/annotation.tsx";
import { patchFiles } from "../src/features/finish/files.ts";
import { FinishView } from "../src/features/finish/finish-view.tsx";
import type {
  FinishDecision,
  FinishViewProps,
} from "../src/features/finish/finish-view.tsx";
import { changedFiles, patchOf } from "../src/features/finish/patch.ts";
import {
  marksKey,
  readMarks,
  writeMark,
} from "../src/features/finish/read-marks.ts";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees of `markup`: the text without its tags, entities decoded. */
const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

/** What a reader sees of `element`. */
const textOf = (element: ReactElement) => textIn(markupOf(element));

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const datekit = ProjectName.make("oscabriel/datekit");

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

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const filesOf = (decision: FinishDecision) =>
  Option.match(patchOf(decision), {
    onNone: () => [],
    onSome: (patch) => patchFiles(patch, ["src/**"], "test"),
  });

const pageOf = (
  decision: FinishDecision,
  extra: Partial<FinishViewProps> = {}
) => (
  <FinishView
    decision={decision}
    files={filesOf(decision)}
    now={now}
    onDecide={() => {}}
    platformUrl={PLATFORM_URL}
    {...extra}
  />
);

/** The files the server's diff draws, in its order. */
const drawnFilesOf = (markup: string) =>
  [...markup.matchAll(/<section aria-label="(?<file>[^"]+)" data-file=/gu)].map(
    (match) => match.groups?.file
  );

/** A refusal from the answer's first round, at line 2 of its test. */
const placed: PlacedRefusal = {
  line: 2,
  path: "test/parse.test.ts",
  refusal: new Weakened({
    at: { line: 2, path: RepoPath.make("test/parse.test.ts") },
    weakening: { marker: ".only(" },
  }),
  round: 1,
};

describe(FinishView, () => {
  it("lists the changed files on the server, the territory's first, then tests, then the rest", () => {
    expect(drawnFilesOf(markupOf(pageOf(withPatch)))).toStrictEqual([
      "src/iso.ts",
      "src/legacy.ts",
      "src/parse.ts",
      "test/parse.test.ts",
      "docs/new.md",
    ]);

    for (const file of FILES) {
      expect(textOf(pageOf(withPatch))).toContain(file);
    }
  });

  it("leaves the drawing to the browser: the server sends the diff as plain text", () => {
    const markup = markupOf(pageOf(withPatch));

    expect(markup).not.toContain("<diffs-container");
    expect(markup).toContain('data-diff="plain"');
    expect(markup).toContain(
      "export const parse = (text: string) =&gt; fromIso(text);"
    );
  });

  it("draws a refusal under the line its `at` names, in the file it names", () => {
    const markup = markupOf(pageOf(withPatch, { placed: [placed] }));
    const file = markup.indexOf('data-file="test/parse.test.ts"');
    const line = markup.indexOf('data-line="2"', file);
    const note = markup.indexOf('data-note-line="2"', file);

    expect(file).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(line);
    expect(markup.slice(note)).toContain('data-refusal="Weakened"');
    expect(textOf(pageOf(withPatch, { placed: [placed] }))).toContain(
      "Refused here in round 1"
    );
  });

  it("counts the files read, never a person, and offers Mark read on each file", () => {
    const markup = markupOf(
      pageOf(withPatch, { read: new Set(["src/parse.ts"]) })
    );

    expect(
      textOf(pageOf(withPatch, { read: new Set(["src/parse.ts"]) }))
    ).toContain("1 of 5 files read");
    expect(markup).toContain('data-mark-read="src/iso.ts"');
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*data-mark-read="src\/parse.ts"/u
    );
    expect(textOf(pageOf(withPatch))).toContain("Mark read");
    expect(textOf(pageOf(withPatch))).not.toMatch(/review/iu);
  });

  it("says a newer head was pushed, above the diff, and keeps the diff the decision names", () => {
    const text = textOf(pageOf(withPatch, { newerHead: base }));

    expect(text).toContain("A new answer was pushed");
    expect(text).toContain("Reload the diff");
    expect(text).toContain(
      "export const parse = (text: string) => fromIso(text);"
    );
  });

  it("numbers the three lines that finish it", () => {
    const markup = markupOf(pageOf(withPatch));

    const list =
      /<ol[^>]*data-finish-lines=""[^>]*>(?<items>[\s\S]*?)<\/ol>/u.exec(markup)
        ?.groups?.items;

    expect([...(list ?? "").matchAll(/<li\b/gu)]).toHaveLength(3);
  });

  it("without a patch, shows the lines that fetch the head and finish it, and no diff", () => {
    const element = pageOf(withoutPatch);
    const text = textOf(element);

    expect(text).toContain(`git fetch ${PLATFORM_URL}/`);
    expect(text).toContain(` ${head}`);
    expect(text).toContain(
      `${Brand.cli} finish parse-iso --project oscabriel/datekit`
    );
    expect(markupOf(element)).not.toContain("<diffs-container");
    expect(markupOf(element)).not.toContain('data-diff="');
  });

  it("fetches from the answer's fork when the decision names it, and finishes from the verdict's base", () => {
    const named = finishOf([
      ...withoutPatch.evidence,
      { label: "fork", value: "datekit--parse-iso--ines-v" },
    ]);

    const text = textOf(pageOf(named, { verdict }));

    expect(text).toContain(
      `git fetch ${PLATFORM_URL}/datekit--parse-iso--ines-v.git ${head}`
    );
    expect(text).toContain(`--base ${base}`);
  });

  it("shows the ask's want and the verdict beside the diff", () => {
    const element = pageOf(withPatch, { ask, verdict });

    expect(textOf(element)).toContain(
      "An ISO date with a leap day parses to that day."
    );
    expect(markupOf(element)).toContain('data-outcome="AwaitingFinish"');
  });

  it("offers its choices with what each does", () => {
    const text = textOf(pageOf(withPatch));

    expect(text).toContain(
      "Lands the answer as it is, with you as Finished-by."
    );
    expect(text).toContain(
      "Nothing lands; the answer keeps waiting for a finish."
    );
  });
});

describe("a finish taken on its page", () => {
  it("keeps the choice's record at the diff's foot, where its choices were, and offers them no more", () => {
    const markup = markupOf(
      pageOf({
        ...withPatch,
        decided: { at: now, by: okonkwo, choice: "accept" },
      })
    );

    const bar = markup.slice(markup.indexOf("data-decision-bar"));

    expect(markup).not.toContain("data-choice=");
    expect(bar).toContain('data-decided="accept"');
    expect(textIn(bar)).toContain(
      "Accepted · Lands the answer as it is, with you as Finished-by."
    );
  });
});

/** A browser storage over a map, as `localStorage` behaves. */
const storageOver = (kept: Map<string, string>): Storage => ({
  clear: () => {
    kept.clear();
  },
  getItem: (key) => kept.get(key) ?? null,
  key: (index) => [...kept.keys()][index] ?? null,
  get length() {
    return kept.size;
  },
  removeItem: (key) => {
    kept.delete(key);
  },
  setItem: (key, value) => {
    kept.set(key, value);
  },
});

/** A storage that refuses every read and write, as a private window's may. */
const refusing: Storage = {
  clear: () => {
    throw new Error("refused");
  },
  getItem: () => {
    throw new Error("refused");
  },
  key: () => {
    throw new Error("refused");
  },
  length: 0,
  removeItem: () => {
    throw new Error("refused");
  },
  setItem: () => {
    throw new Error("refused");
  },
};

describe("the read marks", () => {
  const key = marksKey("datekit", "dec-000007");

  const files = filesOf(withPatch).map(({ file, patchId }) => ({
    patchId,
    path: file.path,
  }));

  const [first] = files;

  it("marks a file read in this browser, against its change", () => {
    const storage = storageOver(new Map());

    if (first !== undefined) {
      writeMark(storage, key, head, first, true);
    }

    expect([...readMarks(storage, key, head, files)]).toStrictEqual([
      "src/iso.ts",
    ]);
  });

  it("forgets every mark once a new head is pushed", () => {
    const storage = storageOver(new Map());

    if (first !== undefined) {
      writeMark(storage, key, head, first, true);
    }

    expect(readMarks(storage, key, base, files).size).toBe(0);
  });

  it("reads a file unread when its change is not the one marked", () => {
    const storage = storageOver(new Map());

    if (first !== undefined) {
      writeMark(storage, key, head, { ...first, patchId: "00000000" }, true);
    }

    expect(readMarks(storage, key, head, files).size).toBe(0);
  });

  it("keeps working, with no marks, when the storage refuses", () => {
    expect(() => {
      if (first !== undefined) {
        writeMark(refusing, key, head, first, true);
      }
    }).not.toThrow();
    expect(readMarks(refusing, key, head, files).size).toBe(0);
    expect(readMarks(undefined, key, head, files).size).toBe(0);
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
