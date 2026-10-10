import { describe, expect, it } from "@effect/vitest";
import { RefNameText } from "@repo/protocol/domain/common";
import { LayerName, ProjectName } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  CapReached,
  ClaimLapsed,
  Denounced,
  DirectPush,
  NoAsk,
  NotClaimed,
  NotVouched,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Effect, Option } from "effect";

import { PushTarget } from "../src/facts.ts";
import type { PushFacts } from "../src/facts.ts";
import { parse } from "../src/stages/parse.ts";
import {
  alice,
  ask,
  bob,
  carol,
  claim,
  dana,
  mallory,
  policy,
  testFacts,
  wire,
} from "./facts.ts";

/** Dana's own live claim on the ask, and her push to its fork. */
const danasPush = (mode: PushFacts["policy"]["vouch"]["mode"]) =>
  testFacts({
    claim: Option.some({ ...claim, claimant: dana }),
    policy: { ...policy, vouch: { ...policy.vouch, mode } },
    pusher: Person.make({ handle: dana }),
    target: PushTarget.ClaimFork({
      ask: ask.id,
      claimant: dana,
      project: ask.project,
    }),
  });

/** Dana's push to her own working fork (`<project>--me--dana`). */
const danasWorkingForkPush = (mode: PushFacts["policy"]["vouch"]["mode"]) =>
  testFacts({
    ask: Option.none(),
    claim: Option.none(),
    policy: { ...policy, vouch: { ...policy.vouch, mode } },
    pusher: Person.make({ handle: dana }),
    target: PushTarget.WorkingFork({ owner: dana, project: ask.project }),
  });

const main = RefNameText.make("refs/heads/main");

const tag = RefNameText.make("refs/tags/v1");

// Each row is one push; parse answers with at most one refusal, the first
// rule the push breaks.
const rows: readonly {
  readonly name: string;
  readonly facts: PushFacts;
  readonly refusals: readonly Refusal[];
}[] = [
  {
    facts: testFacts(),
    name: "the claimant's push to their fork",
    refusals: [],
  },
  {
    facts: testFacts({ claim: Option.none() }),
    name: "a push to an ask no one has claimed",
    refusals: [NotClaimed.of(ask.id)],
  },
  {
    facts: testFacts({ claim: Option.some({ ...claim, state: "lapsed" }) }),
    name: "a push on a lapsed claim",
    refusals: [ClaimLapsed.of(ask.id)],
  },
  {
    facts: testFacts({ pusher: Person.make({ handle: carol }) }),
    name: "a push to someone else's claim fork",
    refusals: [NotClaimed.of(ask.id)],
  },
  {
    facts: testFacts({
      pusher: Person.make({ handle: carol }),
      target: PushTarget.ClaimFork({
        ask: ask.id,
        claimant: carol,
        project: ask.project,
      }),
    }),
    name: "a push to a fork in the pusher's name while another holds the claim",
    refusals: [NotClaimed.of(ask.id)],
  },
  {
    facts: testFacts({ claim: Option.some({ ...claim, state: "released" }) }),
    name: "a push on a released claim",
    refusals: [NotClaimed.of(ask.id)],
  },
  {
    facts: testFacts({ pusher: Anonymous.make({}) }),
    name: "a push with no person behind it",
    refusals: [NotClaimed.of(ask.id)],
  },
  {
    facts: testFacts({ pusher: Person.make({ handle: mallory }) }),
    name: "a push by a denounced person",
    refusals: [new Denounced({})],
  },
  // The claim already passed the kind's `claimers` rule (`mayClaim`), which
  // may admit an unvouched person (an `anyone` kind, a record, a mentor), so
  // a push to the claim's own fork does not judge the vouch again.
  {
    facts: danasPush("forCode"),
    name: "an unvouched claimant's push to their claim's fork when code needs a vouch",
    refusals: [],
  },
  {
    facts: danasPush("all"),
    name: "an unvouched claimant's push to their claim's fork when everything needs a vouch",
    refusals: [],
  },
  {
    facts: danasWorkingForkPush("forCode"),
    name: "an unvouched person's push to their working fork when code needs a vouch",
    refusals: [new NotVouched({})],
  },
  {
    facts: danasWorkingForkPush("bansOnly"),
    name: "an unvouched person's push to their working fork when only denouncements count",
    refusals: [],
  },
  {
    facts: testFacts({
      policy: {
        ...policy,
        vouches: [{ denounced: false, handle: mallory }, ...policy.vouches],
      },
      pusher: Person.make({ handle: mallory }),
    }),
    name: "a push by a person the vouch file both vouches for and denounces",
    refusals: [new Denounced({})],
  },
  {
    facts: testFacts({
      pusher: Person.make({ handle: mallory }),
      target: PushTarget.Canonical({ project: ask.project }),
    }),
    name: "a push to canonical main, even by a denounced person",
    refusals: [new DirectPush({ ref: main })],
  },
  {
    facts: testFacts({
      pusher: Person.make({ handle: alice }),
      ref: RefNameText.make("refs/heads/release"),
      target: PushTarget.Canonical({ project: ask.project }),
    }),
    name: "a decider's push to another canonical branch",
    refusals: [new DirectPush({ ref: "refs/heads/release" })],
  },
  {
    facts: testFacts({ ask: Option.none() }),
    name: "a push to a claim fork whose ask is not open",
    refusals: [new NoAsk({})],
  },
  {
    facts: testFacts({ ask: Option.some({ ...ask, state: "closed" }) }),
    name: "a push to a claim fork whose ask has closed",
    refusals: [new NoAsk({})],
  },
  {
    facts: testFacts({
      target: PushTarget.ClaimFork({
        ask: ask.id,
        claimant: bob,
        project: ProjectName.make("timekit"),
      }),
    }),
    name: "a push to another project's fork of an ask with the same name",
    refusals: [new NoAsk({})],
  },
  {
    facts: testFacts({ claimsHeld: 4 }),
    name: "a push by a claimant above the cap a landing lowered",
    refusals: [new CapReached({ cap: 3 })],
  },
  {
    facts: testFacts({ claimsHeld: 3 }),
    name: "a push by a claimant at the cap",
    refusals: [],
  },
  {
    facts: testFacts({
      ask: Option.none(),
      claim: Option.none(),
      pusher: Person.make({ handle: alice }),
      target: PushTarget.WorkingFork({ owner: alice, project: ask.project }),
    }),
    name: "a decider's push to their own working fork (deciders vouch, so need none)",
    refusals: [],
  },
  {
    facts: testFacts({
      ask: Option.none(),
      claim: Option.none(),
      target: PushTarget.WorkingFork({ owner: alice, project: ask.project }),
    }),
    name: "a push to another person's working fork",
    refusals: [new DirectPush({ ref: main })],
  },
  {
    facts: testFacts({
      ask: Option.none(),
      claim: Option.none(),
      pusher: Person.make({ handle: alice }),
      target: PushTarget.Layer({
        layer: LayerName.make("maintainers"),
        project: ask.project,
      }),
    }),
    name: "a push to a layer's repo, which W6 opens to its writers",
    refusals: [new DirectPush({ ref: main })],
  },
  // A fork takes branches only: every other ref is the platform's to write.
  {
    facts: testFacts({ ref: tag }),
    name: "the claimant's push of a tag to their claim's fork",
    refusals: [new DirectPush({ ref: tag })],
  },
  {
    facts: testFacts({
      ask: Option.none(),
      claim: Option.none(),
      pusher: Person.make({ handle: alice }),
      ref: tag,
      target: PushTarget.WorkingFork({ owner: alice, project: ask.project }),
    }),
    name: "an owner's push of a tag to their own working fork",
    refusals: [new DirectPush({ ref: tag })],
  },
  {
    facts: testFacts({
      ask: Option.none(),
      claim: Option.none(),
      pusher: Person.make({ handle: alice }),
      ref: RefNameText.make("refs/heads/wip"),
      target: PushTarget.WorkingFork({ owner: alice, project: ask.project }),
    }),
    name: "an owner's push of another branch to their own working fork",
    refusals: [],
  },
];

describe("parse: who may push what", () => {
  it.effect.each(rows)("$name", ({ facts, refusals }) =>
    Effect.gen(function* () {
      const found = yield* parse.run(facts);

      expect(wire(found)).toStrictEqual(wire(refusals));
    })
  );
});
