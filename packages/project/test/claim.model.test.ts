import { assert, describe, it } from "@effect/vitest";
import {
  AskId,
  claimForkName,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  Arbitrary,
  Array as Arr,
  DateTime,
  Option,
  Predicate,
  Result,
  Schema,
} from "effect";

import {
  ClaimCommand,
  ClaimEffect,
  ClaimState,
  transition,
} from "../src/claim.ts";
import type { ClaimResult, ClaimStep, Live } from "../src/claim.ts";

const HOUR = 3_600_000;

const policy = { lapseAfterMs: 24 * HOUR, warnAfterMs: 2 * HOUR };

const project = ProjectName.make("alice/datekit");

const canonical = RepoName.make("alice__datekit");

const ask = AskId.make("parse-iso");

const blocker = AskId.make("drop-legacy");

const base = CommitSha.make("1".repeat(40));

const head = CommitSha.make("2".repeat(40));

const landing = LandedSha.make("3".repeat(40));

const cap = 3;

const start = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

/** `Bob` checks that a fork's name lowercases the handle. */
const People = Schema.Literals(["alice", "Bob", "carol", "dave"]);

const Standing = Schema.Struct({
  atCap: Schema.Boolean,
  blocked: Schema.Boolean,
  denounced: Schema.Boolean,
  unvouched: Schema.Boolean,
});

const Move = Schema.TaggedUnion({
  Claim: { standing: Standing, who: People },
  Land: { who: People },
  Push: { who: People },
  Release: { who: People },
  Tick: {},
});

type Move = typeof Move.Type;

const Layout = Schema.Literals(["shared", "race1", "race2", "race3"]);

type Layout = typeof Layout.Type;

interface Step {
  readonly after: number;
  readonly move: Move;
}

const roll = (maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum: 0 })));

const person = Arbitrary.schema(People);

/** True one time in six; it shrinks to false, so a shrunk claim meets nothing. */
const rare = roll(5).pipe(Arbitrary.map((n) => n === 5));

const standing = Arbitrary.all({
  atCap: rare,
  blocked: rare,
  denounced: rare,
  unvouched: rare,
});

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

/** Whole hours, so steps often land exactly on the 2 h and 24 h deadlines. */
const histories = Arbitrary.array(
  Arbitrary.all({ after: roll(26), move: moves }),
  { maxLength: 40 }
);

const layouts = Arbitrary.schema(Layout);

const raceOf = (layout: Layout) =>
  ({ race1: 1, race2: 2, race3: 3, shared: 1 })[layout];

const live = (state: ClaimState): Option.Option<Live> =>
  ClaimState.match(state, {
    Answered: () => Option.none(),
    Lapsed: () => Option.none(),
    Live: Option.some<Live>,
    Open: () => Option.none(),
    Released: () => Option.none(),
    Warned: Option.some<Live>,
  });

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

const ms = (time: DateTime.Utc) => DateTime.toEpochMillis(time);

const quietSince = (claim: Live) =>
  Option.getOrElse(claim.lastPushAt, () => claim.openedAt);

const encode = Schema.encodeSync(ClaimState);

const same = (left: ClaimState, right: ClaimState) =>
  JSON.stringify(encode(left)) === JSON.stringify(encode(right));

interface Call {
  readonly before: ClaimState;
  readonly command: ClaimCommand;
  readonly now: DateTime.Utc;
}

type Claim = typeof ClaimCommand.cases.Claim.Type;

const holds = (before: ClaimState, made: Claim) =>
  Option.exists(live(before), (holder) => holder.claimant === made.who.handle);

const owed = (before: ClaimState, made: Claim) =>
  Option.map(
    Arr.findFirst(
      [
        [
          "AskFull",
          ClaimState.guards.Answered(before) ||
            isLive(before) ||
            made.liveCount >= made.race,
        ],
        ["AskBlocked", made.blockedBy.length > 0],
        ["CapReached", made.heldByWho >= made.cap],
        ["Denounced", made.denounced],
        ["NotVouched", !made.vouched],
      ] as const,
      ([, meets]) => meets
    ),
    ([refusal]) => refusal
  );

const claimsAsOwed = (
  { before, command }: Call,
  result: ClaimResult
): readonly string[] => {
  if (!ClaimCommand.guards.Claim(command)) {
    return [];
  }

  if (holds(before, command)) {
    return Result.match(result, {
      onFailure: (refusal) => [
        `the holder claiming again is refused with ${refusal._tag}`,
      ],
      onSuccess: ({ effects, state }) =>
        effects.length === 0 && same(before, state)
          ? []
          : ["the holder claiming again changes the claim"],
    });
  }

  const first = owed(before, command);

  return Result.match(result, {
    onFailure: (refusal) =>
      Option.match(first, {
        onNone: () => [
          `a claim that meets no refusal is refused with ${refusal._tag}`,
        ],
        onSome: (expected) =>
          Predicate.isTagged(refusal, expected)
            ? []
            : [
                `a claim that meets ${expected} first is refused with ${refusal._tag}`,
              ],
      }),
    onSuccess: ({ state }) =>
      Option.match(first, {
        onNone: () =>
          Option.exists(
            live(state),
            (holder) => holder.claimant === command.who.handle
          )
            ? []
            : ["a claim that meets no refusal goes live, held by its maker"],
        onSome: (expected) => [`a claim that meets ${expected} goes through`],
      }),
  });
};

const pushedOrReleasedBy = ClaimCommand.match({
  Claim: () => Option.none<Handle>(),
  Land: () => Option.none<Handle>(),
  Push: ({ who }) => Option.some(who),
  Release: ({ who }) => Option.some(who),
  Tick: () => Option.none<Handle>(),
});

const holderOnly = (
  { before, command }: Call,
  result: ClaimResult
): readonly string[] =>
  Option.match(pushedOrReleasedBy(command), {
    onNone: () => [],
    onSome: (who) => {
      const holder = Option.exists(
        live(before),
        (claim) => claim.claimant === who
      );

      return Result.match(result, {
        onFailure: (refusal) =>
          holder
            ? [`the holder's ${command._tag} is refused with ${refusal._tag}`]
            : [],
        onSuccess: ({ state }) =>
          holder || same(before, state)
            ? []
            : [`a ${command._tag} by someone without the live claim moves it`],
      });
    },
  });

const holderPushes = ({ before, command }: Call) =>
  ClaimCommand.guards.Push(command) &&
  Option.exists(live(before), (holder) => holder.claimant === command.who);

type Invariant = (call: Call, done: ClaimStep) => readonly string[];

const pushesRenew: Invariant = (call, { state }) =>
  holderPushes(call) &&
  !(
    ClaimState.guards.Live(state) &&
    Option.exists(live(state), (holder) =>
      Option.exists(holder.lastPushAt, (pushed) => ms(pushed) === ms(call.now))
    )
  )
    ? ["the holder's push makes the claim live from now"]
    : [];

const forksOnlyNewClaims: Invariant = ({ before }, { effects, state }) => {
  const forks = effects.filter(ClaimEffect.$is("MakeFork"));

  const opens =
    ClaimState.isAnyOf(["Open", "Released", "Lapsed"])(before) &&
    ClaimState.guards.Live(state);

  if (!opens) {
    return forks.length > 0 ? [`a fork made from ${before._tag}`] : [];
  }

  const named = Option.map(live(state), (claim) =>
    claimForkName(project, ask, claim.claimant)
  );

  return forks.length === 1 &&
    Option.exists(named, (name) => forks[0]?.name === name) &&
    forks[0]?.from === canonical
    ? []
    : ["a new claim makes one fork, named for its claimant"];
};

const revokesWhenLiveEnds: Invariant = ({ before }, { effects, state }) => {
  const revokes = effects.filter(ClaimEffect.$is("RevokeAccess")).length;
  const ends = isLive(before) && !isLive(state);

  return revokes === (ends ? 1 : 0)
    ? []
    : ["access is revoked once when a live claim ends"];
};

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

const deadlinesKept: Invariant = ({ before, now }, { state }) =>
  Option.match(held(state), {
    onNone: () => [],
    onSome: (claim) => [
      ...(ClaimState.guards.Warned(state) &&
      !ClaimState.guards.Warned(before) &&
      ms(now) < ms(claim.warnsAt)
        ? ["warned before warnsAt"]
        : []),
      ...(ClaimState.guards.Lapsed(state) &&
      !ClaimState.guards.Lapsed(before) &&
      ms(now) < ms(claim.lapsesAt)
        ? ["lapsed before lapsesAt"]
        : []),
    ],
  });

const alarmsNextDeadline: Invariant = ({ before }, { effects, state }) =>
  Option.match(live(state), {
    onNone: () => [],
    onSome: (claim) => {
      const next = ClaimState.guards.Warned(state)
        ? claim.lapsesAt
        : claim.warnsAt;

      return same(before, state) ||
        effects
          .filter(ClaimEffect.$is("SetAlarm"))
          .some((alarm) => ms(alarm.at) === ms(next))
        ? []
        : [
            `a claim moved to ${state._tag} sets no alarm for its next deadline`,
          ];
    },
  });

const endsAreFinal: Invariant = ({ before, command }, { state }) => [
  ...(ClaimState.guards.Answered(before) && !same(before, state)
    ? ["Answered is terminal"]
    : []),
  ...(ClaimState.guards.Released(before) &&
  !same(before, state) &&
  !(ClaimCommand.guards.Claim(command) && ClaimState.guards.Live(state))
    ? ["Released changes only by a fresh claim"]
    : []),
];

const invariants: readonly Invariant[] = [
  pushesRenew,
  forksOnlyNewClaims,
  revokesWhenLiveEnds,
  deadlinesCount,
  noTimeTravel,
  deadlinesKept,
  alarmsNextDeadline,
  endsAreFinal,
];

const brokenBy = (call: Call, result: ClaimResult): readonly string[] => [
  ...claimsAsOwed(call, result),
  ...holderOnly(call, result),
  ...Result.match(result, {
    onFailure: () => [],
    onSuccess: (done) =>
      invariants.flatMap((invariant) => invariant(call, done)),
  }),
];

type Slots = ReadonlyMap<string, ClaimState>;

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

interface Addressed {
  readonly command: ClaimCommand;
  readonly slot: string;
}

const to = (slot: string, command: ClaimCommand): Addressed => ({
  command,
  slot,
});

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
          blockedBy: made.blocked ? [blocker] : [],
          cap,
          denounced: made.denounced,
          heldByWho: made.atCap ? cap : 0,
          liveCount: liveOutside(slots, slotOf(layout, who)),
          project,
          race: raceOf(layout),
          vouched: !made.unvouched,
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
    Tick: () =>
      [...slots.keys()].map((slot) =>
        to(slot, ClaimCommand.cases.Tick.make({}))
      ),
  });

const overdue = (now: DateTime.Utc, state: ClaimState) =>
  Option.flatMap(live(state), (claim) => {
    if (ms(now) >= ms(claim.lapsesAt)) {
      return Option.some("an alarm left a claim past lapsesAt");
    }

    return ClaimState.guards.Live(state) && ms(now) >= ms(claim.warnsAt)
      ? Option.some("an alarm left a claim unwarned past warnsAt")
      : Option.none();
  });

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

/** CPU-bound, but slow while turbo runs every package's tests at once: this catches a hang, not a busy machine. */
const generated = { timeout: 30_000 };

describe("the claim lifecycle, over generated histories", generated, () => {
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
