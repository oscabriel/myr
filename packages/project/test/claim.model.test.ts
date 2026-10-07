import { assert, describe, it } from "@effect/vitest";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { AskFull } from "@repo/protocol/refusal";
import { Arbitrary, DateTime, Option, Result, Schema } from "effect";

import {
  ClaimCommand,
  ClaimEffect,
  ClaimState,
  forkName,
  transition,
} from "../src/claim.ts";
import type { ClaimRefusal, ClaimStep, Live } from "../src/claim.ts";

// A model test (ADR 0012): generated histories of claims, pushes, alarms,
// releases and landings run through `transition` the way the project service
// would, and every step is checked against the claim lifecycle's invariants.

const HOUR = 3_600_000;

/** The defaults: warned after 2 quiet hours, lapsed after 24. */
const policy = { lapseAfterMs: 24 * HOUR, warnAfterMs: 2 * HOUR };

const project = ProjectName.make("datekit");

const canonical = RepoName.make("datekit");

const ask = AskId.make("parse-iso");

const blocker = AskId.make("drop-legacy");

const base = CommitSha.make("1".repeat(40));

const head = CommitSha.make("2".repeat(40));

const landing = LandedSha.make("3".repeat(40));

const cap = 3;

const start = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

/** Four people; `Bob` checks that a fork's name lowercases the handle. */
const People = Schema.Literals(["alice", "Bob", "carol", "dave"]);

/**
 * How the person making a claim stands: free to claim, or meeting exactly one
 * refusal (denounced, not vouched, the ask blocked, or at their cap).
 */
const Standing = Schema.Literals([
  "clear",
  "denounced",
  "unvouched",
  "blocked",
  "atCap",
]);

type Standing = typeof Standing.Type;

/** One thing that happens to the ask, as a history step names it. */
const Move = Schema.TaggedUnion({
  Claim: { standing: Standing, who: People },
  Land: { who: People },
  Push: { who: People },
  Release: { who: People },
  Tick: {},
});

type Move = typeof Move.Type;

/**
 * How the project service keeps the ask's claims: one state for the whole
 * ask (`shared`, an exclusive kind), or one state per claimant with the
 * kind's `race` (1 to 3) passed to each claim.
 */
const Layout = Schema.Literals(["shared", "race1", "race2", "race3"]);

type Layout = typeof Layout.Type;

/** One step of a history: whole hours waited since the last one, then a move. */
interface Step {
  readonly after: number;
  readonly move: Move;
}

const roll = (maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum: 0 })));

const person = Arbitrary.schema(People);

/** Most claims are clear; a roll below 4 picks one refusal. */
const troubles = ["denounced", "unvouched", "blocked", "atCap"] as const;

const standing = roll(9).pipe(
  Arbitrary.map((n): Standing => troubles[n] ?? "clear")
);

const claims = Arbitrary.all({ standing, who: person }).pipe(
  Arbitrary.map((made) => Move.cases.Claim.make(made))
);

const pushes = person.pipe(
  Arbitrary.map((who) => Move.cases.Push.make({ who }))
);

const releases = person.pipe(
  Arbitrary.map((who) => Move.cases.Release.make({ who }))
);

const lands = person.pipe(
  Arbitrary.map((who) => Move.cases.Land.make({ who }))
);

const ticks = Arbitrary.Constant(Move.cases.Tick.make({}));

/** Moves by weight; shrinking a roll towards 0 turns a move into an alarm. */
const weighted = [
  ticks,
  ticks,
  pushes,
  pushes,
  pushes,
  claims,
  claims,
  claims,
  releases,
  lands,
];

const moves = roll(weighted.length - 1).pipe(
  Arbitrary.flatMap((n): Arbitrary.Arbitrary<Move> => weighted[n] ?? ticks)
);

/** Whole hours, so steps land exactly on the 2 h and 24 h deadlines often. */
const histories = Arbitrary.array(
  Arbitrary.all({ after: roll(26), move: moves }),
  { maxLength: 40 }
);

const layouts = Arbitrary.schema(Layout);

const raceOf = (layout: Layout) =>
  ({ race1: 1, race2: 2, race3: 3, shared: 1 })[layout];

/** A live claim: `Live` or `Warned`. */
const live = (state: ClaimState): Option.Option<Live> =>
  ClaimState.match(state, {
    Answered: () => Option.none(),
    Lapsed: () => Option.none(),
    Live: Option.some<Live>,
    Open: () => Option.none(),
    Released: () => Option.none(),
    Warned: Option.some<Live>,
  });

/** Any state that holds or held a claim. */
const held = (state: ClaimState): Option.Option<Live> =>
  ClaimState.match(state, {
    Answered: Option.some<Live>,
    Lapsed: Option.some<Live>,
    Live: Option.some<Live>,
    Open: () => Option.none(),
    Released: Option.some<Live>,
    Warned: Option.some<Live>,
  });

const isLive = (state: ClaimState) => Option.isSome(live(state));

const tagOf = ClaimState.match({
  Answered: () => "Answered",
  Lapsed: () => "Lapsed",
  Live: () => "Live",
  Open: () => "Open",
  Released: () => "Released",
  Warned: () => "Warned",
});

const ms = (time: DateTime.Utc) => DateTime.toEpochMillis(time);

/** The time a claim's deadlines count from: its last push, or its making. */
const quietSince = (claim: Live) =>
  Option.getOrElse(claim.lastPushAt, () => claim.openedAt);

const encode = Schema.encodeSync(ClaimState);

const same = (left: ClaimState, right: ClaimState) =>
  JSON.stringify(encode(left)) === JSON.stringify(encode(right));

/** One call to `transition`, as the model service made it. */
interface Call {
  readonly before: ClaimState;
  readonly command: ClaimCommand;
  readonly now: DateTime.Utc;
}

/** Whether a claim command meets none of the refusals it could meet. */
const clear = ({ before, command }: Call) =>
  ClaimCommand.guards.Claim(command) &&
  !isLive(before) &&
  tagOf(before) !== "Answered" &&
  command.liveCount < command.race &&
  command.blockedBy.length === 0 &&
  command.heldByWho < command.cap &&
  !command.denounced &&
  command.vouched;

/** Whether a claim command finds every claim the ask allows taken. */
const full = ({ before, command }: Call) =>
  ClaimCommand.guards.Claim(command) &&
  (tagOf(before) === "Answered" ||
    command.liveCount >= command.race ||
    Option.exists(
      live(before),
      (holder) => holder.claimant !== command.who.handle
    ));

/** Whether a push comes from the holder of a live claim. */
const holderPushes = ({ before, command }: Call) =>
  ClaimCommand.guards.Push(command) &&
  Option.exists(live(before), (holder) => holder.claimant === command.who);

/** Whether a claim command goes live, held by the person who made it. */
const madeLive = ({ command }: Call, state: ClaimState) =>
  ClaimCommand.guards.Claim(command) &&
  Option.exists(
    live(state),
    (holder) => holder.claimant === command.who.handle
  );

/** What a refusal keeps: AskFull comes first, and nothing allowed is refused. */
const brokenByRefusal = (call: Call, refusal: ClaimRefusal) => [
  ...(full(call) && !Schema.is(AskFull)(refusal)
    ? [`a full ask is refused with AskFull, not ${refusal._tag}`]
    : []),
  ...(clear(call) ? [`a clear claim is refused with ${refusal._tag}`] : []),
  ...(holderPushes(call) ? ["the holder's push is refused"] : []),
];

/** An invariant over one successful call, naming what it found broken. */
type Invariant = (call: Call, done: ClaimStep) => readonly string[];

/** A claim that meets no refusal goes live, held by its maker; a full ask takes none. */
const progresses: Invariant = (call, { state }) => [
  ...(clear(call) && !madeLive(call, state) ? ["a clear claim goes live"] : []),
  ...(full(call) ? ["a full ask takes a claim"] : []),
];

/** The holder's push keeps the claim live and counts from now. */
const pushesRenew: Invariant = (call, { state }) =>
  holderPushes(call) &&
  !(
    tagOf(state) === "Live" &&
    Option.exists(live(state), (holder) =>
      Option.exists(holder.lastPushAt, (pushed) => ms(pushed) === ms(call.now))
    )
  )
    ? ["the holder's push makes the claim live from now"]
    : [];

/**
 * A fork is made only on the way into Live from no claim, a lapsed one or a
 * released one, and then exactly once, named for the new claimant.
 */
const forksOnlyNewClaims: Invariant = ({ before }, { effects, state }) => {
  const forks = effects.filter(ClaimEffect.$is("MakeFork"));

  const opens =
    ["Open", "Released", "Lapsed"].includes(tagOf(before)) &&
    tagOf(state) === "Live";

  if (!opens) {
    return forks.length > 0 ? [`a fork made from ${tagOf(before)}`] : [];
  }

  const named = Option.map(live(state), (claim) =>
    forkName(project, ask, claim.claimant)
  );

  return forks.length === 1 &&
    Option.exists(named, (name) => forks[0]?.name === name) &&
    forks[0]?.from === canonical
    ? []
    : ["a new claim makes one fork, named for its claimant"];
};

/** Access is revoked exactly when a live claim ends. */
const revokesWhenLiveEnds: Invariant = ({ before }, { effects, state }) => {
  const revokes = effects.filter(ClaimEffect.$is("RevokeAccess")).length;
  const ends = isLive(before) && !isLive(state);

  return revokes === (ends ? 1 : 0)
    ? []
    : ["access is revoked once when a live claim ends"];
};

/** Deadlines count from the last push, or from the claim, never from later. */
const deadlinesCount: Invariant = ({ now }, { state }) =>
  Option.match(held(state), {
    onNone: () => [],
    onSome: (claim) => {
      const since = ms(quietSince(claim));

      return [
        ...(ms(claim.lapsesAt) - since === policy.lapseAfterMs
          ? []
          : ["lapsesAt is the last push (or the claim) plus lapseAfterMs"]),
        ...(ms(claim.warnsAt) - since === policy.warnAfterMs
          ? []
          : ["warnsAt is the last push (or the claim) plus warnAfterMs"]),
        ...(since > ms(now) ? ["a claim pushed to or made after now"] : []),
      ];
    },
  });

/** Alarms are set only for later, and events happen now. */
const noTimeTravel: Invariant = ({ now }, { effects }) => [
  ...effects
    .filter(ClaimEffect.$is("SetAlarm"))
    .flatMap((alarm) =>
      ms(alarm.at) > ms(now) ? [] : ["an alarm set for now or earlier"]
    ),
  ...effects
    .filter(ClaimEffect.$is("Emit"))
    .flatMap((emitted) =>
      ms(emitted.event.at) === ms(now) ? [] : ["an event that is not now"]
    ),
];

/** A claim is warned no earlier than warnsAt, and lapses no earlier than lapsesAt. */
const deadlinesKept: Invariant = ({ before, now }, { state }) => {
  const entered = tagOf(state) !== tagOf(before);

  return Option.match(held(state), {
    onNone: () => [],
    onSome: (claim) => [
      ...(entered && tagOf(state) === "Warned" && ms(now) < ms(claim.warnsAt)
        ? ["warned before warnsAt"]
        : []),
      ...(entered && tagOf(state) === "Lapsed" && ms(now) < ms(claim.lapsesAt)
        ? ["lapsed before lapsesAt"]
        : []),
    ],
  });
};

/** Answered never changes; Released changes only by a fresh claim. */
const endsAreFinal: Invariant = ({ before, command }, { state }) => [
  ...(tagOf(before) === "Answered" && !same(before, state)
    ? ["Answered is terminal"]
    : []),
  ...(tagOf(before) === "Released" &&
  !same(before, state) &&
  !(ClaimCommand.guards.Claim(command) && tagOf(state) === "Live")
    ? ["Released changes only by a fresh claim"]
    : []),
];

const invariants: readonly Invariant[] = [
  progresses,
  pushesRenew,
  forksOnlyNewClaims,
  revokesWhenLiveEnds,
  deadlinesCount,
  noTimeTravel,
  deadlinesKept,
  endsAreFinal,
];

/** Names every invariant one call broke. */
const brokenBy = (
  call: Call,
  result: Result.Result<ClaimStep, ClaimRefusal>
): readonly string[] =>
  Result.match(result, {
    onFailure: (refusal) => brokenByRefusal(call, refusal),
    onSuccess: (done) =>
      invariants.flatMap((invariant) => invariant(call, done)),
  });

/** The ask's claim states, by slot: the claimant's handle, or `ask` when shared. */
type Slots = ReadonlyMap<string, ClaimState>;

/** The model project service between two steps. */
interface World {
  readonly now: DateTime.Utc;
  readonly slots: Slots;
}

const slotOf = (layout: Layout, who: string) =>
  layout === "shared" ? "ask" : who;

const stateIn = (slots: Slots, slot: string): ClaimState =>
  slots.get(slot) ?? ClaimState.cases.Open.make({ ask });

const liveOutside = (slots: Slots, slot: string) =>
  [...slots].filter(([key, state]) => key !== slot && isLive(state)).length;

/** A command for one slot. */
interface Addressed {
  readonly command: ClaimCommand;
  readonly slot: string;
}

const to = (slot: string, command: ClaimCommand): Addressed => ({
  command,
  slot,
});

/** The commands the project service would send for a move, and where. */
const commandsFor = (
  layout: Layout,
  slots: Slots,
  move: Move
): readonly Addressed[] =>
  Move.match(move, {
    Claim: ({ standing: made, who }) => [
      to(
        slotOf(layout, who),
        ClaimCommand.cases.Claim.make({
          base,
          blockedBy: made === "blocked" ? [blocker] : [],
          cap,
          denounced: made === "denounced",
          heldByWho: made === "atCap" ? cap : 0,
          liveCount: liveOutside(slots, slotOf(layout, who)),
          project,
          race: raceOf(layout),
          vouched: made !== "unvouched",
          who: Person.make({ handle: Handle.make(who) }),
        })
      ),
    ],
    Land: ({ who }) => [
      to(slotOf(layout, who), ClaimCommand.cases.Land.make({ landing })),
    ],
    Push: ({ who }) => [
      to(
        slotOf(layout, who),
        ClaimCommand.cases.Push.make({ head, who: Handle.make(who) })
      ),
    ],
    Release: ({ who }) => [
      to(
        slotOf(layout, who),
        ClaimCommand.cases.Release.make({ who: Handle.make(who) })
      ),
    ],
    // An alarm reaches every claim the ask holds.
    Tick: () =>
      [...slots.keys()].map((slot) =>
        to(slot, ClaimCommand.cases.Tick.make({}))
      ),
  });

/** Why an alarm left a claim past a deadline it reached, if it did. */
const overdue = (now: DateTime.Utc, state: ClaimState) =>
  Option.flatMap(live(state), (claim) => {
    if (ms(now) >= ms(claim.lapsesAt)) {
      return Option.some("an alarm left a claim past lapsesAt");
    }

    return tagOf(state) === "Live" && ms(now) >= ms(claim.warnsAt)
      ? Option.some("an alarm left a claim unwarned past warnsAt")
      : Option.none();
  });

/** What the whole ask keeps after a step: the race, and alarms that catch up. */
const brokenAfter = (layout: Layout, world: World, move: Move) => {
  const states = [...world.slots.values()];

  const holders = new Set(
    states.flatMap((state) =>
      Option.toArray(Option.map(live(state), (holder) => holder.claimant))
    )
  );

  return [
    ...(holders.size > raceOf(layout)
      ? [`${holders.size} live claims on a race of ${raceOf(layout)}`]
      : []),
    ...(Move.guards.Tick(move)
      ? states.flatMap((state) => Option.toArray(overdue(world.now, state)))
      : []),
  ];
};

/** Takes one step: the next world, and what broke on the way. */
const advance = (layout: Layout, world: World, { after, move }: Step) => {
  const now = DateTime.add(world.now, { hours: after });
  const slots = new Map(world.slots);
  const broken: string[] = [];

  for (const { command, slot } of commandsFor(layout, world.slots, move)) {
    const call = { before: stateIn(world.slots, slot), command, now };
    const result = transition(call.before, command, now, policy);

    broken.push(...brokenBy(call, result));

    if (Result.isSuccess(result)) {
      slots.set(slot, result.success.state);
    }
  }

  const next = { now, slots };

  return { broken: [...broken, ...brokenAfter(layout, next, move)], next };
};

/** Runs a history; returns its first bad step and what that step broke. */
const firstBreak = (layout: Layout, steps: readonly Step[]) => {
  let world: World = { now: start, slots: new Map() };

  for (const [index, step] of steps.entries()) {
    const { broken, next } = advance(layout, world, step);

    if (broken.length > 0) {
      return [`step ${index}`, ...broken];
    }

    world = next;
  }

  return [];
};

describe("the claim lifecycle, over generated histories", () => {
  it.prop(
    "keeps every invariant after every step",
    { history: histories, layout: layouts },
    ({ history, layout }) => {
      const broken = firstBreak(layout, history);

      assert.deepStrictEqual(broken, [], broken.join("; "));
    },
    { arbitrary: { runs: 1000, size: 40 } }
  );
});
