import { describe, expect, it } from "@effect/vitest";
import { LaneName, RepoPath } from "@repo/protocol/ids";
import {
  ChecksFailed,
  Flake,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Option } from "effect";

import { classifyFailure } from "../src/classify.ts";
import type { LaneEvidence } from "../src/classify.ts";
import { base, main, wire } from "./facts.ts";

const unit = LaneName.make("unit");

const week = RepoPath.make("packages/parse/src/week.ts");

const pad = RepoPath.make("packages/format/src/pad.ts");

/** The answer changed `week.ts` only. */
const changed: ReadonlySet<RepoPath> = new Set([week]);

/** The unit lane, green on main and red on the merged tree in `week.ts`. */
const red: LaneEvidence = {
  command: "bun run test",
  failingPaths: [week],
  isDoctor: false,
  lane: unit,
  logRef: "logs/datekit/unit-2222222",
  onMain: "passed",
  onMerged: "failed",
  rerun: Option.none(),
};

// The CAA §2.B table: the platform never charges the answerer for its own
// trouble, nor for a main that moved underneath them.
const rows: readonly {
  readonly name: string;
  readonly evidence: LaneEvidence;
  readonly refusal: Option.Option<Refusal>;
}[] = [
  {
    evidence: red,
    name: "passes on main, fails on merged inside the diff",
    refusal: Option.some(
      new ChecksFailed({
        lane: unit,
        logRef: "logs/datekit/unit-2222222",
        next: "bun run test",
      })
    ),
  },
  {
    evidence: { ...red, rerun: Option.some("failed") },
    name: "fails again the same way on a fresh run",
    refusal: Option.some(
      new ChecksFailed({
        lane: unit,
        logRef: "logs/datekit/unit-2222222",
        next: "bun run test",
      })
    ),
  },
  {
    evidence: { ...red, failingPaths: [] },
    name: "fails on merged with no file named",
    refusal: Option.some(
      new ChecksFailed({
        lane: unit,
        logRef: "logs/datekit/unit-2222222",
        next: "bun run test",
      })
    ),
  },
  {
    evidence: { ...red, rerun: Option.some("passed") },
    name: "fails, then passes on a fresh run of the same tree",
    refusal: Option.some(new Flake({ lane: unit })),
  },
  {
    evidence: { ...red, onMerged: "blocked" },
    name: "the checker could not start, which earns one fresh run",
    refusal: Option.some(new Flake({ lane: unit })),
  },
  {
    evidence: { ...red, onMerged: "blocked", rerun: Option.some("blocked") },
    name: "the checker could not start twice",
    refusal: Option.some(new VerifierBlocked({})),
  },
  {
    evidence: {
      ...red,
      command: "bun run doctor",
      isDoctor: true,
      lane: LaneName.make("doctor"),
      onMain: "failed",
    },
    name: "the doctor lane fails on main",
    refusal: Option.some(new VerifierBlocked({})),
  },
  {
    evidence: { ...red, onMain: "failed" },
    name: "the lane fails on main too",
    refusal: Option.some(new VerifierBlocked({})),
  },
  {
    evidence: { ...red, failingPaths: [pad] },
    name: "fails on merged outside the diff, on a lane that passes on main",
    refusal: Option.some(new StaleBase({ base, conflicts: [], main })),
  },
  {
    evidence: { ...red, onMerged: "passed" },
    name: "passes on merged",
    refusal: Option.none(),
  },
];

describe(classifyFailure, () => {
  it.each(rows)("$name", ({ evidence, refusal }) => {
    const found = classifyFailure(evidence, changed, { base, main });

    expect(Option.map(found, (one) => wire([one]))).toStrictEqual(
      Option.map(refusal, (one) => wire([one]))
    );
  });
});
