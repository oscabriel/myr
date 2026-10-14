import { Brand } from "@repo/brand";
import { ExitCode, exitCodeOfTag, precedence } from "@repo/protocol/exit-code";
import { groups } from "@repo/protocol/refusal";
import { Exit, Predicate, SchemaAST } from "effect";

import { code, table } from "./text.ts";

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
    todo: "The project's vouch file denounces you: it takes no claims, proposals or posts from you.",
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
    todo: "Main moved: rebase onto it, resolve the conflicts it names, and push again. `movedBy` names the landing that last changed each conflicting path, with its `author` and `ask`: keep that change as you resolve.",
  },
  StaleLayer: { todo: "Nothing: the answer is checked again." },
  TouchedJudge: {
    todo: "Undo your changes to the paths it names: they decide what the checks do.",
  },
  VerifierBlocked: {
    todo: "Nothing: the platform could not run the checks, and runs them again.",
  },
  Weakened: {
    todo: "Take the marker out; a marker without a reason may get one after ` -- ` for a maintainer to weigh, but one a maintainer declined stays out; never raise a ratchet.",
  },
} as const satisfies Record<AnswerTag, Repair>;

const elsewhere = {
  DecisionClosed: {
    todo: "Nothing to decide: it was taken already, or expired to its default.",
  },
  DiscussionClosed: {
    todo: "Nothing more is posted there: the discussion was closed, or a maintainer turned it into a proposal; `next` lists the open ones.",
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
    todo: "Only one of the project's maintainers may do this: ask one of them.",
  },
  NotRedFirst: {
    todo: "Make the ask's check fail on main by an assertion, the same way twice, then open the ask again.",
  },
  NotSensitive: {
    todo: "Only an `@sensitive` item holds a write-only value: `next` shows which items are.",
  },
  NotYourNamespace: {
    todo: "Make the project in your own namespace: `next` names it with your handle.",
  },
  PostureChange: {
    todo: "A maintainer declined the posture change it names (`from`, `to`): take out what changes the posture; `next` lists the decisions.",
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
  UnknownDiscussion: {
    todo: "Check the discussion's id: `next` lists the project's discussions.",
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

const constructorDefault = (ast: SchemaAST.AST) => {
  const fill = ast.context?.constructorDefault;

  return fill !== undefined &&
    Exit.isExit(fill) &&
    Exit.isSuccess(fill) &&
    Predicate.isString(fill.value)
    ? fill.value
    : undefined;
};

export interface AnswerRefusal {
  readonly tag: string;
  readonly retryable: boolean;
  readonly exitCode: ExitCode;
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

const rowOf = (
  member: Member,
  repairTable: ReadonlyMap<string, Repair>
): AnswerRefusal => {
  const { ast: retryable } = member.fields.retryable;
  const fixed = constructorDefault(member.fields.next.ast);
  const repair = repairTable.get(member.identifier);

  return {
    exitCode: exitCodeOfTag(member.identifier),
    next: nextOf(fixed, repair),
    retryable: SchemaAST.isLiteral(retryable) && retryable.literal === true,
    tag: member.identifier,
    todo: repair?.todo ?? "",
  };
};

export const answerRefusals: readonly AnswerRefusal[] = groups
  .flatMap((group): readonly Member[] =>
    answerGroups.some((answer) => answer === group.name) ? group.members : []
  )
  .map((member) => rowOf(member, repairOf));

export interface CatalogRow extends AnswerRefusal {
  readonly group: string;
}

export const refusalCatalog = (): readonly CatalogRow[] =>
  groups.flatMap((group) =>
    group.members.map((member: Member) => ({
      ...rowOf(member, everyRepairOf),
      group: group.name,
    }))
  );

const exitMeanings = {
  [ExitCode.ok]: "It did what it was asked.",
  [ExitCode.failed]: "Something else went wrong; stderr says what.",
  [ExitCode.usage]:
    "The command was misused; stderr names the flag or value, and nothing was sent.",
  [ExitCode.dataErr]:
    "Refused: what you sent has to change (the answer, the ask or the value).",
  [ExitCode.noInput]:
    "Refused: what you named does not exist, or no longer stands open; `next` lists what does.",
  [ExitCode.unavailable]:
    "No platform answered: it is down, or the URL is wrong.",
  [ExitCode.tempFail]:
    "Refused for now: run the refusal's `next`, then try the same thing again.",
  [ExitCode.noPerm]:
    "Refused: you may not do this until you sign in, or someone lets you in.",
} as const satisfies Record<ExitCode, string>;

export const exitCodeSection = () => [
  "## Exit codes",
  "",
  `${code(Brand.cli)} exits with a code from sysexits(3), so a script or an agent can tell what to do next without reading stderr. A refusal's code follows from its \`retryable\`: 75 when trying again can help, else the code for what has to change, as the Refusals table lists it. A command that meets several refusals at once exits with the first of ${precedence.map(String).join(", ")} among them.`,
  "",
  ...table(
    ["Exit code", "Means"],
    Object.entries(exitMeanings).map(([exit, means]) => [exit, means])
  ),
  "",
];

export const refusalSection = () => [
  "## Refusals",
  "",
  `Instead of landing an answer, the platform answers with refusals. Git prints them on its \`remote:\` lines, \`${cli("check")}\` and \`${cli("status")}\` print them, and the verdict note holds them as JSON. Each one has a \`_tag\`, \`retryable\` (whether trying the same thing again can help) and \`next\` (the command to run next). The refusals about an answer's files arrive together, so one push hears about all of them. The CLI exits with a refusal's code: 75 when trying again can help, and 65, 66 or 77 when something has to change first.`,
  "",
  ...table(
    ["`_tag`", "Retryable", "Exit code", "`next`", "What to do"],
    answerRefusals.map(({ exitCode, next, retryable, tag, todo }) => [
      code(tag),
      retryable ? "yes" : "no",
      String(exitCode),
      next,
      todo,
    ])
  ),
  "",
];
