import { DateTime, Match } from "effect";
import type { Array } from "effect";

import type { Refusal } from "./refusal.ts";

const short = (sha: string) => sha.slice(0, 7);

const list = (items: readonly string[]) => items.join(", ");

// Reasons name only what the refusal's reader may see: held-back checks give
// their area and suite, never a case or an input.
const reason = Match.typeTags<Refusal, string>()({
  AskBlocked: ({ ask, blockedBy }) =>
    `${ask} waits on ${list(blockedBy)} to land first`,
  AskFull: ({ ask }) => `someone else holds the claim on ${ask}`,
  AttemptsExhausted: ({ area, resetsAt }) =>
    `no attempts left on ${area} until ${DateTime.formatIso(resetsAt)}`,
  CapReached: ({ cap }) =>
    `you already hold ${cap} claims, the most this project allows`,
  ChecksFailed: ({ lane, logRef }) =>
    `the ${lane} checks failed; the log is at ${logRef}`,
  ClaimLapsed: ({ ask }) => `your claim on ${ask} lapsed`,
  DecisionClosed: ({ decision }) =>
    `${decision} was already decided, or expired to its default`,
  Denounced: () =>
    "this project's vouch file denounces you, so it takes no claims or proposals from you",
  DirectPush: ({ ref }) =>
    `main moves only by a landing, so ${ref} takes no direct push; push your answer to your claim's fork`,
  Flake: ({ lane }) =>
    `the ${lane} checks failed, then passed on the same tree; the platform will run them again`,
  HeldBackFailed: ({ area, suite }) =>
    `a held-back check failed in ${area}, suite ${suite}`,
  ImportFailed: (refusal) => `the import failed: ${refusal.reason}`,
  IncompleteBrief: ({ missing }) => `the brief is missing ${list(missing)}`,
  LayerContentInPublicTree: ({ paths }) =>
    `a layer's files would enter a public tree: ${list(paths)}`,
  NoAsk: () => "this push names no open ask",
  NotClaimed: ({ ask }) => `you hold no claim on ${ask}`,
  NotDecider: () => "only one of this project's deciders may do this",
  NotRedFirst: () =>
    "the ask's check must fail on main twice in the same way, by an assertion",
  NotSensitive: ({ key }) =>
    `${key} is not @sensitive, so it holds no write-only value`,
  NotVouched: () => "no member of this project has vouched for you",
  OutOfScope: ({ paths }) =>
    `changes paths outside the ask's territory: ${list(paths)}`,
  PostureChange: ({ from, to }) =>
    `landing would change the posture from ${from} to ${to}, which takes a decider`,
  PrivatePathInPublicTree: ({ paths }) =>
    `would put held-back paths in a public tree: ${list(paths)}`,
  ProjectExists: ({ project }) => `a project named ${project} already exists`,
  ReachedInternals: ({ from, to }) =>
    `${from} reaches into ${to}, which its module does not export`,
  RepoBusy: () => "the repo was busy with another push",
  SecretInOutput: ({ item, where }) =>
    `the write-only value ${item} appeared in the ${where}`,
  StaleBase: ({ base, conflicts, main }) =>
    conflicts.length === 0
      ? `main moved to ${short(main)}, past your base ${short(base)}`
      : `main moved to ${short(main)}, past your base ${short(base)}; conflicts in ${list(conflicts)}`,
  StaleLayer: ({ layer }) =>
    `the ${layer} layer moved since this answer was checked; it will be checked again`,
  TouchedJudge: ({ paths }) =>
    `changes files that decide what the checks do: ${list(paths)}`,
  UnknownAsk: ({ ask }) => `this project has no ask named ${ask}`,
  UnknownCommit: ({ sha }) => `this project has no commit ${sha}`,
  UnknownDecision: ({ decision }) => `this project has no decision ${decision}`,
  UnknownEnvItem: ({ key }) => `the env shape has no item ${key}`,
  UnknownProject: ({ project }) => `no project is named ${project}`,
  UnstatedRequirement: ({ area }) =>
    `a held-back check in ${area} enforces something no public clause states`,
  ValueTooShort: ({ key, minimum }) =>
    `the value for ${key} is shorter than the ${minimum} characters it needs`,
  VerifierBlocked: () =>
    "the platform could not run the checks; it will run them again",
  WeakCheck: ({ weakness }) => `the ask's check is weak: ${weakness}`,
  Weakened: ({ weakening }) => {
    if ("ratchet" in weakening) {
      return `raises the ${weakening.ratchet} ratchet in ${weakening.territory} from ${weakening.before} to ${weakening.after}`;
    }

    return weakening.reason === undefined
      ? `adds ${weakening.marker} without a reason`
      : `adds ${weakening.marker}, with the reason "${weakening.reason}"`;
  },
});

const block = (refusal: Refusal) => [
  `${refusal._tag}: ${reason(refusal)}`,
  ...(refusal.at === undefined
    ? []
    : [`  at: ${refusal.at.path}:${refusal.at.line}`]),
  `  next: ${refusal.next}`,
  `  retryable: ${refusal.retryable ? "yes" : "no"}`,
];

/** The reason on git's `ng` line: the first refusal's tag, and how many follow. */
export const headline = (refusals: Array.NonEmptyReadonlyArray<Refusal>) => {
  const [first, ...rest] = refusals;

  return rest.length === 0
    ? first._tag
    : `${first._tag} and ${rest.length} more`;
};

/**
 * What a person reads, one line each, for git `remote:` lines and the CLI:
 * every refusal's reason, where it points, its next command and whether
 * retrying can help.
 */
export const explain = (refusals: Array.NonEmptyReadonlyArray<Refusal>) =>
  refusals.flatMap(block);
