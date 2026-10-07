/**
 * Function-valued rules: the few a project's process needs that data can't
 * say. A definition carries them beside its data, under a key that encoding
 * never meets, and says in its data which ones exist; the rules evaluator
 * calls them on demand, with facts the platform injects.
 */
import { Schema } from "effect";

/**
 * What an `opensAlone` rule is told about a proposal: who proposed it, for
 * which ask kind and territory, and the proposer's record there. The rule
 * sees these facts and nothing else: no clock, no network, no repo.
 */
export const ProposalFacts = Schema.Struct({
  /** The ask kind the proposed ask is made from. */
  kind: Schema.NonEmptyString,
  /** The person who made the proposal. */
  proposer: Schema.NonEmptyString,
  /** The proposer's landings in the territory that stayed unreverted. */
  record: Schema.Int,
  /** The proposed ask's territory, by module. */
  territory: Schema.NonEmptyString,
});

export type ProposalFacts = typeof ProposalFacts.Type;

/**
 * Whether a proposal opens its ask on its own, without a decider. Write one
 * only when the kind's data can't say it: `(p) => p.record >= 3`.
 */
export type OpensAlone = (proposal: ProposalFacts) => boolean;

/**
 * What an `admit` rule is told about a person who wants to claim an ask:
 * who they are, the ask's kind and territory, their record there, and
 * whether the vouch file vouches for them.
 */
export const ClaimantFacts = Schema.Struct({
  /** The person who wants to claim. */
  handle: Schema.NonEmptyString,
  /** The ask's kind. */
  kind: Schema.NonEmptyString,
  /** Their landings in the territory that stayed unreverted. */
  record: Schema.Int,
  /** The ask's territory, by module. */
  territory: Schema.NonEmptyString,
  /** Whether the vouch file vouches for them. */
  vouched: Schema.Boolean,
});

export type ClaimantFacts = typeof ClaimantFacts.Type;

/**
 * Whether a person may claim an ask, when the kinds' `claimers` data can't
 * say it: `(c) => c.vouched || c.record > 0`.
 */
export type Admit = (claimant: ClaimantFacts) => boolean;

/** A project's function-valued rules: absent ones are `undefined`. */
export interface ProjectFunctions {
  readonly admit: Admit | undefined;
  readonly opensAlone: OpensAlone | undefined;
}

/** An ask kind's function-valued rule, which its asks carry too. */
export interface KindFunctions {
  readonly opensAlone: OpensAlone | undefined;
}

/**
 * The key a definition keeps its functions under. It is a symbol and not
 * enumerable, so encoding, spreading or printing the data never meets them.
 */
export const Functions: unique symbol = Symbol.for("@repo/sdk/Functions");

/** Something that carries function-valued rules beside its data. */
export interface WithFunctions<F> {
  readonly [Functions]: F;
}

/**
 * Puts function-valued rules beside a copy of `data`, where encoding never
 * meets them.
 */
export const withFunctions = <A extends Readonly<Record<string, unknown>>, F>(
  data: A,
  functions: F
): A & WithFunctions<F> => {
  const carried = { ...data, [Functions]: functions };

  Object.defineProperty(carried, Functions, { enumerable: false });

  return carried;
};

/**
 * The function-valued rules a definition carries, for the rules evaluator
 * to call on demand: `functionsOf(definition).opensAlone?.(facts)`.
 */
export const functionsOf = <F>(definition: WithFunctions<F>): F =>
  definition[Functions];
