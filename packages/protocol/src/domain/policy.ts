import { Brand } from "@repo/brand";
import { Effect, Schema, Struct } from "effect";

import { Handle, LandedSha, RepoPath } from "../ids.ts";
import { Ask } from "./ask.ts";
import { RatchetSpec } from "./check.ts";
import { AtLeastOne, Glob, NoneOrMore } from "./common.ts";
import { AskKind } from "./kind.ts";
import { RunBlock } from "./run.ts";
import { Territory } from "./territory.ts";
import { VisibilityPolicy } from "./visibility.ts";

/** Where a policy came from: the config folder, or the defaults when there is none. */
const Source = Schema.Literals(["config", "defaults"]);

/** How many decisions a decider takes a day, and how long one waits before its default. */
const Budget = Schema.Struct({
  decisionsPerDay: AtLeastOne,
  expireDays: AtLeastOne,
});

/** How many proposals and claims one person may hold open at once. */
const Caps = Schema.Struct({
  claimsPerPerson: AtLeastOne,
  /** `0` turns proposals off. */
  proposalsPerPerson: NoneOrMore,
});

/** How long a claim may go without a push before it is warned, and before it lapses. */
const Claims = Schema.Struct({
  lapseAfterMs: AtLeastOne,
  warnAfterMs: AtLeastOne,
});

/** When a landing starts to count on a person's record, and how long it counts. */
const RecordWindow = Schema.Struct({
  /** `0` counts a landing from the day it lands. */
  countsAfterDays: NoneOrMore,
  windowDays: AtLeastOne,
});

/**
 * What a vouch gates: claims and sealed answers (`forCode`), everything
 * (`all`), or nothing but denouncements (`bansOnly`); and the vouch file.
 */
const Vouch = Schema.Struct({
  file: RepoPath,
  mode: Schema.Literals(["forCode", "all", "bansOnly"]),
});

/** Whether landings carry `Assisted-by:` trailers for the agents people worked through. */
const Agents = Schema.Literals(["trailer", "none"]);

/** Which rules are functions, called on demand, rather than data. */
const Functions = Schema.Struct({
  admit: Schema.Boolean,
  opensAlone: Schema.Boolean,
});

/** The markers that count as weakening a check when an answer adds them. */
const Weakening = Schema.Struct({
  markers: Schema.Array(Schema.NonEmptyString),
});

/**
 * A project's evaluated config folder at one landed commit: the data its
 * rules come to. Function-valued rules are not in it; `functions` says which
 * exist, and they are called on demand.
 */
export const Policy = Schema.Struct({
  agents: Agents,
  /** Every ask file in the config folder at this commit. */
  asks: Schema.Array(Ask),
  at: LandedSha,
  budget: Budget,
  caps: Caps,
  claims: Claims,
  /** Who decides for which paths. */
  deciders: Schema.Array(
    Schema.Struct({ handles: Schema.NonEmptyArray(Handle), paths: Glob })
  ),
  functions: Functions,
  /** The judge closure: every file that decides what the checks do. */
  judge: Schema.Struct({
    paths: Schema.Array(Glob),
    /** Parts of files, as `<file>#<JSON pointer>`: `package.json#/scripts`. */
    pointers: Schema.Array(Schema.NonEmptyString),
  }),
  kinds: Schema.Array(AskKind),
  /** The territories answers may change, one per workspace package. */
  modules: Schema.Array(Territory),
  ratchets: Schema.Array(RatchetSpec),
  record: RecordWindow,
  run: RunBlock,
  source: Source,
  /** The project's layers and held-back checks; absent, it is Open. */
  visibility: Schema.optionalKey(VisibilityPolicy),
  vouch: Vouch,
  /** The vouch file's lines, parsed. */
  vouches: Schema.Array(
    Schema.Struct({
      denounced: Schema.Boolean,
      handle: Handle,
      note: Schema.optionalKey(Schema.String),
    })
  ),
  weakening: Weakening,
});

export type Policy = typeof Policy.Type;

/**
 * A policy as anyone may read it: the evaluated config folder without its
 * layers (the ledger shows those, and keeps the cartridge removable), its
 * function-valued rules and its asks (`listAsks` lists them).
 */
export const PublicPolicy = Policy.mapFields(
  Struct.omit(["asks", "functions", "visibility"])
);

export type PublicPolicy = typeof PublicPolicy.Type;

/**
 * An ask as its file in the config folder states it: the platform adds its
 * project, when and in which landing it opened, and its state.
 */
export const AskInput = Ask.mapFields(
  Struct.omit(["openedAt", "openedIn", "project", "state"])
);

export type AskInput = typeof AskInput.Type;

/**
 * The marker for a run block the platform finds in the project's own scripts
 * and CI files, instead of one the config folder writes out.
 */
export const FromCI = Schema.TaggedStruct("FromCI", {});

export type FromCI = typeof FromCI.Type;

/**
 * What the config folder evaluates to, before the platform fills in what it
 * knows: the landed commit, each ask's opening, the modules, the judge
 * closure and the vouch file's lines. Deciders may be `owners`, the person
 * who made the project. A key the folder leaves out takes its default.
 */
export const PolicyInput = Schema.Struct({
  agents: Agents.pipe(Schema.withDecodingDefaultKey(Effect.succeed("trailer"))),
  asks: Schema.Array(AskInput),
  budget: Budget.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({ decisionsPerDay: 5, expireDays: 14 })
    )
  ),
  caps: Caps.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({ claimsPerPerson: 3, proposalsPerPerson: 2 })
    )
  ),
  claims: Claims.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({ lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 })
    )
  ),
  deciders: Schema.Array(
    Schema.Struct({
      handles: Schema.Union([
        Schema.NonEmptyArray(Handle),
        Schema.Literal("owners"),
      ]),
      paths: Glob,
    })
  ),
  functions: Functions,
  kinds: Schema.Array(AskKind),
  ratchets: Schema.Array(RatchetSpec),
  record: RecordWindow.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({ countsAfterDays: 30, windowDays: 365 })
    )
  ),
  run: Schema.Union([RunBlock, FromCI]),
  source: Source,
  /** The config folder's `visibility.ts`, evaluated; absent, the project is Open. */
  visibility: Schema.optionalKey(VisibilityPolicy),
  vouch: Vouch.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({
        file: `${Brand.configDir}/vouched.td`,
        mode: "forCode" as const,
      })
    )
  ),
  weakening: Weakening,
});

export type PolicyInput = typeof PolicyInput.Type;
