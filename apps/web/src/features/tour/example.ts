/**
 * The tour's example, typed by the protocol's schemas and drawn from the same
 * names as the landing's transcripts: one ask on a fictional project, claimed,
 * refused once, then landed with credit.
 */
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { Glob } from "@repo/protocol/domain/common";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CheckVersion,
  KindName,
  LandedSha,
  LaneName,
  PatchId,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { DateTime } from "effect";

import { EXAMPLE, forkRemote } from "../landing/transcript.ts";

const { ask, asker, base, claimant, fork, head, landed, project } = EXAMPLE;

const at = (iso: string) => DateTime.makeUnsafe(iso);

const CHECK = RepoPath.make(`test/asks/${ask}.test.ts`);

export const OPENED_AT = at("2026-10-05T09:00:00Z");

export const CLAIMED_AT = at("2026-10-07T10:00:00Z");

export const LANDED_AT = at("2026-10-07T11:45:00Z");

/** The front page's rows: the example ask, open, among two more of the project's. */
export const LISTING: readonly AskListing[] = [
  {
    ask,
    blockedBy: [],
    claimed: false,
    kind: KindName.make("fix"),
    territory: "src/parse.ts",
    want: "parseISO accepts ISO week dates such as 2026-W41-3.",
  },
  {
    ask: AskId.make("format-ordinal"),
    blockedBy: [],
    claimed: true,
    kind: KindName.make("fix"),
    territory: "src/format.ts",
    want: 'format(date, "Do") prints 1st, 2nd, 3rd, 11th, 12th, 13th and 21st.',
  },
  {
    ask: AskId.make("add-months-clamp"),
    blockedBy: [],
    claimed: false,
    kind: KindName.make("fix"),
    territory: "src/add.ts",
    want: "addMonths(January 31, 1) is the last day of February, in leap and common years.",
  },
];

/** The ask as `ask` prints it: its brief, territory and check. */
export const ASK: Ask = {
  askedBy: asker,
  blockedBy: [],
  brief: {
    context: [
      "ISO 8601 numbers weeks from the Monday of the week holding 4 January.",
    ],
    current: "parseISO returns an invalid date for a week date.",
    outOfScope: ["Formatting week dates back to strings."],
    terms: ["Week date: a date written as year, week and weekday."],
    want: "parseISO accepts ISO week dates such as 2026-W41-3.",
  },
  check: CheckSpec.cases.RedThenGreen.make({ path: CHECK }),
  file: RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`),
  id: ask,
  kind: KindName.make("fix"),
  openedAt: OPENED_AT,
  openedIn: LandedSha.make(base),
  project,
  state: "open",
  territory: { module: ".", paths: [Glob.make("src/parse.ts")] },
};

/** The claim receipt: a fork of the answerer's own at the platform, held until the lapse unless they push. */
export const claimOf = (platformUrl: string): ClaimView => ({
  ask,
  base,
  checkCommand: `bun test ${CHECK}`,
  claimant,
  fork,
  lapsesAt: DateTime.add(CLAIMED_AT, { hours: 48 }),
  openedAt: CLAIMED_AT,
  project,
  remote: forkRemote(platformUrl),
  state: "live",
  warnsAt: DateTime.add(CLAIMED_AT, { hours: 36 }),
});

const lane = (name: string, command: string, durationMs: number) => ({
  command,
  durationMs,
  lane: LaneName.make(name),
  result: "passed" as const,
});

/** The second push's verdict: every lane passed on the merged tree, so it landed. */
export const VERDICT: Verdict = {
  ask,
  at: LANDED_AT,
  base,
  checkVersion: CheckVersion.make("redThenGreen@0.0.0+5e1d"),
  head,
  heldBack: [],
  lanes: [
    lane("redThenGreen", `bun test ${CHECK}`, 912),
    lane("types", "bun run typecheck", 3140),
    lane("unit", "bun test", 2470),
  ],
  outcome: Outcome.cases.Landed.make({ sha: landed }),
  patchId: PatchId.make("c".repeat(64)),
  project,
  stage: "human",
  tree: TreeSha.make("d".repeat(40)),
  verifier: "platform",
};

/** The landing commit: its credit trailers, and the agent the answerer disclosed. */
export const LANDING: LandingView = {
  ask,
  assisted: [{ harness: "claude-code", model: "haiku", verified: false }],
  author: claimant,
  credits: [
    { handle: claimant, role: "Signed-off-by" },
    { handle: asker, role: "Asked-by" },
  ],
  landedAt: LANDED_AT,
  parent: LandedSha.make(base),
  project,
  sha: landed,
};
