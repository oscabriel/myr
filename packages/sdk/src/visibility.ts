/**
 * The config folder's `visibility.ts`: a project's layers, its held-back
 * checks, how content flows between audiences, how long a narrowing waits,
 * and who may set write-only env values. And a layer's own manifest
 * (`layer.ts` in the layer repo's config folder), which alone names the
 * held-back checks' paths, each with the clause it enforces.
 *
 * Every builder returns plain data, checked against protocol's schema at the
 * call, so a mistake fails where it is written. The public file names areas,
 * kinds and rules only: what a `sealed` layer discloses.
 */
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

/** Who a rule names, as config writes it: `deciders`, or handles without `@`. */
export type MembersInput = typeof Members.Encoded;

/** The project's deciders, whoever they are at the landed commit. */
export const deciders = "deciders" satisfies MembersInput;

/**
 * A layer as a builder states it: everything but its name, which is its key
 * in `visibility({ layers })`, and its repo, which the platform makes.
 */
export type LayerDefinition = Omit<typeof Layer.Encoded, "name" | "repo">;

/** What a layer holds: one kind or more. */
export type LayerHolds = readonly [LayerKind, ...LayerKind[]];

/** A layer, as `layer()` takes it. */
export interface LayerConfig<Holds extends LayerHolds = LayerHolds> {
  /** Who may read it. Default `"maintainers"`, the deciders' audience. */
  readonly audience?: Audience;
  /** What people outside its audience learn about what it holds. */
  readonly disclose: Disclosure;
  readonly holds: Holds;
  /** Who may clone it. */
  readonly readers?: MembersInput;
  /** Why it exists, in public. */
  readonly reason: string;
  /**
   * How long each kind it holds may stay unreleased: `{ experiment: "30 days" }`.
   * The protocol keeps one sunset a layer, so the layer takes the soonest.
   */
  readonly sunset?: Readonly<Partial<Record<Holds[number], Days>>>;
  /** Who may push to it. */
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

/**
 * Declares a layer: a separate repo holding one audience's files, overlaid
 * on main only where that audience may read. Its paths stay in the layer.
 */
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

/**
 * Held-back checks as the public file states them: their areas by name and
 * code glob, never a check's path or name. `Area` is the areas' names, so a
 * layer's manifest can be held to them (`AreaOf`).
 */
export type SealedChecksDefinition<Area extends string = string> = Omit<
  SealedChecksEncoded,
  "areas"
> & { readonly areas: Readonly<Record<Area, string>> };

const sealedChecksOf = checked(SealedChecks);

/**
 * Declares the held-back checks: the layer holding them, each area's name
 * and the code it guards, how often an answer may fail them, and when a new
 * check joins the suite. An answer is judged by the suite pinned at its
 * claim; a failure tells it one bit per area, and the suite is committed to
 * in public by a salted SHA-256 Merkle root.
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

/** How content moves between audiences, as data. */
export type FlowsDefinition = VisibilityPolicyEncoded["flows"];

const flowsOf = checked(VisibilityPolicy.fields.flows);

/** The flow rules. */
export const flows = {
  /**
   * Nothing moves from a layer into a wider audience but a credited
   * release, by the people named. Default release: the deciders.
   */
  noWriteDown: (options?: {
    readonly release?: MembersInput;
  }): FlowsDefinition =>
    flowsOf({ noWriteDown: true, release: options?.release ?? deciders }),
};

/** A project's `visibility.ts`, as `visibility()` takes it. */
export interface VisibilityConfig<Area extends string = string> {
  /** Held-back checks: `sealedChecks({ areas })`. */
  readonly checks?: SealedChecksDefinition<Area>;
  /** Who may set a write-only env value. Default the deciders. */
  readonly env?: { readonly setters: MembersInput };
  /** Default `flows.noWriteDown()`. */
  readonly flows?: FlowsDefinition;
  /** The project's layers, by name. */
  readonly layers?: Readonly<Record<string, LayerDefinition>>;
  /** How long a change that narrows visibility waits before it lands. Default `"7 days"`. */
  readonly notice?: { readonly narrowing: Days };
}

/** A visibility file's default export: the policy it states, as data. */
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

/**
 * Declares a project's visibility: the default export of the config
 * folder's `visibility.ts`. A project without one is Open.
 */
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

/** One held-back check as its layer's manifest lists it. */
export type SealedCheckInput<Area extends string = string> = Omit<
  typeof SealedCheck.Encoded,
  "area"
> & { readonly area: Area };

/** A layer manifest's default export, as data. */
export type LayerManifestDefinition = typeof LayerManifest.Encoded;

const manifestOf = checked(LayerManifest);

/**
 * Declares a layer's manifest: the default export of `layer.ts` in the
 * layer repo's config folder. Each held-back check's path, its area, the
 * clause of an ask or a doc it enforces, and its author; and the commits a
 * new check must fail on before it is admitted.
 */
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
