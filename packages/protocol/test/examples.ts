import { DateTime } from "effect";

import {
  AskId,
  CommitSha,
  DecisionId,
  DiscussionId,
  EnvKey,
  Handle,
  ProjectName,
  ProposalId,
  RepoPath,
} from "../src/ids.ts";
import {
  AskBlocked,
  AskFull,
  AttemptsExhausted,
  CapReached,
  ChecksFailed,
  ClaimLapsed,
  DecisionClosed,
  Denounced,
  DirectPush,
  DiscussionClosed,
  DraftInProgress,
  Flake,
  HeldBackFailed,
  ImportFailed,
  IncompleteBrief,
  LayerContentInPublicTree,
  NoAsk,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  NotSensitive,
  NotVouched,
  OutOfScope,
  PostureChange,
  PrivatePathInPublicTree,
  NotYourNamespace,
  ProjectExists,
  ProposalClosed,
  ReachedInternals,
  RepoBusy,
  SecretInOutput,
  StaleBase,
  StaleLayer,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownDiscussion,
  UnknownEnvItem,
  UnknownPath,
  UnknownProject,
  UnknownProposal,
  UnknownRevision,
  UnstatedRequirement,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
  Weakened,
} from "../src/refusal.ts";
import type { Refusal } from "../src/refusal.ts";

export const ask = AskId.make("fix-parser");

export const base = CommitSha.make("1111111111111111111111111111111111111111");

export const main = CommitSha.make("2222222222222222222222222222222222222222");

export const path = RepoPath.make("src/a.ts");

const project = ProjectName.make("oscabriel/datekit");

const decision = DecisionId.make("dec-000001");

const key = EnvKey.make("PAYMENTS_KEY");

const proposal = ProposalId.make("prop-000001");

const discussion = DiscussionId.make("disc-000001");

export const examples: readonly Refusal[] = [
  NotClaimed.of(ask),
  ClaimLapsed.of(ask),
  new NotVouched({}),
  new CapReached({ cap: 3 }),
  new AskFull({ ask }),
  new NoAsk({}),
  new RepoBusy({}),
  new DirectPush({ ref: "refs/heads/main" }),
  AskBlocked.of(ask, [AskId.make("drop-moment")]),
  new Denounced({}),
  new OutOfScope({ paths: [path] }),
  new TouchedJudge({ paths: [path] }),
  new Weakened({
    at: { line: 3, path },
    weakening: { marker: "it.skip", reason: "flaky on CI" },
  }),
  new PrivatePathInPublicTree({ paths: [path] }),
  new ReachedInternals({
    at: { line: 1, path },
    from: path,
    to: "@datekit/format/src/internal.ts",
  }),
  new StaleBase({ base, conflicts: [path], main }),
  new StaleLayer({ layer: "maintainers" }),
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
  new UnstatedRequirement({ area: "parser" }),
  new PostureChange({ from: "open", to: "openCore" }),
  new NotDecider({}),
  new DecisionClosed({ decision }),
  new ProposalClosed({ proposal }),
  DraftInProgress.of(proposal),
  new DiscussionClosed({ discussion }),
  new UnknownProject({ project }),
  new UnknownAsk({ ask }),
  new UnknownCommit({ sha: main }),
  new UnknownDecision({ decision }),
  new UnknownPath({ commit: main, path }),
  new UnknownRevision({ rev: "v9.9.9" }),
  new UnknownProposal({ proposal }),
  new UnknownDiscussion({ discussion }),
  new ProjectExists({ project }),
  NotYourNamespace.of(project, Handle.make("bob")),
  new ImportFailed({ reason: "the repo needs a sign-in to read" }),
  new UnknownEnvItem({ key }),
  new NotSensitive({ key }),
  ValueTooShort.of(key, 32),
];
