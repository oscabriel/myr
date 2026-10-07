/**
 * Stage 0, parse: who may push what. It reads only the push's target, the
 * pusher, the policy and the claim, so it is free; the first rule a push
 * breaks is its one refusal.
 */
import type { Policy } from "@repo/protocol/domain/policy";
import type { Handle } from "@repo/protocol/ids";
import { Principal } from "@repo/protocol/principal";
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
import { Array, Effect, Option } from "effect";
import type { Data } from "effect";

import { PushTarget } from "../facts.ts";
import type { PushFacts } from "../facts.ts";
import type { Stage } from "../stage.ts";

type Rule = (facts: PushFacts) => Option.Option<Refusal>;

/** Handles name one person however their sign-in provider cases them. */
const sameHandle = (one: Handle, other: Handle) =>
  one.toLowerCase() === other.toLowerCase();

const handleOf = (pusher: Principal): Option.Option<Handle> =>
  Principal.guards.Person(pusher) ? Option.some(pusher.handle) : Option.none();

const isPusher = (facts: PushFacts, handle: Handle) =>
  Option.exists(handleOf(facts.pusher), (pusher) => sameHandle(pusher, handle));

/**
 * Where a person stands by the vouch file: a line names them vouched or
 * denounced. Deciders vouch for others, so a decider with no line is vouched.
 */
const standingOf = (policy: Policy, handle: Handle) => {
  const line = policy.vouches.find((vouch) => sameHandle(vouch.handle, handle));

  if (line !== undefined) {
    return line.denounced ? "denounced" : "vouched";
  }

  const decides = policy.deciders.some((decider) =>
    decider.handles.some((each) => sameHandle(each, handle))
  );

  return decides ? "vouched" : "unknown";
};

/**
 * Main moves only by a landing (spec D1): no push reaches a canonical ref.
 * A working fork takes pushes from its owner only, and a layer's repo takes
 * none here: its writers arrive with the visibility cartridge (W6).
 */
const directPush: Rule = (facts) =>
  PushTarget.$match(facts.target, {
    Canonical: () => Option.some(new DirectPush({ ref: facts.ref })),
    ClaimFork: () => Option.none(),
    Layer: () => Option.some(new DirectPush({ ref: facts.ref })),
    WorkingFork: ({ owner }) =>
      isPusher(facts, owner)
        ? Option.none()
        : Option.some(new DirectPush({ ref: facts.ref })),
  });

/** A denounced person pushes nothing; an unvouched one only when the mode says so. */
const trust: Rule = (facts) =>
  Option.flatMap(handleOf(facts.pusher), (handle) => {
    const standing = standingOf(facts.policy, handle);

    if (standing === "denounced") {
      return Option.some<Refusal>(new Denounced({}));
    }

    return standing === "unknown" && facts.policy.vouch.mode !== "bansOnly"
      ? Option.some(new NotVouched({}))
      : Option.none();
  });

/** The rules for a push to a claim's fork, in order. */
const claimFork = (
  facts: PushFacts,
  fork: Data.TaggedEnum.Value<PushTarget, "ClaimFork">
): Option.Option<Refusal> => {
  const open = Option.filter(
    facts.ask,
    (ask) =>
      ask.project === fork.project &&
      ask.id === fork.ask &&
      ask.state !== "closed"
  );

  if (Option.isNone(open)) {
    return Option.some(new NoAsk({}));
  }

  // The fork is named for its claimant, who must hold the ask's claim.
  const held = Option.filter(
    facts.claim,
    (claim) =>
      claim.ask === fork.ask &&
      claim.state !== "released" &&
      claim.state !== "answered" &&
      sameHandle(claim.claimant, fork.claimant) &&
      isPusher(facts, claim.claimant)
  );

  if (Option.isNone(held)) {
    return Option.some(NotClaimed.of(fork.ask));
  }

  if (held.value.state === "lapsed") {
    return Option.some(ClaimLapsed.of(fork.ask));
  }

  // A landing may lower the cap after the pusher claimed.
  const cap = facts.policy.caps.claimsPerPerson;

  return facts.claimsHeld > cap
    ? Option.some(new CapReached({ cap }))
    : Option.none();
};

const claims: Rule = (facts) =>
  PushTarget.$is("ClaimFork")(facts.target)
    ? claimFork(facts, facts.target)
    : Option.none();

const rules: readonly Rule[] = [directPush, trust, claims];

/** Parse: the first rule the push breaks, or nothing. */
export const parse: Stage<never> = {
  accumulate: false,
  name: "parse",
  run: (facts) =>
    Effect.succeed(
      Option.toArray(Array.findFirst(rules, (rule) => rule(facts)))
    ),
};
