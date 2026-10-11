/**
 * How the CLI's process ends, from sysexits(3), so a script or an agent can
 * tell what to do next from the exit code alone. A refusal's code follows
 * from its fixed `retryable`: a retryable one is `tempFail`, since running
 * its `next` and trying again can pass; a final one says what has to
 * change, which `final` fixes per tag: what was sent, what was named, or
 * who is asking.
 *
 * The CLI's projection of the union, kept apart from `cli.ts` so the
 * reference docs read it without effect/cli. A tag's code is public: change
 * one only as a tag is renamed, with notice.
 */
import type { Array } from "effect";

import type { Refusal } from "./refusal.ts";

export const ExitCode = {
  /** `EX_DATAERR`: what was sent was refused; change it, then try again. */
  dataErr: 65,
  /** Anything else that went wrong, said once on stderr. */
  failed: 1,
  /** `EX_NOINPUT`: what was named does not exist, or no longer stands open. */
  noInput: 66,
  /** `EX_NOPERM`: the caller may not do this: not signed in, or not let in. */
  noPerm: 77,
  /** It did what it was asked. */
  ok: 0,
  /** `EX_TEMPFAIL`: run the refusal's `next`, and the same thing can pass. */
  tempFail: 75,
  /** `EX_UNAVAILABLE`: no platform answered. */
  unavailable: 69,
  /** The command was misused (a parse error, a missing value, `--yes` left out). */
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
  // A declined decision, as a declined waiver is `Weakened`: the answer changes.
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

/** The code one refusal ends the CLI with. */
export const exitCodeOf = (refusal: Refusal): ExitCode =>
  refusal.retryable ? ExitCode.tempFail : final[refusal._tag];

const finalCodes: ReadonlyMap<string, FinalCode> = new Map(
  Object.entries(final)
);

/**
 * The code a refusal with `tag`, one of the union's, ends the CLI with: for
 * the reference docs, which read the union's schemas rather than refusals.
 */
export const exitCodeOfTag = (tag: string): ExitCode =>
  finalCodes.get(tag) ?? ExitCode.tempFail;

/**
 * The order a caller deals with refusals met together: who is asking, then
 * what was named, then what was sent; a retry helps only once none is left.
 */
export const precedence: readonly ExitCode[] = [
  ExitCode.noPerm,
  ExitCode.noInput,
  ExitCode.dataErr,
  ExitCode.tempFail,
];

/**
 * The code refusals met together end the CLI with: the first of
 * `precedence` any of them has, so `tempFail` only when every one is
 * retryable.
 */
export const exitCodeFor = (
  refusals: Array.NonEmptyReadonlyArray<Refusal>
): ExitCode => {
  const codes = new Set(refusals.map(exitCodeOf));

  return precedence.find((code) => codes.has(code)) ?? exitCodeOf(refusals[0]);
};
