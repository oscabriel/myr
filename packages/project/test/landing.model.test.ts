import { describe, expect, it } from "@effect/vitest";
import type { Credit } from "@repo/protocol/domain/credit";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice } from "@repo/protocol/domain/decision";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProjectName,
  RatchetName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { ChecksFailed } from "@repo/protocol/refusal";
import {
  Arbitrary,
  Array,
  DateTime,
  Duration,
  Effect,
  Equal,
  Option,
  Result,
  Schema,
} from "effect";

import { ProjectEventInput } from "../src/events.ts";
import {
  enqueue,
  LandingCommand,
  LandingEffect,
  LandingQueue,
  LandingState,
  maxRemerges,
  next as admitNext,
  Request,
  settle,
  transition,
} from "../src/landing.ts";
import type { PendingDecision, Step } from "../src/landing.ts";

// The model drives one answer request through generated histories of what
// the service could tell it: port answers, decisions, the queue's go, and
// commands delivered again, right away or long after. It keeps its own record
// of what happened, and after every step checks the lifecycle against it.

const hex = (n: number) => n.toString(16).padStart(40, "0");

const opened = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const alice = Handle.make("alice");

const carol = Handle.make("carol");

const ask = AskId.make("parse-dates");

const request = Request.make({
  answerer: Handle.make("bob"),
  ask: Option.some(ask),
  assisted: [],
  base: CommitSha.make(hex(0xba_5e)),
  credits: [{ handle: alice, role: "Asked-by" }],
  fork: RepoName.make("datekit--parse-dates--bob"),
  head: CommitSha.make(hex(0x4e_ad)),
  project: ProjectName.make("oscabriel/datekit"),
  requestId: RequestId.make("push-4ead"),
});

// Every value a step makes is new, keyed by the step's index: a main, a tree
// or a decision id recurs only when a command is delivered again.
const mainAt = (step: number) => LandedSha.make(hex(0x1_00_00 + step));

const strangerAt = (step: number) => LandedSha.make(hex(0x2_00_00 + step));

const treeAt = (step: number) => TreeSha.make(hex(0x3_00_00 + step));

const decisionAt = (step: number, k: number) =>
  DecisionId.make(`dec-${String(2 * step + k).padStart(6, "0")}`);

const failed = new ChecksFailed({
  lane: "unit",
  logRef: "datekit/push-4ead/unit#1",
  next: "bun test src/parse.test.ts",
});

const raise = DecisionSubject.cases.RaiseRatchet.make({
  after: 4,
  ask,
  before: 3,
  ratchet: RatchetName.make("escapes"),
  territory: "packages/parse",
});

const waiver = DecisionSubject.cases.Waiver.make({
  ask,
  at: { line: 3, path: RepoPath.make("src/parse.test.ts") },
  marker: ".skip(",
  reason: "flaky until the clock fix lands",
});

const fresh = [
  "Start",
  "Wait",
  "Merged",
  "MergeConflict",
  "Checked",
  "Finished",
  "Decided",
  "MainMoved",
  "LandedOk",
  "Busy",
  "Blocked",
] as const;

/** The longest history the model runs. */
const longest = 60;

/**
 * One move of a history. Half drive the request the way a service would (the
 * answer its state waits for); the rest say any command, repeat the last one,
 * or replay an earlier one. `pick` chooses among variants, and `back` which
 * earlier command a replay delivers again, from anywhere in the history.
 */
const Move = Schema.Struct({
  back: Schema.Int.check(
    Schema.isBetween({ maximum: longest - 1, minimum: 0 })
  ),
  drive: Schema.Boolean,
  kind: Schema.Literals([...fresh, "Again", "Replay"]),
  pick: Schema.Int.check(Schema.isBetween({ maximum: 7, minimum: 0 })),
});

type Move = typeof Move.Type;

const histories = Arbitrary.array(Arbitrary.schema(Move), {
  maxLength: longest,
});

// Arbitrary grows arrays with `size` (10 by default): histories long enough
// to land, wait, re-merge and replay need a larger one.
const size = longest;

interface Underway {
  readonly attempt: number;
  readonly main: LandedSha;
}

const underway = (state: LandingState) =>
  LandingState.matchOrElse<Option.Option<Underway>>(
    state,
    {
      AwaitingDecision: Option.some,
      AwaitingFinish: Option.some,
      Checking: Option.some,
      Landing: Option.some,
      Merging: Option.some,
    },
    () => Option.none()
  );

const remergesOf = (state: LandingState) =>
  LandingState.matchOrElse<Option.Option<number>>(
    state,
    {
      AwaitingDecision: ({ remerges }) => Option.some(remerges),
      AwaitingFinish: ({ remerges }) => Option.some(remerges),
      Checking: ({ remerges }) => Option.some(remerges),
      Landing: ({ remerges }) => Option.some(remerges),
      Merging: ({ remerges }) => Option.some(remerges),
    },
    () => Option.none()
  );

const checkingTree = (state: LandingState) =>
  LandingState.matchOrElse<Option.Option<TreeSha>>(
    state,
    { Checking: ({ tree }) => Option.some(tree) },
    () => Option.none()
  );

const waitingOn = (state: LandingState) =>
  LandingState.matchOrElse<readonly PendingDecision[]>(
    state,
    { AwaitingDecision: ({ decisions }) => decisions },
    () => []
  );

interface Context {
  readonly pick: number;
  readonly state: LandingState;
  readonly step: number;
}

const mainOf = ({ state, step }: Context) =>
  Option.match(underway(state), {
    onNone: () => mainAt(step),
    onSome: ({ main }) => main,
  });

// `pick` 7 makes a report about something the request is not at.
const reportedMain = (context: Context) =>
  context.pick === 7 ? strangerAt(context.step) : mainOf(context);

const attemptOf = ({ pick, state }: Context) =>
  Option.match(underway(state), {
    onNone: () => 0,
    onSome: ({ attempt }) => attempt,
  }) + (pick === 7 ? 1 : 0);

// What the checks report, by `pick`: clean under each finish rule, refused,
// waiting on decisions, or about a tree the request is not at.
const checked = ({ pick, state, step }: Context) => {
  const tree = Option.getOrElse(checkingTree(state), () => treeAt(step));
  const clean = { decisions: [], finish: "never" as const, refusals: [], tree };

  const reports = [
    clean,
    clean,
    { ...clean, finish: "optional" as const },
    { ...clean, finish: "required" as const },
    { ...clean, refusals: [failed] },
    { ...clean, decisions: [{ id: decisionAt(step, 0), subject: raise }] },
    {
      ...clean,
      decisions: [
        { id: decisionAt(step, 0), subject: raise },
        { id: decisionAt(step, 1), subject: waiver },
      ],
      finish: "required" as const,
    },
    { ...clean, tree: treeAt(step) },
  ];

  return LandingCommand.Checked(reports[pick] ?? clean);
};

const choices = [
  "accept",
  "accept",
  "accept",
  "adopt",
  "decline",
  "revert",
  "accept",
  "accept",
] as const;

const commands = {
  Blocked: (context) => LandingCommand.Blocked({ attempt: attemptOf(context) }),
  Busy: (context) => LandingCommand.Busy({ attempt: attemptOf(context) }),
  Checked: checked,
  Decided: ({ pick, state, step }) =>
    LandingCommand.Decided({
      by: pick < 4 ? alice : carol,
      choice: choices[pick] ?? "accept",
      decision: Option.match(Array.get(waitingOn(state), pick % 2), {
        onNone: () => decisionAt(step, 0),
        onSome: ({ id }) => id,
      }),
    }),
  Finished: () => LandingCommand.Finished({ by: alice }),
  LandedOk: ({ step }) => LandingCommand.LandedOk({ sha: mainAt(step) }),
  MainMoved: (context) =>
    LandingCommand.MainMoved({
      from: reportedMain(context),
      main: context.pick === 6 ? mainOf(context) : mainAt(context.step),
    }),
  MergeConflict: (context) =>
    LandingCommand.MergeConflict({
      conflicts: [RepoPath.make("src/parse.ts")],
      main: reportedMain(context),
    }),
  Merged: (context) =>
    LandingCommand.Merged({
      changes: [],
      main: reportedMain(context),
      tree: treeAt(context.step),
    }),
  Start: ({ step }) => LandingCommand.Start({ main: mainAt(step) }),
  Wait: () => LandingCommand.Wait({ parent: AskId.make("move-to-temporal") }),
} as const satisfies Record<
  (typeof fresh)[number],
  (context: Context) => LandingCommand
>;

// While landing, main moves under it for `pick` 0 to 2, the repo is busy
// for 7, and otherwise the landing is on main.
const landingReport = (context: Context) => {
  if (context.pick < 3) {
    return commands.MainMoved({ ...context, pick: 0 });
  }

  return context.pick === 7
    ? commands.Busy({ ...context, pick: 0 })
    : commands.LandedOk(context);
};

/** The answer a service would give the state next. */
const drive = (context: Context): LandingCommand => {
  const { pick } = context;

  return LandingState.match<LandingCommand>(context.state, {
    AwaitingDecision: () => commands.Decided(context),
    AwaitingFinish: () => commands.Finished(),
    Checking: () => checked(context),
    Landed: () => commands.Start(context),
    Landing: () => landingReport(context),
    Merging: () =>
      pick === 7
        ? commands.MergeConflict({ ...context, pick: 0 })
        : commands.Merged({ ...context, pick: 0 }),
    Queued: () => (pick === 7 ? commands.Wait() : commands.Start(context)),
    Refused: () => commands.Start(context),
    WaitingOnParent: () => commands.Start(context),
  });
};

/** What the model remembers of a history so far. */
interface Model {
  /** Commands that changed the state or asked for an effect. */
  readonly applied: readonly LandingCommand[];
  /** The tree the checks passed since the latest merge. */
  readonly cleared: Option.Option<TreeSha>;
  /** Who the landing must credit: the request's credits, then each finish and accepted decision. */
  readonly credits: readonly Credit[];
  readonly delivered: readonly LandingCommand[];
  /** A finish was given. */
  readonly finished: boolean;
  /** The latest checks asked for a finish. */
  readonly finishOwed: boolean;
  /** The main the latest `Land` effect lands on. */
  readonly landingOn: Option.Option<LandedSha>;
  /** What the latest merge made. */
  readonly merged: Option.Option<{
    readonly main: LandedSha;
    readonly tree: TreeSha;
  }>;
  /** The main the latest `Merge` effect merges onto. */
  readonly merging: Option.Option<LandedSha>;
  /** Main moved during landing, and no `Merge` followed yet. */
  readonly moved: boolean;
  /** How often main moved under a landing. */
  readonly remerges: number;
  /** How many retries the ports asked for. */
  readonly retries: number;
  readonly state: LandingState;
  /** The decisions the latest checks asked for, less those accepted since. */
  readonly waiting: readonly DecisionId[];
}

const begin: Model = {
  applied: [],
  cleared: Option.none(),
  credits: request.credits,
  delivered: [],
  finishOwed: false,
  finished: false,
  landingOn: Option.none(),
  merged: Option.none(),
  merging: Option.none(),
  moved: false,
  remerges: 0,
  retries: 0,
  state: LandingState.cases.Queued.make({ request }),
  waiting: [],
};

const commandFor = (move: Move, model: Model, step: number) => {
  const context = { pick: move.pick, state: model.state, step };

  if (move.drive) {
    return Option.some(drive(context));
  }

  if (move.kind === "Again") {
    return Array.last(model.delivered);
  }

  if (move.kind === "Replay") {
    return Array.get(
      model.delivered,
      move.back % Math.max(model.delivered.length, 1)
    );
  }

  return Option.some(commands[move.kind](context));
};

const isTerminal = LandingState.isAnyOf(["Landed", "Refused"]);

const tookEffect = (before: LandingState, { effects, state }: Step) =>
  effects.length > 0 || !Equal.equals(before, state);

const approves = (choice: Choice) => choice === "accept" || choice === "adopt";

const credited = (
  credits: readonly Credit[],
  role: Credit["role"],
  handle: Handle
): readonly Credit[] =>
  credits.some((given) => given.role === role && given.handle === handle)
    ? credits
    : [...credits, { handle, role }];

/**
 * Whether the request's state waits for this command, as the model sees it:
 * the main it merges onto or lands on, the tree it checks, the attempt it is
 * at, a decision it waits on. Exactly these commands may take effect.
 */
const awaited = (model: Model, command: LandingCommand) => {
  const is = (tags: readonly LandingState["_tag"][]) =>
    LandingState.isAnyOf(tags)(model.state);

  return LandingCommand.$match(command, {
    Blocked: ({ attempt }) =>
      is(["Merging", "Checking", "Landing"]) && attempt === model.retries,
    Busy: ({ attempt }) => is(["Landing"]) && attempt === model.retries,
    Checked: ({ tree }) =>
      is(["Checking"]) &&
      Option.exists(model.merged, (merged) => merged.tree === tree),
    Decided: ({ decision }) =>
      is(["AwaitingDecision"]) && model.waiting.includes(decision),
    Finished: () => is(["AwaitingFinish"]),
    LandedOk: () => is(["Landing"]),
    MainMoved: ({ from, main }) =>
      is(["Landing"]) &&
      Option.contains(model.landingOn, from) &&
      from !== main,
    MergeConflict: ({ main }) =>
      is(["Merging"]) && Option.contains(model.merging, main),
    Merged: ({ main }) =>
      is(["Merging"]) && Option.contains(model.merging, main),
    Start: () => is(["Queued", "WaitingOnParent"]),
    Wait: () => is(["Queued"]),
  });
};

/** Whether an awaited command must refuse the answer. */
const refuses = LandingCommand.$match({
  Blocked: () => false,
  Busy: () => false,
  Checked: ({ refusals }) => refusals.length > 0,
  Decided: ({ choice }) => !approves(choice),
  Finished: () => false,
  LandedOk: () => false,
  MainMoved: () => false,
  MergeConflict: () => true,
  Merged: () => false,
  Start: () => false,
  Wait: () => false,
});

/** The model after a step: what it learned from the command and the effects. */
const advance = (model: Model, command: LandingCommand, step: Step): Model => {
  const merge = Array.findLast(step.effects, LandingEffect.$is("Merge"));
  const land = Array.findLast(step.effects, LandingEffect.$is("Land"));
  const retries = step.effects.filter(LandingEffect.$is("Retry")).length;

  const learned: Partial<Model> = awaited(model, command)
    ? LandingCommand.$match(command, {
        Blocked: () => ({}),
        Busy: () => ({}),
        Checked: ({ decisions, finish, refusals, tree }) =>
          refusals.length > 0
            ? {}
            : {
                cleared: Option.some(tree),
                finishOwed: finish === "required",
                waiting: decisions.map(({ id }) => id),
              },
        Decided: ({ by, choice, decision }) =>
          approves(choice)
            ? {
                credits: credited(model.credits, "Decided-by", by),
                waiting: model.waiting.filter((id) => id !== decision),
              }
            : {},
        Finished: ({ by }) => ({
          credits: credited(model.credits, "Finished-by", by),
          finished: true,
        }),
        LandedOk: () => ({}),
        MainMoved: () => ({ moved: true, remerges: model.remerges + 1 }),
        MergeConflict: () => ({}),
        Merged: ({ main, tree }) => ({ merged: Option.some({ main, tree }) }),
        Start: () => ({}),
        Wait: () => ({}),
      })
    : {};

  const known = { ...model, ...learned };
  const merged = Option.isSome(merge);

  return {
    ...known,
    applied: tookEffect(model.state, step)
      ? [...model.applied, command]
      : model.applied,
    cleared: merged ? Option.none() : known.cleared,
    delivered: [...model.delivered, command],
    finishOwed: merged ? false : known.finishOwed,
    landingOn: Option.isSome(land)
      ? Option.some(land.value.main)
      : model.landingOn,
    merged: merged ? Option.none() : known.merged,
    merging: Option.isSome(merge)
      ? Option.some(merge.value.main)
      : model.merging,
    moved: merged ? false : known.moved,
    retries: model.retries + retries,
    state: step.state,
    waiting: merged ? [] : known.waiting,
  };
};

/** Every invariant one step must keep; the first one broken, if any. */
const broken = (
  model: Model,
  command: LandingCommand,
  step: Step,
  now: DateTime.Utc
): Option.Option<string> => {
  const after = advance(model, command, step);
  const changed = tookEffect(model.state, step);
  const due = awaited(model, command);

  const placed = step.effects.every((effect) =>
    LandingEffect.$match(effect, {
      Emit: () => LandingState.guards.Landed(step.state),
      Land: ({ main, tree }) =>
        !after.moved &&
        !LandingState.guards.Merging(model.state) &&
        Equal.equals(after.merged, Option.some({ main, tree })) &&
        Option.contains(after.cleared, tree) &&
        after.waiting.length === 0 &&
        (!after.finishOwed || after.finished),
      Merge: ({ main }) =>
        LandingState.guards.Merging(step.state) && step.state.main === main,
      Record: ({ sha }) =>
        LandingState.guards.Landed(step.state) && step.state.sha === sha,
      Retry: ({ at }) =>
        DateTime.isGreaterThan(at, now) &&
        (LandingCommand.$is("Busy")(command) ||
          LandingCommand.$is("Blocked")(command)),
      RunChecks: ({ tree }) =>
        LandingCommand.$is("Merged")(command) && command.tree === tree,
    })
  );

  const rules: readonly (readonly [string, boolean])[] = [
    ["a landed or refused answer moved", !isTerminal(model.state) || !changed],
    [
      "a command delivered again had an effect",
      !Array.contains(model.applied, command) || !changed,
    ],
    [
      "a report about another main, tree, attempt or decision, or one its state does not wait for, had an effect",
      !changed || due,
    ],
    ["a report its state waited for had no effect", !due || changed],
    [
      "main moved during landing, and no merge against the new main followed",
      !(due && LandingCommand.$is("MainMoved")(command)) ||
        step.effects.some(
          (effect) =>
            LandingEffect.$is("Merge")(effect) && effect.main === command.main
        ) ||
        (LandingState.guards.Refused(step.state) &&
          after.remerges === maxRemerges + 1),
    ],
    [
      `still underway after more than ${maxRemerges} re-merges`,
      after.remerges <= maxRemerges || isTerminal(step.state),
    ],
    [
      "the re-merges counted differ from the times main moved",
      Option.match(remergesOf(step.state), {
        onNone: () => true,
        onSome: (remerges) => remerges === after.remerges,
      }),
    ],
    [
      "a conflict, a failed check or a declined decision did not refuse the answer",
      !(due && refuses(command)) || LandingState.guards.Refused(step.state),
    ],
    [
      "it waits on other decisions than the checks asked for",
      !LandingState.guards.AwaitingDecision(step.state) ||
        Equal.equals(
          waitingOn(step.state).map(({ id }) => id),
          after.waiting
        ),
    ],
    [
      "it waits for a finish nobody owes, or one already given",
      !LandingState.guards.AwaitingFinish(step.state) ||
        (after.finishOwed && !after.finished),
    ],
    [
      "the landing does not credit, once each, everyone who finished it or accepted a decision it waited on",
      step.effects.every(
        (effect) =>
          !LandingEffect.$is("Emit")(effect) ||
          !ProjectEventInput.$is("Landed")(effect.event) ||
          Equal.equals(effect.event.landing.credits, after.credits)
      ),
    ],
    [
      "landed without landing",
      !LandingState.guards.Landed(step.state) ||
        LandingState.guards.Landed(model.state) ||
        LandingState.guards.Landing(model.state),
    ],
    [
      "an effect out of place (Land only on the latest merge's tree, checked clean, with every decision and finish given)",
      placed,
    ],
  ];

  return Option.map(
    Array.findFirst(rules, ([, holds]) => !holds),
    ([rule]) => rule
  );
};

const describeCommand = (command: LandingCommand) => JSON.stringify(command);

/** A history's end, and every state it passed through. */
interface Run {
  readonly model: Model;
  readonly visited: ReadonlySet<LandingState["_tag"]>;
}

/** Runs a history; fails with the first broken invariant and where it broke. */
const run = (moves: readonly Move[]): Result.Result<Run, string> => {
  const visited = new Set<LandingState["_tag"]>(["Queued"]);
  let model = begin;

  for (const [step, move] of moves.entries()) {
    const command = commandFor(move, model, step);

    if (Option.isSome(command)) {
      const now = DateTime.addDuration(opened, Duration.seconds(step));
      const result = transition(model.state, command.value, now);
      const violation = broken(model, command.value, result, now);

      if (Option.isSome(violation)) {
        return Result.fail(
          `step ${step}: ${violation.value}, at ${model.state._tag} on ${describeCommand(command.value)}`
        );
      }

      model = advance(model, command.value, result);
      visited.add(model.state._tag);
    }
  }

  return Result.succeed({ model, visited });
};

const holds = (moves: readonly Move[]) =>
  Result.match(run(moves), {
    onFailure: (violation) => Effect.fail(violation),
    onSuccess: () => Effect.succeed(true),
  });

/**
 * Generated histories are CPU work alone: under a second on an idle machine,
 * several seconds while turbo runs every package's tests at once (the CLI's
 * build test compiles binaries beside them). This limit is there to catch a
 * hang, not a busy machine.
 */
const generated = { timeout: 30_000 };

describe("the landing lifecycle over generated histories", generated, () => {
  it.effect("keeps every invariant after every step", () =>
    Effect.gen(function* () {
      const result = yield* Arbitrary.checkEffect(histories, holds, {
        runs: 3000,
        seed: 219,
        size,
      });

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    })
  );

  // A model test whose histories never land proves nothing: they must reach
  // every state, land after main moved under a landing, and run out of
  // re-merges.
  it.effect("reaches every state, re-merges and runs out of re-merges", () =>
    Effect.gen(function* () {
      const sample = yield* Arbitrary.sampleEffect(histories, {
        count: 1000,
        seed: 219,
        size,
      });

      const runs = sample.flatMap((moves) =>
        Result.match(run(moves), {
          onFailure: () => [],
          onSuccess: (ran) => [ran],
        })
      );

      const seen = new Set(runs.flatMap(({ visited }) => [...visited]));

      expect(runs).toHaveLength(sample.length);
      expect([...seen].toSorted()).toStrictEqual(
        Object.keys(LandingState.cases).toSorted()
      );
      expect(
        runs.some(
          ({ model }) =>
            LandingState.guards.Landed(model.state) && model.remerges > 0
        )
      ).toBeTruthy();
      expect(
        runs.some(({ model }) => model.remerges > maxRemerges)
      ).toBeTruthy();
    })
  );
});

const QueueMove = Schema.Struct({
  id: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
  op: Schema.Literals(["Enqueue", "Next", "Settle"]),
});

type QueueMove = typeof QueueMove.Type;

const requestIds = [
  RequestId.make("push-0001"),
  RequestId.make("push-0002"),
  RequestId.make("push-0003"),
] as const;

/** The queue as the model keeps it: who is landing, and who waits, in order. */
interface Line {
  readonly landing: Option.Option<RequestId>;
  readonly waiting: readonly RequestId[];
}

const serial = (moves: readonly QueueMove[]) => {
  let queue = LandingQueue.make({ active: Option.none(), order: [] });
  let line: Line = { landing: Option.none(), waiting: [] };

  for (const [step, { id, op }] of moves.entries()) {
    const requestId = requestIds[id] ?? requestIds[0];

    if (op === "Next") {
      const { admit, queue: after } = admitNext(queue);

      if (Option.isSome(line.landing) && Option.isSome(admit)) {
        return Effect.fail(
          `step ${step}: admitted ${admit.value} while ${line.landing.value} is landing`
        );
      }

      if (!Option.isSome(line.landing)) {
        if (!Equal.equals(admit, Array.head(line.waiting))) {
          return Effect.fail(`step ${step}: admitted out of order`);
        }

        line = { landing: admit, waiting: line.waiting.slice(1) };
      }

      queue = after;
    } else if (op === "Enqueue") {
      queue = enqueue(queue, requestId);
      line =
        Option.contains(line.landing, requestId) ||
        line.waiting.includes(requestId)
          ? line
          : { ...line, waiting: [...line.waiting, requestId] };
    } else {
      queue = settle(queue, requestId);
      line = {
        landing: Option.filter(
          line.landing,
          (landing) => landing !== requestId
        ),
        waiting: line.waiting.filter((waiting) => waiting !== requestId),
      };
    }

    if (
      !Equal.equals(
        queue,
        LandingQueue.make({ active: line.landing, order: line.waiting })
      )
    ) {
      return Effect.fail(`step ${step}: the queue lost or reordered a request`);
    }
  }

  return Effect.succeed(true);
};

describe("the landing queue over generated histories", generated, () => {
  it.effect("never admits a second request while one is landing", () =>
    Effect.gen(function* () {
      const result = yield* Arbitrary.checkEffect(
        Arbitrary.array(Arbitrary.schema(QueueMove), { maxLength: 30 }),
        serial,
        { runs: 2000, seed: 219, size: 30 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    })
  );
});
