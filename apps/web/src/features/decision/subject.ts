/**
 * What a decision is about and what each choice on it does, in words, with
 * no view of its own: Today's rows, the inspector, a decision's page and
 * its finish all say a subject the same way.
 *
 * - `describeSubject`: the subject as one plain sentence, the row's link.
 * - `allowedChoices`: the choices its deciders have, in its own words.
 * - `consequenceOf`: what the platform does once a choice is taken, one
 *   line under each button, written from what the platform's code does for
 *   that subject. Where a choice changes nothing anyone can see, the line
 *   says so rather than promising something.
 *
 * Each table names every subject, so a new kind fails to compile until it
 * has its sentence, its choices and its lines.
 */
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DateTime, Match } from "effect";

const yesOrNo: readonly Choice[] = ["accept", "decline"];

/**
 * The choices a subject's deciders have: a stray push is adopted or
 * reverted, anything else accepted or declined. The platform reads `accept`
 * on a stray push as `adopt` too, but the page offers each subject its own
 * words only.
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

/** A ref as people say it: `main` for `refs/heads/main`. */
export const refWords = (ref: string) => ref.replace(/^refs\/heads\//u, "");

/** What a decision is about, in one plain sentence. */
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

/** A subject's kind as a row's metadata names it. */
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

/** What saying yes and saying no do, for one subject. */
interface Lines {
  readonly yes: string;
  readonly no: string;
}

/** What the platform takes no step on: the choice is kept, and nothing else moves. */
const RECORDED =
  "Your choice is kept on the decision; the platform takes no other step on it.";

/**
 * What each choice does, by subject, as the platform's code does it:
 *
 * - an accepted proposal opens its ask (its files land on main, decided by
 *   the decider); a declined one closes;
 * - an accepted finish lands the answer at its head with the decider as
 *   `Finished-by`; a declined one leaves it waiting;
 * - a waiver, a ratchet raise or a posture change holds an answer: yes lets
 *   it go on with the decider as `Decided-by`, no refuses it with the
 *   refusal the decision stood for;
 * - a stray push to main is adopted as a landing, or reverted by one, with
 *   the decider as `Decided-by`; a push to another ref moves nothing;
 * - a vouch lands a line in the vouch file;
 * - a widened proxy or a stored value found in an answer is recorded, and
 *   nothing else follows yet.
 */
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

/** Whether a choice says yes, in any subject's words. */
const saysYes = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

/** What taking `choice` on `subject` does, in one line. */
export const consequenceOf = (
  subject: DecisionSubject,
  choice: Choice
): string => {
  const lines = linesOf(subject);

  return saysYes[choice] ? lines.yes : lines.no;
};

/** Each choice as its button says it. */
export const choiceWords = {
  accept: "Accept",
  adopt: "Adopt",
  decline: "Decline",
  revert: "Revert",
} as const satisfies Record<Choice, string>;

/** Each choice once taken. */
export const takenWords = {
  accept: "Accepted",
  adopt: "Adopted",
  decline: "Declined",
  revert: "Reverted",
} as const satisfies Record<Choice, string>;

/**
 * Whether a taken choice made something happen: what lands, opens or is
 * put back is drawn in the landed role; a choice that leaves things as they
 * were is ink.
 */
export const tookEffect = (decision: Decision, choice: Choice): boolean =>
  saysYes[choice]
    ? consequenceOf(decision.subject, choice) !== RECORDED
    : DecisionSubject.guards.StrayPush(decision.subject) &&
      refWords(decision.subject.ref) === "main";

/** An expiry as a decider reads it on any phone: weekday, date and time, in UTC. */
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

/** What happens when nobody decides in time: the decision's own default, and by when. */
export const describeDefault = (decision: Decision) =>
  `If nobody decides by ${byWhen(decision.expiresAt)}: ${decision.default}`;

/** A decision's own page. */
export const decisionHref = (decision: Decision) =>
  `/${decision.project}/decisions/${decision.id}`;

/** A decision's place in a Today that may hold several projects. */
export const decisionKey = ({ id, project }: Decision) => `${project}/${id}`;
