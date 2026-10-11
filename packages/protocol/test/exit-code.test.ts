import { describe, expect, it } from "@effect/vitest";

import {
  ExitCode,
  exitCodeFor,
  exitCodeOf,
  exitCodeOfTag,
} from "../src/exit-code.ts";
import {
  AskFull,
  NotVouched,
  OutOfScope,
  StaleBase,
  UnknownAsk,
} from "../src/refusal.ts";
import type { Refusal } from "../src/refusal.ts";
import { ask, base, examples, main, path } from "./examples.ts";

// Each tag's code, as scripts and agents branch on it: a public contract,
// pinned here so a change to one is a change to this table.
const pinned = {
  AskBlocked: 75,
  AskFull: 75,
  AttemptsExhausted: 75,
  CapReached: 75,
  ChecksFailed: 65,
  ClaimLapsed: 75,
  DecisionClosed: 66,
  Denounced: 77,
  DirectPush: 77,
  DraftInProgress: 75,
  Flake: 75,
  HeldBackFailed: 65,
  ImportFailed: 75,
  IncompleteBrief: 65,
  LayerContentInPublicTree: 65,
  NoAsk: 66,
  NotClaimed: 75,
  NotDecider: 77,
  NotRedFirst: 65,
  NotSensitive: 65,
  NotVouched: 77,
  NotYourNamespace: 77,
  OutOfScope: 65,
  PostureChange: 65,
  PrivatePathInPublicTree: 65,
  ProjectExists: 65,
  ProposalClosed: 66,
  ReachedInternals: 65,
  RepoBusy: 75,
  SecretInOutput: 65,
  StaleBase: 75,
  StaleLayer: 75,
  TouchedJudge: 65,
  UnknownAsk: 66,
  UnknownCommit: 66,
  UnknownDecision: 66,
  UnknownEnvItem: 66,
  UnknownPath: 66,
  UnknownProject: 66,
  UnknownProposal: 66,
  UnknownRevision: 66,
  UnstatedRequirement: 65,
  ValueTooShort: 65,
  VerifierBlocked: 75,
  WeakCheck: 65,
  Weakened: 65,
} as const satisfies Record<Refusal["_tag"], number>;

describe("a refusal's exit code", () => {
  it.each(examples)("$_tag ends the CLI with its pinned code", (refusal) => {
    expect(exitCodeOf(refusal)).toBe(pinned[refusal._tag]);
  });

  it.each(examples)("$_tag has the same code by its tag alone", (refusal) => {
    expect(exitCodeOfTag(refusal._tag)).toBe(exitCodeOf(refusal));
  });

  it.each(examples)("$_tag is 75 exactly when it is retryable", (refusal) => {
    expect(exitCodeOf(refusal) === ExitCode.tempFail).toBe(refusal.retryable);
  });
});

describe("refusals met together", () => {
  const stale = new StaleBase({ base, conflicts: [path], main });
  const outOfScope = new OutOfScope({ paths: [path] });

  it("end with 75 only when every one is retryable", () => {
    expect([
      exitCodeFor([stale, new AskFull({ ask })]),
      exitCodeFor([stale, outOfScope]),
    ]).toStrictEqual([ExitCode.tempFail, ExitCode.dataErr]);
  });

  it("end with who is asking first, then what was named, then what was sent", () => {
    const unknown = new UnknownAsk({ ask });

    expect([
      exitCodeFor([outOfScope, unknown, new NotVouched({})]),
      exitCodeFor([outOfScope, unknown]),
    ]).toStrictEqual([ExitCode.noPerm, ExitCode.noInput]);
  });
});
