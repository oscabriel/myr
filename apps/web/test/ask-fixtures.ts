/**
 * datekit's `parse-iso-week` (a fictional ask in a fictional project), and
 * the answers to it, as the platform's contracts return them: the ask and
 * its brief (`showAsk`), a verdict (`verdict`) and a landing (`landing`).
 * Also how the view tests read rendered markup.
 */
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Outcome } from "@repo/protocol/domain/outcome";
import {
  AreaName,
  AskId,
  CheckVersion,
  CommitSha,
  Handle,
  KindName,
  LandedSha,
  LaneName,
  PatchId,
  ProjectName,
  RepoPath,
  SuiteRoot,
  TreeSha,
} from "@repo/protocol/ids";
import { DateTime } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export const project = ProjectName.make("oscabriel/datekit");

export const askId = AskId.make("parse-iso-week");

/** The moment every view test renders at. */
export const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

export const ask: Ask = {
  askedBy: Handle.make("ines-v"),
  blockedBy: [],
  brief: {
    context: [
      "ISO 8601 numbers weeks from the Monday of the week holding 4 January.",
    ],
    current: "parseWeek returns null for 2026-W41-3.",
    outOfScope: ["Formatting week dates back to strings."],
    terms: ["Week date: a date written as year, week and weekday."],
    want: "Parse ISO week dates like 2026-W41-3",
  },
  check: CheckSpec.cases.RedThenGreen.make({
    path: RepoPath.make("test/parse-week.test.ts"),
  }),
  file: RepoPath.make(`${Brand.configDir}/asks/parse-iso-week.ask.ts`),
  id: askId,
  kind: KindName.make("fix"),
  openedAt: DateTime.makeUnsafe("2026-10-05T12:00:00Z"),
  openedIn: LandedSha.make("1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a"),
  project,
  state: "open",
  territory: {
    module: "@datekit/parse",
    paths: [Glob.make("packages/parse/**")],
  },
};

/** The brief as the platform renders it for `showAsk`; the web serves it untouched. */
export const brief = `# Parse ISO week dates like 2026-W41-3

Ask \`parse-iso-week\` in datekit, a \`fix\` ask from ines-v.

## Territory

The module \`@datekit/parse\`: \`packages/parse/**\`.

## Current

parseWeek returns null for 2026-W41-3.
`;

const sha = (digit: string) => digit.repeat(40);

export const suite = SuiteRoot.make(`sha256:${"4f2a".repeat(16)}`);

export const landedSha = LandedSha.make(
  "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"
);

/** A verdict on the ask's latest answer: lint passed, unit failed, one held-back area 6 of 7. */
export const verdictOf = (outcome: Outcome): Verdict => ({
  ask: askId,
  at: DateTime.makeUnsafe("2026-10-07T11:40:00Z"),
  base: CommitSha.make(sha("a")),
  checkVersion: CheckVersion.make("redThenGreen@0.0.0+5e1d"),
  head: CommitSha.make(sha("b")),
  heldBack: [{ area: AreaName.make("export"), passed: 6, suite, total: 7 }],
  lanes: [
    {
      command: "bun run lint",
      durationMs: 1240,
      lane: LaneName.make("lint"),
      result: "passed",
    },
    {
      command: "bun test",
      durationMs: 8312,
      lane: LaneName.make("unit"),
      logRef: "logs/datekit/parse-iso-week/unit",
      result: "failed",
    },
  ],
  outcome,
  patchId: PatchId.make("c".repeat(64)),
  project,
  stage: "checks",
  tree: TreeSha.make(sha("d")),
  verifier: "platform",
});

export const landing: LandingView = {
  ask: askId,
  assisted: [{ harness: "claude-code", model: "opus-5", verified: true }],
  author: Handle.make("okafor"),
  credits: [
    { handle: Handle.make("okafor"), role: "Signed-off-by" },
    { handle: Handle.make("ines-v"), role: "Asked-by" },
  ],
  heldBackTrailer: `export 7/7 @ ${suite}`,
  landedAt: DateTime.makeUnsafe("2026-10-07T11:45:00Z"),
  parent: LandedSha.make(sha("a")),
  project,
  sha: landedSha,
};

/** The landing as a decider's finish made it: decided, and judged by held-back checks. */
export const decidedLanding: LandingView = {
  ...landing,
  credits: [
    ...landing.credits,
    { handle: Handle.make("ines-v"), role: "Decided-by" },
  ],
};

/** The landing as one that needed neither a decider nor held-back checks makes it. */
export const plainLanding: LandingView = {
  ask: askId,
  assisted: [],
  author: Handle.make("bram"),
  credits: [
    { handle: Handle.make("bram"), role: "Signed-off-by" },
    { handle: Handle.make("ines-v"), role: "Asked-by" },
  ],
  landedAt: DateTime.makeUnsafe("2026-10-07T11:45:00Z"),
  parent: LandedSha.make(sha("a")),
  project,
  sha: landedSha,
};

/** When the events below happened. */
const eventAt = DateTime.makeUnsafe("2026-10-07T11:30:00Z");

/** `claimant` claimed `on`, as event `seq`. */
export const claimedEvent = (seq: number, claimant: string, on = askId) =>
  ProjectEvent.cases.Claimed.make({
    ask: on,
    at: eventAt,
    claimant: Handle.make(claimant),
    seq,
  });

/** An answer at `head` to `on` was judged `outcome`, as event `seq`. */
export const judgedEvent = (
  seq: number,
  outcome: Outcome,
  head = CommitSha.make(sha("b")),
  on = askId
) =>
  ProjectEvent.cases.Judged.make({ ask: on, at: eventAt, head, outcome, seq });

/** An answer to `on` was pushed at `head`, as event `seq`. */
export const pushedEvent = (
  seq: number,
  head = CommitSha.make(sha("b")),
  on = askId
) => ProjectEvent.cases.Pushed.make({ ask: on, at: eventAt, head, seq });

/** `on` closed by a landing, as event `seq`. */
export const closedEvent = (seq: number, on = askId) =>
  ProjectEvent.cases.AskClosed.make({
    ask: on,
    at: eventAt,
    landing: landedSha,
    seq,
  });

const familyParent = AskId.make("retire-old-week");

const familyChildren = ["format", "parse", "zones"].map((module) =>
  AskId.make(`retire-old-week-${module}`)
);

const familyDelete = AskId.make("retire-old-week-delete");

/** One member of the family below: blocked by `blockedBy`, its parent named. */
const member = (id: AskId, blockedBy: readonly AskId[]): Ask => ({
  ...ask,
  blockedBy,
  brief: { want: `Step ${id} of retiring oldWeek` },
  id,
  kind: KindName.make("migrate"),
  parent: familyParent,
});

/** A migrate family in datekit: a parent, three children, and the delete child that waits on them. */
export const family = {
  /** The child at `index`, which waits on nothing. */
  child: (index: number) =>
    member(familyChildren[index] ?? AskId.make("retire-old-week-format"), []),
  children: familyChildren,
  deleteChild: {
    ...member(familyDelete, familyChildren),
    state: "waitingOnParent",
  } satisfies Ask,
  parent: {
    ...ask,
    blockedBy: [...familyChildren, familyDelete],
    brief: {
      want: "Replace every call to oldWeek with week, then delete oldWeek.",
    },
    id: familyParent,
    kind: KindName.make("migrate"),
  } satisfies Ask,
};

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

export const markupOf = (element: ReactElement) =>
  renderToStaticMarkup(element);

/** What a reader sees of `markup`: the text without its tags, entities decoded. */
export const plainText = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

/** What a reader sees of `element`, rendered. */
export const textOf = (element: ReactElement) => plainText(markupOf(element));

/** Whether each of `parts` appears in `text`, each after the one before. */
export const inOrder = (text: string, parts: readonly string[]) => {
  let from = 0;

  for (const part of parts) {
    const at = text.indexOf(part, from);

    if (at === -1) {
      return false;
    }

    from = at + part.length;
  }

  return true;
};
