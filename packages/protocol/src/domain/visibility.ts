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
 * Who a rule names: the project's deciders, whoever they are at the landed
 * commit, or the people listed.
 */
export const Members = Schema.Union([
  Schema.Literal("deciders"),
  Schema.NonEmptyArray(Handle),
]);

export type Members = typeof Members.Type;

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
  /** Who may clone it. The sdk defaults it to the deciders; the wire always says. */
  readers: Members,
  reason: Schema.NonEmptyString,
  /** Its repo, `<project>--<layer>`; absent for a layer that is config only. */
  repo: Schema.optionalKey(RepoName),
  /** When its content is due for release. */
  sunsetDays: Schema.optionalKey(Schema.Int),
  /** Who may push to it. The sdk defaults it to the deciders; the wire always says. */
  writers: Members,
});

export type Layer = typeof Layer.Type;

/**
 * Each sealed area's name and the code it guards. A key that is no area
 * name is refused, not dropped: a `Schema.Record` keyed by `AreaName` alone
 * would drop it silently, and with it the area's checks.
 */
const Areas = Schema.Record(Schema.String, Schema.NonEmptyString)
  .check(Schema.isPropertyNames(AreaName))
  .pipe(Schema.decodeTo(Schema.Record(AreaName, Glob)));

/**
 * Held-back checks, as the public config folder declares them: which layer
 * holds them, the areas they guard by name and code glob, and the rules
 * they are run by. Their paths and names stay in the layer's own manifest.
 */
export const SealedChecks = Schema.Struct({
  /**
   * When a new check joins the suite: after this many green runs on main
   * and at least this many red runs on known-bad trees. Absent: at once.
   */
  admit: Schema.optionalKey(
    Schema.Struct({
      greenOnMainRuns: AtLeastOne,
      redOnKnownBadAtLeast: AtLeastOne,
    })
  ),
  /** Each area's name, public, and the code it guards: `{ export: "src/export/**" }`. */
  areas: Areas,
  /** How often an answer may fail them: per claim, and per person, area and week. */
  attempts: Schema.Struct({
    perClaim: AtLeastOne,
    perPersonPerAreaPerWeek: AtLeastOne,
  }),
  /** A canary string in every sealed file, so a leak can be found. */
  canary: Schema.Boolean,
  /** How the suite is committed to in public: a salted SHA-256 Merkle root. */
  commit: Schema.Literal("salted-sha256-merkle"),
  /** The layer that holds the check files. */
  layer: LayerName,
  /** An answer is judged by the suite as it stood when its claim opened. */
  pin: Schema.Literal("claim"),
  /** What a failure tells the answerer: one bit per area, never a name or output. */
  result: Schema.Literal("area-bit"),
});

export type SealedChecks = typeof SealedChecks.Type;

/**
 * A project's `visibility.ts`, evaluated: its layers, its held-back checks,
 * how content flows between them, how long a narrowing waits, and who may
 * set write-only env values. A project without one is Open.
 */
export const VisibilityPolicy = Schema.Struct({
  checks: Schema.optionalKey(SealedChecks),
  /** Who may set a write-only value. The sdk defaults it to the deciders. */
  env: Schema.Struct({ setters: Members }),
  flows: Schema.Struct({
    /** Nothing moves from a layer into a wider audience but a credited release. */
    noWriteDown: Schema.Boolean,
    /** Who may release. */
    release: Members,
  }),
  layers: Schema.Array(Layer),
  /** How many days a change that narrows visibility waits before it lands; `0` lands it at once. */
  notice: Schema.Struct({ narrowingDays: NoneOrMore }),
});

export type VisibilityPolicy = typeof VisibilityPolicy.Type;

/**
 * One held-back check, as its layer's own manifest lists it: where it is,
 * the area it guards, the clause of an ask or a doc it enforces (a check
 * that cites none is `UnstatedRequirement`), and who wrote it.
 */
export const SealedCheck = Schema.Struct({
  area: AreaName,
  author: Handle,
  clause: Schema.Struct({
    /** The clause's words, quoted. */
    quote: Schema.NonEmptyString,
    /** The ask's id, or the doc's path and anchor. */
    ref: Schema.NonEmptyString,
    source: Schema.Literals(["ask", "doc"]),
  }),
  path: RepoPath,
});

export type SealedCheck = typeof SealedCheck.Type;

/**
 * The manifest inside a layer repo (`<config folder>/layer.ts` there,
 * evaluated like the public config): its checks' paths and names stay in
 * the layer, and its known-bad commits feed admission.
 */
export const LayerManifest = Schema.Struct({
  checks: Schema.Array(SealedCheck),
  /** Commits every new check must fail on before it is admitted. */
  knownBad: Schema.Array(CommitSha),
  layer: LayerName,
});

export type LayerManifest = typeof LayerManifest.Type;

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
