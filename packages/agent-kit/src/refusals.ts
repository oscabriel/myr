/**
 * The refusals an answer can meet, read from the closed union: each one's
 * tag, whether retrying can help and its `next` come from its schema, and
 * what to do about it from the table below, which the type holds to the
 * union's groups (a refusal added to one fails the typecheck until it has
 * a line here).
 */
import { Brand } from "@repo/brand";
import { groups } from "@repo/protocol/refusal";
import { Exit, Predicate, SchemaAST } from "effect";

import { code, table } from "./text.ts";

/** The groups whose refusals an answer can meet, from claim to verdict. */
const answerGroups = [
  "Push and claim",
  "Shape",
  "Merge",
  "Checks",
  "Never counted against the answerer",
] as const;

type Group = (typeof groups)[number];

type Member = Group["members"][number];

type AnswerMember = Extract<
  Group,
  { readonly name: (typeof answerGroups)[number] }
>["members"][number];

type AnswerTag = InstanceType<AnswerMember>["_tag"];

/**
 * What to do on meeting it. A refusal whose `next` is set when it is raised
 * gives the command's form here, or what it names when no form fits.
 */
interface Repair {
  readonly todo: string;
  readonly next?: string;
  readonly nextNames?: string;
}

const cli = (...words: readonly string[]) => [Brand.cli, ...words].join(" ");

const repairs = {
  AskBlocked: {
    todo: "Wait for the asks it names to land, or answer one of them first.",
  },
  AskFull: { todo: "Someone else holds the claim: pick another ask." },
  AttemptsExhausted: {
    todo: "Wait until `resetsAt`: you used every attempt on that area's held-back checks for now.",
  },
  CapReached: {
    todo: "Read `limit`: for claims, release or land a claim you hold; for proposals, wait for an open one to be decided; for drafts, the proposal has had every draft round it takes; with `retryAfter`, wait that many seconds and try again.",
  },
  ChecksFailed: {
    nextNames: "the command that reproduces the failure",
    todo: "Run `next` to see the failure, fix it, and push again.",
  },
  ClaimLapsed: {
    next: cli("claim", "<ask>"),
    todo: "Your claim lapsed after a spell without a push: claim the ask again if it is still open.",
  },
  Denounced: {
    todo: "The project's vouch file denounces you: it takes no claims or proposals from you.",
  },
  DirectPush: {
    todo: "Main moves only by a landing: push your answer to your claim's fork.",
  },
  Flake: {
    todo: "Nothing: the check failed and then passed on the same tree, and the platform runs it again.",
  },
  HeldBackFailed: {
    todo: "A held-back check failed; you see only its area and suite. Fix the behaviour and push again.",
  },
  NoAsk: {
    todo: "Push to the fork your claim gave you, which names its ask.",
  },
  NotClaimed: {
    next: cli("claim", "<ask>"),
    todo: "Claim the ask, then push again.",
  },
  NotVouched: { todo: "Ask a member of the project to vouch for you." },
  OutOfScope: {
    todo: "Undo your changes to the paths it names: they are outside the ask's territory.",
  },
  PrivatePathInPublicTree: {
    todo: "Take the held-back paths it names out of your answer.",
  },
  ReachedInternals: {
    todo: "Import the other module only through its public files.",
  },
  RepoBusy: { todo: "Push again." },
  StaleBase: {
    todo: "Main moved: rebase onto it, resolve the conflicts it names, and push again.",
  },
  StaleLayer: { todo: "Nothing: the answer is checked again." },
  TouchedJudge: {
    todo: "Undo your changes to the paths it names: they decide what the checks do.",
  },
  VerifierBlocked: {
    todo: "Nothing: the platform could not run the checks, and runs them again.",
  },
  Weakened: {
    todo: "Take the marker out, or give it a reason for a decider to weigh; never raise a ratchet.",
  },
} as const satisfies Record<AnswerTag, Repair>;

const repairOf = new Map<string, Repair>(Object.entries(repairs));

/** A field's value when the constructor fills it in, as it does a fixed `next`. */
const constructorDefault = (ast: SchemaAST.AST) => {
  const fill = ast.context?.constructorDefault;

  return fill !== undefined &&
    Exit.isExit(fill) &&
    Exit.isSuccess(fill) &&
    Predicate.isString(fill.value)
    ? fill.value
    : undefined;
};

/** One refusal an answer can meet, as the skills list it. */
export interface AnswerRefusal {
  readonly tag: string;
  readonly retryable: boolean;
  /** Its `next`, in Markdown: the command as a code span, or what it names. */
  readonly next: string;
  readonly todo: string;
}

const nextOf = (fixed: string | undefined, repair: Repair | undefined) => {
  if (fixed !== undefined) {
    return code(fixed);
  }

  return repair?.next === undefined
    ? (repair?.nextNames ?? "")
    : code(repair.next);
};

/** Every refusal an answer can meet, in the union's order. */
export const answerRefusals: readonly AnswerRefusal[] = groups
  .flatMap((group): readonly Member[] =>
    answerGroups.some((answer) => answer === group.name) ? group.members : []
  )
  .map((member) => {
    const { ast: retryable } = member.fields.retryable;
    const fixed = constructorDefault(member.fields.next.ast);
    const repair = repairOf.get(member.identifier);

    return {
      next: nextOf(fixed, repair),
      retryable: SchemaAST.isLiteral(retryable) && retryable.literal === true,
      tag: member.identifier,
      todo: repair?.todo ?? "",
    };
  });

/** The refusals section every skill carries. */
export const refusalSection = () => [
  "## Refusals",
  "",
  `Instead of landing an answer, the platform answers with refusals. Git prints them on its \`remote:\` lines, \`${cli("check")}\` and \`${cli("status")}\` print them, and the verdict note holds them as JSON. Each one has a \`_tag\`, \`retryable\` (whether trying the same thing again can help) and \`next\` (the command to run next). The refusals about an answer's files arrive together, so one push hears about all of them.`,
  "",
  ...table(
    ["`_tag`", "Retryable", "`next`", "What to do"],
    answerRefusals.map(({ next, retryable, tag, todo }) => [
      code(tag),
      retryable ? "yes" : "no",
      next,
      todo,
    ])
  ),
  "",
];
