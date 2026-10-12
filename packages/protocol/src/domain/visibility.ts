import { Schema } from "effect";

import {
  AreaName,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  LayerName,
  ProjectName,
  RepoName,
  RepoPath,
  SuiteRoot,
} from "../ids.ts";
import { Posture } from "../posture.ts";
import { AtLeastOne, Glob, NoneOrMore } from "./common.ts";

export const Audience = Schema.Literals([
  "public",
  "contributors",
  "claimants",
  "maintainers",
  "team",
  "security",
  "sponsors",
  "personal",
  "platform",
]);

export type Audience = typeof Audience.Type;

export const Disclosure = Schema.Literals([
  "public",
  "sealed",
  "counted",
  "declared",
  "hidden",
  "writeOnly",
]);

export type Disclosure = typeof Disclosure.Type;

export const LayerKind = Schema.Literals([
  "checks",
  "agent-config",
  "env",
  "experiment",
  "notes",
  "fix",
  "session",
  "personal",
  "attachment",
  "source",
]);

export type LayerKind = typeof LayerKind.Type;

export const Members = Schema.Union([
  Schema.Literal("deciders"),
  Schema.NonEmptyArray(Handle),
]);

export type Members = typeof Members.Type;

export const Layer = Schema.Struct({
  audience: Audience,
  disclose: Disclosure,
  holds: Schema.NonEmptyArray(LayerKind),
  maxDays: Schema.optionalKey(Schema.Int),
  name: LayerName,
  readers: Members,
  reason: Schema.NonEmptyString,
  repo: Schema.optionalKey(RepoName),
  sunsetDays: Schema.optionalKey(Schema.Int),
  writers: Members,
});

export type Layer = typeof Layer.Type;

// A key that is no area name is refused, not dropped: a `Schema.Record`
// keyed by `AreaName` would drop it silently, and the area's checks with it.
const Areas = Schema.Record(Schema.String, Schema.NonEmptyString)
  .check(Schema.isPropertyNames(AreaName))
  .pipe(Schema.decodeTo(Schema.Record(AreaName, Glob)));

/** Held-back checks as the public config declares them; their paths and names stay in the layer. */
export const SealedChecks = Schema.Struct({
  admit: Schema.optionalKey(
    Schema.Struct({
      greenOnMainRuns: AtLeastOne,
      redOnKnownBadAtLeast: AtLeastOne,
    })
  ),
  areas: Areas,
  attempts: Schema.Struct({
    perClaim: AtLeastOne,
    perPersonPerAreaPerWeek: AtLeastOne,
  }),
  canary: Schema.Boolean,
  commit: Schema.Literal("salted-sha256-merkle"),
  layer: LayerName,
  pin: Schema.Literal("claim"),
  result: Schema.Literal("area-bit"),
});

export type SealedChecks = typeof SealedChecks.Type;

export const VisibilityPolicy = Schema.Struct({
  checks: Schema.optionalKey(SealedChecks),
  env: Schema.Struct({ setters: Members }),
  flows: Schema.Struct({
    noWriteDown: Schema.Boolean,
    release: Members,
  }),
  layers: Schema.Array(Layer),
  notice: Schema.Struct({ narrowingDays: NoneOrMore }),
});

export type VisibilityPolicy = typeof VisibilityPolicy.Type;

export const SealedCheck = Schema.Struct({
  area: AreaName,
  author: Handle,
  clause: Schema.Struct({
    quote: Schema.NonEmptyString,
    ref: Schema.NonEmptyString,
    source: Schema.Literals(["ask", "doc"]),
  }),
  path: RepoPath,
});

export type SealedCheck = typeof SealedCheck.Type;

export const LayerManifest = Schema.Struct({
  checks: Schema.Array(SealedCheck),
  knownBad: Schema.Array(CommitSha),
  layer: LayerName,
});

export type LayerManifest = typeof LayerManifest.Type;

/** A value set is recorded by who and when, never by the value. */
export const LedgerEntry = Schema.TaggedUnion({
  Admitted: {
    area: AreaName,
    at: Schema.DateTimeUtcFromString,
    knownBadCaught: Schema.Int,
    mainRuns: Schema.Int,
    seq: Schema.Int,
    suite: SuiteRoot,
  },
  CommitmentPublished: {
    area: AreaName,
    at: Schema.DateTimeUtcFromString,
    authors: Schema.Int,
    checks: Schema.Int,
    seq: Schema.Int,
    suite: SuiteRoot,
  },
  CountChanged: {
    area: AreaName,
    at: Schema.DateTimeUtcFromString,
    count: Schema.Int,
    layer: LayerName,
    seq: Schema.Int,
  },
  LayerDeclared: {
    at: Schema.DateTimeUtcFromString,
    disclose: Disclosure,
    kinds: Schema.NonEmptyArray(LayerKind),
    layer: LayerName,
    seq: Schema.Int,
  },
  PostureChanged: {
    at: Schema.DateTimeUtcFromString,
    decision: DecisionId,
    from: Posture,
    seq: Schema.Int,
    to: Posture,
  },
  Released: {
    at: Schema.DateTimeUtcFromString,
    by: Handle,
    landing: LandedSha,
    layer: LayerName,
    paths: Schema.Int,
    seq: Schema.Int,
  },
  ValueSet: {
    at: Schema.DateTimeUtcFromString,
    by: Handle,
    key: EnvKey,
    seq: Schema.Int,
  },
});

export type LedgerEntry = typeof LedgerEntry.Type;

export const Ledger = Schema.Struct({
  entries: Schema.Array(LedgerEntry),
  layers: Schema.Array(Layer),
  posture: Posture,
  postureLabel: Schema.NonEmptyString,
  project: ProjectName,
});

export type Ledger = typeof Ledger.Type;
