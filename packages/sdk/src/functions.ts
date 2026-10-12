import { Ask } from "@repo/protocol/domain/ask";
import { AskKind } from "@repo/protocol/domain/kind";
import { Territory } from "@repo/protocol/domain/territory";
import { Schema } from "effect";

// The domain's own schemas for a person's handle, a kind's name and a
// module, reached through the domain schemas that hold them, so facts decode
// to the same branded values the rest of the platform uses.
const Handle = Ask.fields.askedBy;

const KindName = AskKind.fields.name;

const Module = Territory.fields.module;

const LandingCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The rule sees these facts and nothing else: no clock, no network, no repo. */
export const ProposalFacts = Schema.Struct({
  kind: KindName,
  proposer: Handle,
  /** The proposer's landings in the territory that stayed unreverted. */
  record: LandingCount,
  territory: Module,
});

export type ProposalFacts = typeof ProposalFacts.Type;

/**
 * Whether a proposal opens its ask on its own, without a decider. Write one
 * only when the kind's data can't say it: `(p) => p.record >= 3`.
 */
export type OpensAlone = (proposal: ProposalFacts) => boolean;

export const ClaimantFacts = Schema.Struct({
  handle: Handle,
  kind: KindName,
  /** Their landings in the territory that stayed unreverted. */
  record: LandingCount,
  territory: Module,
  vouched: Schema.Boolean,
});

export type ClaimantFacts = typeof ClaimantFacts.Type;

/**
 * Whether a person may claim an ask, when the kinds' `claimers` data can't
 * say it: `(c) => c.vouched || c.record > 0`.
 */
export type Admit = (claimant: ClaimantFacts) => boolean;

export interface ProjectFunctions {
  readonly admit: Admit | undefined;
  readonly opensAlone: OpensAlone | undefined;
}

export interface KindFunctions {
  readonly opensAlone: OpensAlone | undefined;
}

/**
 * The key a definition keeps its functions under. It is a symbol and not
 * enumerable, so encoding, spreading or printing the data never meets them.
 */
export const Functions: unique symbol = Symbol.for("@repo/sdk/Functions");

export interface WithFunctions<F> {
  readonly [Functions]: F;
}

export const withFunctions = <A extends Readonly<Record<string, unknown>>, F>(
  data: A,
  functions: F
): A & WithFunctions<F> => {
  const carried = { ...data, [Functions]: functions };

  Object.defineProperty(carried, Functions, { enumerable: false });

  return carried;
};

/** For the rules evaluator: `functionsOf(definition).opensAlone?.(facts)`. */
export const functionsOf = <F>(definition: WithFunctions<F>): F =>
  definition[Functions];
