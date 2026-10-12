// The public file names areas, kinds and rules only: what a `sealed` layer
// discloses. Only a layer's own manifest names the held-back checks' paths.
import {
  Layer,
  LayerManifest,
  SealedChecks,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import type {
  Audience,
  Disclosure,
  LayerKind,
  Members,
  SealedCheck,
} from "@repo/protocol/domain/visibility";
import { Duration, Predicate, Schema, Struct } from "effect";

import { checked } from "./checked.ts";
import type { Days } from "./project.ts";

type VisibilityPolicyEncoded = typeof VisibilityPolicy.Encoded;

type SealedChecksEncoded = typeof SealedChecks.Encoded;

export type MembersInput = typeof Members.Encoded;

export const deciders = "deciders" satisfies MembersInput;

export type LayerDefinition = Omit<typeof Layer.Encoded, "name" | "repo">;

export type LayerHolds = readonly [LayerKind, ...LayerKind[]];

export interface LayerConfig<Holds extends LayerHolds = LayerHolds> {
  /** Who may read it. Default `"maintainers"`, the maintainers' audience. */
  readonly audience?: Audience;
  /** What people outside its audience learn about what it holds. */
  readonly disclose: Disclosure;
  readonly holds: Holds;
  readonly readers?: MembersInput;
  readonly reason: string;
  /**
   * How long each kind it holds may stay unreleased: `{ experiment: "30 days" }`.
   * The protocol keeps one sunset a layer, so the layer takes the soonest.
   */
  readonly sunset?: Readonly<Partial<Record<Holds[number], Days>>>;
  readonly writers?: MembersInput;
}

const LayerFields = Schema.Struct(Struct.omit(Layer.fields, ["name", "repo"]));

const layerOf = checked(LayerFields);

// The protocol keeps one sunset a layer: the soonest any kind it holds is due.
const sunsetOf = (sunset: Readonly<Partial<Record<string, Days>>>) => {
  const days = Object.values(sunset)
    .filter(Predicate.isNotUndefined)
    .map((each) => Duration.toDays(each));

  return days.length === 0 ? {} : { sunsetDays: Math.min(...days) };
};

/** Declares a layer: a separate repo holding one audience's files. Its paths stay in the layer. */
export const layer = <const Holds extends LayerHolds>(
  config: LayerConfig<Holds>
): LayerDefinition =>
  layerOf({
    audience: config.audience ?? "maintainers",
    disclose: config.disclose,
    holds: config.holds,
    readers: config.readers ?? deciders,
    reason: config.reason,
    writers: config.writers ?? deciders,
    ...sunsetOf(config.sunset ?? {}),
  });

/**
 * Declares an embargo: fixes held for the named readers, released within
 * `maxDays` and counted in public. Config only: nothing releases it yet.
 */
export const embargo = (config: {
  readonly disclose: "counted";
  readonly maxDays: number;
  readonly readers: MembersInput;
}): LayerDefinition =>
  layerOf({
    audience: "security",
    disclose: config.disclose,
    holds: ["fix"],
    maxDays: config.maxDays,
    readers: config.readers,
    reason: "Embargoed fixes, released with their advisory",
    writers: deciders,
  });

/**
 * Declares the personal layer: each person's own agent and tool
 * configuration, hidden, gating nothing. Config only.
 */
export const personal = (): LayerDefinition =>
  layerOf({
    audience: "personal",
    disclose: "hidden",
    holds: ["personal"],
    readers: deciders,
    reason:
      "Each person's own agent and tool configuration, for them and their agents only",
    writers: deciders,
  });

export type SealedChecksDefinition<Area extends string = string> = Omit<
  SealedChecksEncoded,
  "areas"
> & { readonly areas: Readonly<Record<Area, string>> };

const sealedChecksOf = checked(SealedChecks);

/**
 * Declares the held-back checks. An answer is judged by the suite pinned at
 * its claim; a failure tells it one bit per area, and the suite is committed
 * to in public by a salted SHA-256 Merkle root.
 */
export const sealedChecks = <
  const Areas extends Readonly<Record<string, string>>,
>(config: {
  readonly admit?: {
    readonly greenOnMainRuns?: number;
    readonly redOnKnownBadAtLeast?: number;
  };
  readonly areas: Areas;
  readonly attempts?: {
    readonly perClaim?: number;
    readonly perPersonPerAreaPerWeek?: number;
  };
  readonly canary?: boolean;
  /** The layer that holds the check files. Default `"maintainers"`. */
  readonly layer?: string;
}): SealedChecksDefinition<keyof Areas & string> => ({
  ...sealedChecksOf({
    admit: {
      greenOnMainRuns: config.admit?.greenOnMainRuns ?? 3,
      redOnKnownBadAtLeast: config.admit?.redOnKnownBadAtLeast ?? 1,
    },
    areas: config.areas,
    attempts: {
      perClaim: config.attempts?.perClaim ?? 3,
      perPersonPerAreaPerWeek: config.attempts?.perPersonPerAreaPerWeek ?? 10,
    },
    canary: config.canary ?? false,
    commit: "salted-sha256-merkle",
    layer: config.layer ?? "maintainers",
    pin: "claim",
    result: "area-bit",
  }),
  areas: config.areas,
});

export type FlowsDefinition = VisibilityPolicyEncoded["flows"];

const flowsOf = checked(VisibilityPolicy.fields.flows);

export const flows = {
  /**
   * Nothing moves from a layer into a wider audience but a credited
   * release, by the people named. Default release: the maintainers.
   */
  noWriteDown: (options?: {
    readonly release?: MembersInput;
  }): FlowsDefinition =>
    flowsOf({ noWriteDown: true, release: options?.release ?? deciders }),
};

export interface VisibilityConfig<Area extends string = string> {
  readonly checks?: SealedChecksDefinition<Area>;
  /** Who may set a write-only env value. Default the maintainers. */
  readonly env?: { readonly setters: MembersInput };
  /** Default `flows.noWriteDown()`. */
  readonly flows?: FlowsDefinition;
  readonly layers?: Readonly<Record<string, LayerDefinition>>;
  /** How long a change that narrows visibility waits before it lands. Default `"7 days"`. */
  readonly notice?: { readonly narrowing: Days };
}

export type VisibilityDefinition<Area extends string = string> = Omit<
  VisibilityPolicyEncoded,
  "checks"
> & { readonly checks?: SealedChecksDefinition<Area> };

// The held-back checks live in a layer the file declares, one that holds
// checks: a misspelt layer would leave a suite that nothing runs.
const policyOf = checked(
  VisibilityPolicy.check(
    Schema.makeFilter(({ checks, layers }) =>
      checks === undefined ||
      layers.some(
        (each) => each.name === checks.layer && each.holds.includes("checks")
      )
        ? undefined
        : {
            issue: `no declared layer "${checks.layer}" holds checks`,
            path: ["checks", "layer"],
          }
    )
  )
);

/** Declares a project's visibility: the default export of `visibility.ts`. A project without one is Open. */
export const visibility = <Area extends string = never>(
  config: VisibilityConfig<Area>
): VisibilityDefinition<Area> => {
  const { checks } = config;

  const policy: VisibilityPolicyEncoded = {
    env: { setters: config.env?.setters ?? deciders },
    flows: config.flows ?? flows.noWriteDown(),
    layers: Object.entries(config.layers ?? {}).map(([name, each]) => ({
      ...each,
      name,
    })),
    notice: {
      narrowingDays: Duration.toDays(config.notice?.narrowing ?? "7 days"),
    },
  };

  // Checked whole, so a key the schema doesn't name (a check's path) is
  // dropped. The held-back checks' areas, checked with the rest, come back
  // as the file wrote them, so they keep the names `AreaOf` reads.
  const { checks: suite, ...stated } = policyOf(
    checks === undefined ? policy : { ...policy, checks }
  );

  return checks === undefined || suite === undefined
    ? stated
    : { ...stated, checks: { ...suite, areas: checks.areas } };
};

/**
 * The areas a visibility file's (or a `sealedChecks`'s) held-back checks
 * guard, by name: `layerManifest<AreaOf<typeof policy>>(…)` holds each
 * check's area to them.
 */
export type AreaOf<Definition> =
  Definition extends SealedChecksDefinition<infer Area>
    ? Area
    : Definition extends VisibilityDefinition<infer Area>
      ? Area
      : never;

export type SealedCheckInput<Area extends string = string> = Omit<
  typeof SealedCheck.Encoded,
  "area"
> & { readonly area: Area };

export type LayerManifestDefinition = typeof LayerManifest.Encoded;

const manifestOf = checked(LayerManifest);

/** Declares a layer's manifest: the default export of `layer.ts` in the layer repo's config folder. */
export const layerManifest = <Area extends string>(config: {
  readonly checks: readonly SealedCheckInput<Area>[];
  readonly knownBad?: readonly string[];
  readonly layer: string;
}): LayerManifestDefinition =>
  manifestOf({
    checks: config.checks,
    knownBad: config.knownBad ?? [],
    layer: config.layer,
  });
