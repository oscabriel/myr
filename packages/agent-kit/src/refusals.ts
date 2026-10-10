/**
 * The refusals an answer can meet, read from the closed union: each one's
 * tag, whether retrying can help and its `next` come from its schema, and
 * what to do about it from the table below, which the type holds to the
 * union's groups (a refusal added to one fails the typecheck until it has
 * a line here). `refusalCatalog` walks every group the same way, for
 * `/llms-full.txt`, with a second table for the refusals no answer meets.
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

type Tag = InstanceType<Member>["_tag"];

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

/**
 * What to do on meeting a refusal no answer meets: at an ask's opening, a
 * maintainer's own push, a decision, a lookup, setup or the env.
 */
const elsewhere = {
  DecisionClosed: {
    todo: "Nothing to decide: it was taken already, or expired to its default.",
  },
  DraftInProgress: {
    next: cli("proposal", "<proposal>"),
    todo: "Wait: the platform is drafting this proposal's ask already, and `next` shows when it settles.",
  },
  ImportFailed: { todo: "Read `reason`, then import again." },
  IncompleteBrief: {
    todo: "Fill in the fields `missing` names: the ask's kind requires them.",
  },
  LayerContentInPublicTree: {
    todo: "Take the paths it names out: their files stay private and never enter a public tree.",
  },
  NotDecider: {
    todo: "Only one of the project's deciders may do this: ask one of them.",
  },
  NotRedFirst: {
    todo: "Make the ask's check fail on main by an assertion, the same way twice, then open the ask again.",
  },
  NotSensitive: {
    todo: "Only an `@sensitive` item holds a write-only value: `next` shows which items are.",
  },
  PostureChange: {
    todo: "Wait for a decider to take the posture change it names (`from`, `to`); `next` lists the decisions waiting.",
  },
  ProjectExists: { todo: "Pick another name: that one is taken." },
  ProposalClosed: {
    todo: "Nothing more is drafted for it: the proposal was accepted, declined or expired.",
  },
  SecretInOutput: {
    todo: "Take the write-only value of `item` out of the output or the tree (`where`), then check again.",
  },
  UnknownAsk: {
    todo: "Check the ask's name: `next` lists the project's open asks.",
  },
  UnknownCommit: {
    todo: "Fetch the project, then name a commit it holds.",
  },
  UnknownDecision: {
    todo: "Check the decision's id: `next` lists the decisions waiting on you.",
  },
  UnknownEnvItem: {
    todo: "Name a key the project's env shape has: `next` lists them.",
  },
  UnknownPath: {
    todo: "Name a path the commit holds: `next` lists its files.",
  },
  UnknownProject: {
    todo: "Check the project's name: every project is listed in the index.",
  },
  UnknownProposal: {
    todo: "Check the proposal's id: `next` lists the proposals waiting on you.",
  },
  UnknownRevision: {
    todo: "Name `main`, a commit the project holds or one of its tags: `next` lists its refs.",
  },
  UnstatedRequirement: {
    todo: "State in public what the area's held-back check holds, or take the check out of the suite.",
  },
  ValueTooShort: {
    nextNames: `${code(cli("env", "set", "<key>"))}, with ${code("--acknowledge-short")} when the value is above the floor`,
    todo: "Give a longer value, or acknowledge a short one where the floor allows it.",
  },
  WeakCheck: {
    todo: "Strengthen the check: as it stands, the trivial answer `weakness` names would pass it.",
  },
} as const satisfies Record<Exclude<Tag, AnswerTag>, Repair>;

const repairOf = new Map<string, Repair>(Object.entries(repairs));

const everyRepairOf = new Map<string, Repair>([
  ...repairOf,
  ...Object.entries(elsewhere),
]);

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

/** One member's row, from its schema and the repair `repairTable` gives it. */
const rowOf = (
  member: Member,
  repairTable: ReadonlyMap<string, Repair>
): AnswerRefusal => {
  const { ast: retryable } = member.fields.retryable;
  const fixed = constructorDefault(member.fields.next.ast);
  const repair = repairTable.get(member.identifier);

  return {
    next: nextOf(fixed, repair),
    retryable: SchemaAST.isLiteral(retryable) && retryable.literal === true,
    tag: member.identifier,
    todo: repair?.todo ?? "",
  };
};

/** Every refusal an answer can meet, in the union's order. */
export const answerRefusals: readonly AnswerRefusal[] = groups
  .flatMap((group): readonly Member[] =>
    answerGroups.some((answer) => answer === group.name) ? group.members : []
  )
  .map((member) => rowOf(member, repairOf));

/** One refusal of the closed union, with the group the union files it under. */
export interface CatalogRow extends AnswerRefusal {
  readonly group: string;
}

/** Every refusal of the closed union, every group, in the union's order. */
export const refusalCatalog = (): readonly CatalogRow[] =>
  groups.flatMap((group) =>
    group.members.map((member: Member) => ({
      ...rowOf(member, everyRepairOf),
      group: group.name,
    }))
  );

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
