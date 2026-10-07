import { Schema } from "effect";

import { Handle, KindName } from "../ids.ts";
import { Strength } from "./check.ts";

/** A field of an ask's brief that its kind can require. */
export const BriefField = Schema.Literals([
  "want",
  "current",
  "check",
  "territory",
  "outOfScope",
  "terms",
  "context",
]);

export type BriefField = typeof BriefField.Type;

/** The check kind an ask kind's asks are judged by. */
export const CheckKind = Schema.Literals([
  "redThenGreen",
  "lintToZero",
  "ratchet",
  "migrate",
  "symbolAbsent",
]);

export type CheckKind = typeof CheckKind.Type;

/**
 * Who may claim an ask of a kind: anyone vouched for, anyone, a person whose
 * record in an area reaches a count, or a newcomer with a mentor.
 */
export const ClaimRule = Schema.Union([
  Schema.Literals(["vouched", "anyone"]),
  Schema.Struct({
    record: Schema.Struct({ area: Schema.NonEmptyString, atLeast: Schema.Int }),
  }),
  Schema.Struct({ newcomer: Schema.Struct({ mentor: Handle }) }),
]);

export type ClaimRule = typeof ClaimRule.Type;

/**
 * An ask kind: the typed template a project's asks are made from. It fixes
 * the brief's fields, the check kind, who may claim, and whether a finish is
 * required.
 */
export const AskKind = Schema.Struct({
  checkKind: CheckKind,
  claimers: ClaimRule,
  /** Whether a decider's finish is never offered, optional, or required before landing. */
  finish: Schema.Literals(["never", "optional", "required"]),
  name: KindName,
  /** Answers can't be undone by a later answer: judge changes and dependency changes. */
  oneWay: Schema.Boolean,
  /** How many claims an ask takes at once; 1 is exclusive (ADR 0008). */
  race: Schema.Int,
  /** The brief's fields an ask of this kind must have. */
  requires: Schema.Array(BriefField),
  strength: Strength,
});

export type AskKind = typeof AskKind.Type;
