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

const Source = Schema.Literals(["config", "defaults"]);

/** How long an undecided decision waits before it takes its default. */
const Decisions = Schema.Struct({
  expireDays: AtLeastOne,
});

const defaultDecisions = { expireDays: 14 };

/** Throttles on people nobody has vouched for; a vouched person and a maintainer are never held. */
const Caps = Schema.Struct({
  claimsPerPerson: AtLeastOne,
});

const Claims = Schema.Struct({
  lapseAfterMs: AtLeastOne,
  warnAfterMs: AtLeastOne,
});

const RecordWindow = Schema.Struct({
  /** `0` counts a landing from the day it lands. */
  countsAfterDays: NoneOrMore,
  windowDays: AtLeastOne,
});

const Vouch = Schema.Struct({
  file: RepoPath,
  mode: Schema.Literals(["forCode", "all", "bansOnly"]),
});

const Agents = Schema.Literals(["trailer", "none"]);

const Functions = Schema.Struct({
  admit: Schema.Boolean,
});

const Weakening = Schema.Struct({
  markers: Schema.Array(Schema.NonEmptyString),
});

export const Policy = Schema.Struct({
  agents: Agents,
  asks: Schema.Array(Ask),
  at: LandedSha,
  caps: Caps,
  claims: Claims,
  deciders: Schema.Array(
    Schema.Struct({ handles: Schema.NonEmptyArray(Handle), paths: Glob })
  ),
  // Defaulted here too: a policy kept as JSON before this key existed still reads.
  decisions: Decisions.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultDecisions))
  ),
  functions: Functions,
  judge: Schema.Struct({
    paths: Schema.Array(Glob),
    pointers: Schema.Array(Schema.NonEmptyString),
  }),
  kinds: Schema.Array(AskKind),
  modules: Schema.Array(Territory),
  ratchets: Schema.Array(RatchetSpec),
  record: RecordWindow,
  run: RunBlock,
  source: Source,
  visibility: Schema.optionalKey(VisibilityPolicy),
  vouch: Vouch,
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

// Without its layers: the ledger shows those, and keeps the cartridge removable.
export const PublicPolicy = Policy.mapFields(
  Struct.omit(["asks", "functions", "visibility"])
);

export type PublicPolicy = typeof PublicPolicy.Type;

// Lives here, beside the policy whose read names it: a module of its own
// would cost the root's preloaded bytes.
export const ImportSource = Schema.Struct({
  branch: Schema.optionalKey(Schema.NonEmptyString),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/u)),
});

export type ImportSource = typeof ImportSource.Type;

export const PolicyPending = Schema.Struct({
  at: LandedSha,
  reason: Schema.Literals(["noConfig", "configFailed"]),
});

export type PolicyPending = typeof PolicyPending.Type;

export const AskInput = Ask.mapFields(
  Struct.omit(["openedAt", "openedIn", "project", "state"])
);

export type AskInput = typeof AskInput.Type;

export const FromCI = Schema.TaggedStruct("FromCI", {});

export type FromCI = typeof FromCI.Type;

export const PolicyInput = Schema.Struct({
  agents: Agents.pipe(Schema.withDecodingDefaultKey(Effect.succeed("trailer"))),
  asks: Schema.Array(AskInput),
  caps: Caps.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ claimsPerPerson: 20 }))
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
  decisions: Decisions.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultDecisions))
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
