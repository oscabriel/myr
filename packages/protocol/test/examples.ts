import { DateTime } from "effect";

import { AskId, CommitSha, RepoPath } from "../src/ids.ts";
import {
  AskFull,
  AttemptsExhausted,
  CapReached,
  ChecksFailed,
  ClaimLapsed,
  Flake,
  HeldBackFailed,
  IncompleteBrief,
  LayerContentInPublicTree,
  NoAsk,
  NotClaimed,
  NotRedFirst,
  NotVouched,
  OutOfScope,
  PostureChange,
  PrivatePathInPublicTree,
  RepoBusy,
  SecretInOutput,
  StaleBase,
  TouchedJudge,
  VerifierBlocked,
  WeakCheck,
  Weakened,
} from "../src/refusal.ts";
import type { Refusal } from "../src/refusal.ts";

export const ask = AskId.make("fix-parser");

export const base = CommitSha.make("1111111111111111111111111111111111111111");

export const main = CommitSha.make("2222222222222222222222222222222222222222");

export const path = RepoPath.make("src/a.ts");

// One of each member, in the union's order.
export const examples: readonly Refusal[] = [
  NotClaimed.of(ask),
  ClaimLapsed.of(ask),
  new NotVouched({}),
  new CapReached({ cap: 3 }),
  new AskFull({ ask }),
  new NoAsk({}),
  new RepoBusy({}),
  new OutOfScope({ paths: [path] }),
  new TouchedJudge({ paths: [path] }),
  new Weakened({
    at: { line: 3, path },
    weakening: { marker: "it.skip", reason: "flaky on CI" },
  }),
  new PrivatePathInPublicTree({ paths: [path] }),
  new StaleBase({ base, conflicts: [path], main }),
  new ChecksFailed({
    lane: "test",
    logRef: "logs/7",
    next: "bun test src/a.test.ts",
  }),
  new HeldBackFailed({ area: "parser", suite: "edge-cases" }),
  new AttemptsExhausted({
    area: "parser",
    resetsAt: DateTime.makeUnsafe("2026-10-07T00:00:00Z"),
  }),
  new Flake({ lane: "test" }),
  new VerifierBlocked({}),
  new NotRedFirst({}),
  new WeakCheck({ weakness: "no assertion" }),
  new IncompleteBrief({ missing: ["territory"] }),
  new LayerContentInPublicTree({ paths: [path] }),
  new SecretInOutput({ item: "PAYMENTS_KEY", where: "output" }),
  new PostureChange({ from: "open", to: "openCore" }),
];
