import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DateTime, Match } from "effect";

const yesOrNo: readonly Choice[] = ["accept", "decline"];

/**
 * The platform reads `accept` on a stray push as `adopt` too, but the page
 * offers each subject its own words only.
 */
export const allowedChoices = DecisionSubject.match({
  Finish: () => yesOrNo,
  OpenProposal: () => yesOrNo,
  PostureChange: () => yesOrNo,
  ProxyWidened: () => yesOrNo,
  RaiseRatchet: () => yesOrNo,
  SecretInTree: () => yesOrNo,
  StrayPush: (): readonly Choice[] => ["adopt", "revert"],
  Vouch: () => yesOrNo,
  Waiver: () => yesOrNo,
});

const short = (sha: string) => sha.slice(0, 7);

export const refWords = (ref: string) => ref.replace(/^refs\/heads\//u, "");

export const describeSubject = DecisionSubject.match({
  Finish: ({ ask, head }) =>
    `Finish the passing answer to ${ask}, at ${short(head)}`,
  OpenProposal: ({ proposal }) => `Open the ask proposed in ${proposal}`,
  PostureChange: ({ from, to }) =>
    `Change the project's posture from ${from} to ${to}`,
  ProxyWidened: ({ hosts, item }) =>
    `Let ${item} be sent to ${hosts.length === 0 ? "more hosts" : hosts.join(", ")} through the platform's proxy`,
  RaiseRatchet: ({ after, ask, before, ratchet, territory }) =>
    `Raise the ${ratchet} ratchet in ${territory} from ${before} to ${after}, for the answer to ${ask}`,
  SecretInTree: ({ ask, item }) =>
    `A stored value of ${item} turned up in the answer to ${ask}, which is held aside`,
  StrayPush: ({ after, before, ref }) =>
    `${refWords(ref)} moved without a landing, from ${short(before)} to ${short(after)}`,
  Vouch: ({ handle }) => `Vouch for ${handle}, so they may claim asks`,
  Waiver: ({ ask, at, marker, reason }) =>
    `Allow ${marker} at ${at.path}:${at.line} in the answer to ${ask}: ${reason}`,
});

export const subjectKind = DecisionSubject.match({
  Finish: () => "finish",
  OpenProposal: () => "proposal",
  PostureChange: () => "posture change",
  ProxyWidened: () => "proxy",
  RaiseRatchet: () => "ratchet",
  SecretInTree: () => "stored value",
  StrayPush: () => "stray push",
  Vouch: () => "vouch",
  Waiver: () => "waiver",
});

interface Lines {
  readonly yes: string;
  readonly no: string;
}

const RECORDED =
  "Your choice is kept on the decision; the platform takes no other step on it.";

const linesOf = (subject: DecisionSubject): Lines =>
  Match.value(subject).pipe(
    Match.tagsExhaustive({
      Finish: (): Lines => ({
        no: "Nothing lands; the answer keeps waiting for a finish.",
        yes: "Lands the answer as it is, with you as Finished-by.",
      }),
      OpenProposal: (): Lines => ({
        no: "The proposal closes; nothing lands.",
        yes: "Opens the ask: its file and check land on main, with you as Decided-by.",
      }),
      PostureChange: ({ from }): Lines => ({
        no: `The answer that changes it is refused; the posture stays ${from}.`,
        yes: "The answer that changes it goes on through the gate, with you as Decided-by.",
      }),
      ProxyWidened: (): Lines => ({ no: RECORDED, yes: RECORDED }),
      RaiseRatchet: ({ after, before }): Lines => ({
        no: `The answer is refused; the ratchet stays at ${before}.`,
        yes: `The answer goes on through the gate with the ratchet at ${after}, with you as Decided-by.`,
      }),
      SecretInTree: (): Lines => ({ no: RECORDED, yes: RECORDED }),
      StrayPush: ({ after, before, ref }): Lines =>
        refWords(ref) === "main"
          ? {
              no: `A landing puts back the tree at ${short(before)}, with you as Decided-by.`,
              yes: `main stays at ${short(after)}, kept as a landing with you as Decided-by.`,
            }
          : {
              no: `Only main is reverted: ${refWords(ref)} stays where it is.`,
              yes: `${refWords(ref)} stays where it is; only a push to main becomes a landing.`,
            },
      Vouch: ({ handle }): Lines => ({
        no: `Nothing lands; ${handle} stays unvouched.`,
        yes: `Lands ${handle} in the vouch file, with you as Decided-by.`,
      }),
      Waiver: ({ marker }): Lines => ({
        no: "The answer is refused at that line.",
        yes: `The answer goes on through the gate with ${marker} allowed there, with you as Decided-by.`,
      }),
    })
  );

const saysYes = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

export const consequenceOf = (
  subject: DecisionSubject,
  choice: Choice
): string => {
  const lines = linesOf(subject);

  return saysYes[choice] ? lines.yes : lines.no;
};

export const choiceWords = {
  accept: "Accept",
  adopt: "Adopt",
  decline: "Decline",
  revert: "Revert",
} as const satisfies Record<Choice, string>;

export const takenWords = {
  accept: "Accepted",
  adopt: "Adopted",
  decline: "Declined",
  revert: "Reverted",
} as const satisfies Record<Choice, string>;

export const tookEffect = (decision: Decision, choice: Choice): boolean =>
  saysYes[choice]
    ? consequenceOf(decision.subject, choice) !== RECORDED
    : DecisionSubject.guards.StrayPush(decision.subject) &&
      refWords(decision.subject.ref) === "main";

export const byWhen = (at: DateTime.Utc) =>
  `${DateTime.formatUtc(at, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    locale: "en-GB",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  })} UTC`;

export const describeDefault = (decision: Decision) =>
  `If nobody decides by ${byWhen(decision.expiresAt)}: ${decision.default}`;

export const decisionHref = (decision: Decision) =>
  `/${decision.project}/decisions/${decision.id}`;

export const decisionKey = ({ id, project }: Decision) => `${project}/${id}`;
