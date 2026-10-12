import { Brand } from "@repo/brand";
import type { PolicyInput } from "@repo/protocol/domain/policy";
import { Duration, Predicate } from "effect";
import type { Types } from "effect";

import type { RatchetMeasure } from "./check.ts";
import { functionsOf, withFunctions } from "./functions.ts";
import type {
  Admit,
  OpensAlone,
  ProjectFunctions,
  WithFunctions,
} from "./functions.ts";
import { kinds as defaultKinds } from "./kind.ts";
import type { DeclaredKind } from "./kind.ts";
import { run as runFrom } from "./run.ts";
import type { RunInput } from "./run.ts";
import type { ModulesInput } from "./territory.ts";

type PolicyInputEncoded = typeof PolicyInput.Encoded;

/** A span of time as config writes it: `"2 hours"`, `"14 days"`. */
export type Span = `${number} ${
  | "day"
  | "days"
  | "hour"
  | "hours"
  | "millis"
  | "minute"
  | "minutes"
  | "second"
  | "seconds"
  | "week"
  | "weeks"}`;

export type Days = `${number} ${"day" | "days" | "week" | "weeks"}`;

/**
 * What a vouch gates: claims and sealed answers (`forCode`), proposals too
 * (`all`), or nothing but denouncements (`bansOnly`).
 */
export type VouchMode = PolicyInputEncoded["vouch"] extends
  | { readonly mode: infer M }
  | undefined
  ? M
  : never;

export interface RatchetEntry {
  readonly measure: RatchetMeasure;
  readonly territory?: string;
}

/** A project's process. Every key is optional; one left out takes its default (see `defaults`). */
export interface ProjectConfig {
  /** A trust rule in code: whether a person may claim an ask. Called on demand. */
  readonly admit?: Admit;
  /** Whether landings carry `Assisted-by:` trailers for the agents people worked through. Default `"trailer"`. */
  readonly agents?: PolicyInputEncoded["agents"];
  /** How many decisions a decider takes a day, and how long one waits before its default. Default 5 a day, `"14 days"`. */
  readonly budget?: {
    readonly decisionsPerDay: number;
    readonly expire: Days;
  };
  /** How many claims and open proposals one person may hold at once. Default 3 claims, 2 proposals. */
  readonly caps?: {
    readonly claimsPerPerson: number;
    readonly proposalsPerPerson: number;
  };
  /** How long a claim may go without a push before it is warned, and before it lapses. Default `"2 hours"`, `"24 hours"`. */
  readonly claims?: {
    readonly lapseAfter: Span;
    readonly warnAfter: Span;
  };
  /** Who decides for which paths: a glob, and its deciders' handles or `"owners"`. Default `{ "**": "owners" }`. */
  readonly deciders?: Readonly<
    Record<string, readonly [string, ...string[]] | "owners">
  >;
  /** The ask kinds the project's asks are made from. Default `[kinds.fix]`. */
  readonly kinds?: readonly DeclaredKind[];
  readonly modules?: ModulesInput;
  /** Ratchets, by name: `{ "no-explicit-any": check.ratchet.count("bun run lint --format json", { rule }) }`. */
  readonly ratchets?: Readonly<Record<string, RatchetEntry | RatchetMeasure>>;
  /** When a landing starts to count on a person's record, and for how long. Default `"30 days"`, `"365 days"`. */
  readonly record?: {
    readonly countsAfter: Days;
    readonly window: Days;
  };
  /** The project's own commands. Default `run.fromCI`. */
  readonly run?: RunInput;
  /** What a vouch gates, and the vouch file if not the config folder's `vouched.td`. Default `"forCode"`. */
  readonly vouch?:
    | VouchMode
    | { readonly file: string; readonly mode: VouchMode };
  /** Markers this project counts as weakening a check, beyond the platform's own list. */
  readonly weakening?: { readonly markers: readonly string[] };
}

export type ProjectDefinition = PolicyInputEncoded &
  WithFunctions<ProjectFunctions>;

type Settings = Pick<
  PolicyInputEncoded,
  "agents" | "budget" | "caps" | "claims" | "record" | "vouch"
>;

// Only what the config writes: a key it leaves out stays out, and decoding
// with `PolicyInput` gives it the default, so the defaults have one home.
const settingsOf = (config: ProjectConfig): Settings => {
  const settings: Types.Mutable<Settings> = {};

  if (config.agents !== undefined) {
    settings.agents = config.agents;
  }

  if (config.budget !== undefined) {
    settings.budget = {
      decisionsPerDay: config.budget.decisionsPerDay,
      expireDays: Duration.toDays(config.budget.expire),
    };
  }

  if (config.caps !== undefined) {
    settings.caps = config.caps;
  }

  if (config.claims !== undefined) {
    settings.claims = {
      lapseAfterMs: Duration.toMillis(config.claims.lapseAfter),
      warnAfterMs: Duration.toMillis(config.claims.warnAfter),
    };
  }

  if (config.record !== undefined) {
    settings.record = {
      countsAfterDays: Duration.toDays(config.record.countsAfter),
      windowDays: Duration.toDays(config.record.window),
    };
  }

  if (config.vouch !== undefined) {
    settings.vouch = Predicate.isString(config.vouch)
      ? { file: `${Brand.configDir}/vouched.td`, mode: config.vouch }
      : config.vouch;
  }

  return settings;
};

const ratchetsOf = (
  ratchets: NonNullable<ProjectConfig["ratchets"]>
): PolicyInputEncoded["ratchets"] =>
  Object.entries(ratchets).map(([name, entry]) =>
    "measure" in entry ? { ...entry, name } : { measure: entry, name }
  );

// One `opensAlone` for the project: it asks the proposal's kind, and a kind
// without the rule says no.
const opensAloneOf = (
  declared: readonly DeclaredKind[]
): OpensAlone | undefined => {
  const rules = new Map(
    declared.flatMap((each) => {
      const rule = functionsOf(each).opensAlone;

      return rule === undefined ? [] : [[each.askKind.name, rule] as const];
    })
  );

  return rules.size === 0
    ? undefined
    : (proposal) => rules.get(proposal.kind)?.(proposal) ?? false;
};

const define = (
  config: ProjectConfig,
  source: PolicyInputEncoded["source"]
): ProjectDefinition => {
  const declared = config.kinds ?? [defaultKinds.fix];

  const functions: ProjectFunctions = {
    admit: config.admit,
    opensAlone: opensAloneOf(declared),
  };

  return withFunctions(
    {
      ...settingsOf(config),
      asks: [],
      deciders: Object.entries(config.deciders ?? { "**": "owners" }).map(
        ([paths, handles]) => ({ handles, paths })
      ),
      functions: {
        admit: functions.admit !== undefined,
        opensAlone: functions.opensAlone !== undefined,
      },
      kinds: declared.map((each) => each.askKind),
      ratchets: ratchetsOf(config.ratchets ?? {}),
      run: config.run ?? runFrom.fromCI,
      source,
      weakening: config.weakening ?? { markers: [] },
    },
    functions
  );
};

/** Declares a project's process: the default export of the config folder's `project.ts`. */
export const project = (config: ProjectConfig): ProjectDefinition =>
  define(config, "config");

export const defaults: ProjectDefinition = define({}, "defaults");

export const toPolicyInput = (
  definition: ProjectDefinition
): PolicyInputEncoded => ({ ...definition });
