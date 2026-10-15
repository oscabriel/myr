import type { Policy } from "@repo/protocol/domain/policy";
import { sameHandle } from "@repo/protocol/ids";
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

const handleOf = (pusher: Principal): Option.Option<Handle> =>
  Principal.guards.Person(pusher) ? Option.some(pusher.handle) : Option.none();

const isPusher = (facts: PushFacts, handle: Handle) =>
  Option.exists(handleOf(facts.pusher), (pusher) => sameHandle(pusher, handle));

/**
 * A denouncement on any line wins, as the project service reads the file.
 * Maintainers vouch for others, so a maintainer with no line is vouched.
 */
const standingOf = (policy: Policy, handle: Handle) => {
  const lines = policy.vouches.filter((vouch) =>
    sameHandle(vouch.handle, handle)
  );

  if (lines.some(({ denounced }) => denounced)) {
    return "denounced";
  }

  if (lines.length > 0) {
    return "vouched";
  }

  const decides = policy.deciders.some((decider) =>
    decider.handles.some((each) => sameHandle(each, handle))
  );

  return decides ? "vouched" : "unknown";
};

const branchPrefix = "refs/heads/";

/**
 * Main moves only by a landing: no push reaches a canonical ref.
 * A fork takes branches only: its notes and merge refs are the platform's
 * to write and a tag is no one's, so a push of any ref outside `refs/heads/`
 * is a direct push, whoever makes it. A working fork takes pushes from its
 * owner only, and a layer's repo takes none here: its writers arrive with
 * the visibility cartridge.
 */
const directPush: Rule = (facts) => {
  const refused = Option.some(new DirectPush({ ref: facts.ref }));
  const onBranch = facts.ref.startsWith(branchPrefix);

  return PushTarget.$match(facts.target, {
    Canonical: () => refused,
    ClaimFork: () => (onBranch ? Option.none() : refused),
    Layer: () => refused,
    WorkingFork: ({ owner }) =>
      onBranch && isPusher(facts, owner) ? Option.none() : refused,
  });
};

/**
 * A denounced person pushes nothing. An unvouched one pushes to a working
 * fork (a maintainer's own change) only when the mode says so.
 * A push to a claim's fork is not judged on the vouch again: the claim
 * already passed the kind's `claimers` rule, which may admit a person no one
 * vouched for (an `anyone` kind, a record, a newcomer's mentor).
 */
const trust: Rule = (facts) =>
  Option.flatMap(handleOf(facts.pusher), (handle) => {
    const standing = standingOf(facts.policy, handle);

    if (standing === "denounced") {
      return Option.some<Refusal>(new Denounced({}));
    }

    return standing === "unknown" &&
      facts.policy.vouch.mode !== "bansOnly" &&
      !PushTarget.$is("ClaimFork")(facts.target)
      ? Option.some(new NotVouched({}))
      : Option.none();
  });

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

export const parse: Stage<never> = {
  accumulate: false,
  name: "parse",
  run: (facts) =>
    Effect.succeed(
      Option.toArray(Array.findFirst(rules, (rule) => rule(facts)))
    ),
};
