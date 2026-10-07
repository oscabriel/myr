import { Schema } from "effect";

import {
  AreaName,
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  LayerName,
  ProjectName,
  RepoName,
  SuiteRoot,
} from "../ids.ts";
import { Posture } from "../posture.ts";

/** Who may read a layer. */
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

/** What people outside a layer's audience learn about what it holds. */
export const Disclosure = Schema.Literals([
  "public",
  "sealed",
  "counted",
  "declared",
  "hidden",
  "writeOnly",
]);

export type Disclosure = typeof Disclosure.Type;

/** What a layer holds. */
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

/**
 * A layer: a separate repo holding one audience's files for a project,
 * overlaid on main's paths only where that audience may read.
 */
export const Layer = Schema.Struct({
  audience: Audience,
  disclose: Disclosure,
  holds: Schema.NonEmptyArray(LayerKind),
  /** The longest its content may stay unreleased. */
  maxDays: Schema.optionalKey(Schema.Int),
  name: LayerName,
  reason: Schema.NonEmptyString,
  /** Its repo, `<project>--<layer>`; absent for a layer that is config only. */
  repo: Schema.optionalKey(RepoName),
  /** When its content is due for release. */
  sunsetDays: Schema.optionalKey(Schema.Int),
});

export type Layer = typeof Layer.Type;

/**
 * One entry of a project's ledger, numbered in order. A value set is recorded
 * by who and when, never by the value.
 */
export const LedgerEntry = Schema.TaggedUnion({
  /** A held-back suite passed main enough times and caught a known-bad tree. */
  Admitted: {
    area: AreaName,
    at: Schema.DateTimeUtcFromString,
    knownBadCaught: Schema.Int,
    mainRuns: Schema.Int,
    seq: Schema.Int,
    suite: SuiteRoot,
  },
  /** A held-back suite's commitment, printed on every landing it judges. */
  CommitmentPublished: {
    area: AreaName,
    at: Schema.DateTimeUtcFromString,
    authors: Schema.Int,
    checks: Schema.Int,
    seq: Schema.Int,
    suite: SuiteRoot,
  },
  /** How many items a layer holds in an area. */
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
  /** A release: paths moved from a layer to main by a credited landing. */
  Released: {
    at: Schema.DateTimeUtcFromString,
    by: Handle,
    landing: LandedSha,
    layer: LayerName,
    paths: Schema.Int,
    seq: Schema.Int,
  },
  /** A decider set a write-only value. */
  ValueSet: {
    at: Schema.DateTimeUtcFromString,
    by: Handle,
    key: EnvKey,
    seq: Schema.Int,
  },
});

export type LedgerEntry = typeof LedgerEntry.Type;

/**
 * The ledger: the public, append-only record of a project's layers, counts,
 * commitments, releases and posture changes.
 */
export const Ledger = Schema.Struct({
  entries: Schema.Array(LedgerEntry),
  layers: Schema.Array(Layer),
  posture: Posture,
  /** The posture in words: `Open with sealed evidence`. */
  postureLabel: Schema.NonEmptyString,
  project: ProjectName,
});

export type Ledger = typeof Ledger.Type;
