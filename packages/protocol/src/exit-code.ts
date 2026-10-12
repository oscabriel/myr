// Codes from sysexits(3). Kept apart from `cli.ts` so the reference docs read
// it without effect/cli. A tag's code is public: change one only with notice.
import type { Array } from "effect";

import type { Refusal } from "./refusal.ts";

export const ExitCode = {
  dataErr: 65,
  failed: 1,
  noInput: 66,
  noPerm: 77,
  ok: 0,
  tempFail: 75,
  unavailable: 69,
  usage: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

type FinalTag = Extract<Refusal, { readonly retryable: false }>["_tag"];

type FinalCode =
  | typeof ExitCode.dataErr
  | typeof ExitCode.noInput
  | typeof ExitCode.noPerm;

// Each final refusal's code. A new final tag fails the typecheck until it
// has one here; a retryable tag can't be given any but `tempFail`.
const final = {
  ChecksFailed: ExitCode.dataErr,
  DecisionClosed: ExitCode.noInput,
  Denounced: ExitCode.noPerm,
  DirectPush: ExitCode.noPerm,
  HeldBackFailed: ExitCode.dataErr,
  IncompleteBrief: ExitCode.dataErr,
  LayerContentInPublicTree: ExitCode.dataErr,
  NoAsk: ExitCode.noInput,
  NotDecider: ExitCode.noPerm,
  NotRedFirst: ExitCode.dataErr,
  NotSensitive: ExitCode.dataErr,
  NotVouched: ExitCode.noPerm,
  NotYourNamespace: ExitCode.noPerm,
  OutOfScope: ExitCode.dataErr,
  PostureChange: ExitCode.dataErr,
  PrivatePathInPublicTree: ExitCode.dataErr,
  ProjectExists: ExitCode.dataErr,
  ProposalClosed: ExitCode.noInput,
  ReachedInternals: ExitCode.dataErr,
  SecretInOutput: ExitCode.dataErr,
  TouchedJudge: ExitCode.dataErr,
  UnknownAsk: ExitCode.noInput,
  UnknownCommit: ExitCode.noInput,
  UnknownDecision: ExitCode.noInput,
  UnknownEnvItem: ExitCode.noInput,
  UnknownPath: ExitCode.noInput,
  UnknownProject: ExitCode.noInput,
  UnknownProposal: ExitCode.noInput,
  UnknownRevision: ExitCode.noInput,
  UnstatedRequirement: ExitCode.dataErr,
  ValueTooShort: ExitCode.dataErr,
  WeakCheck: ExitCode.dataErr,
  Weakened: ExitCode.dataErr,
} as const satisfies Record<FinalTag, FinalCode>;

export const exitCodeOf = (refusal: Refusal): ExitCode =>
  refusal.retryable ? ExitCode.tempFail : final[refusal._tag];

const finalCodes: ReadonlyMap<string, FinalCode> = new Map(
  Object.entries(final)
);

export const exitCodeOfTag = (tag: string): ExitCode =>
  finalCodes.get(tag) ?? ExitCode.tempFail;

export const precedence: readonly ExitCode[] = [
  ExitCode.noPerm,
  ExitCode.noInput,
  ExitCode.dataErr,
  ExitCode.tempFail,
];

export const exitCodeFor = (
  refusals: Array.NonEmptyReadonlyArray<Refusal>
): ExitCode => {
  const codes = new Set(refusals.map(exitCodeOf));

  return precedence.find((code) => codes.has(code)) ?? exitCodeOf(refusals[0]);
};
