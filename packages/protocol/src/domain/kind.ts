import { Schema } from "effect";

import { Handle, KindName } from "../ids.ts";
import { Strength } from "./check.ts";
import { AtLeastOne, NoneOrMore } from "./common.ts";

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

export const CheckKind = Schema.Literals([
  "redThenGreen",
  "lintToZero",
  "ratchet",
  "migrate",
  "symbolAbsent",
]);

export type CheckKind = typeof CheckKind.Type;

export const ClaimRule = Schema.Union([
  Schema.Literals(["vouched", "anyone"]),
  Schema.Struct({
    record: Schema.Struct({ area: Schema.NonEmptyString, atLeast: NoneOrMore }),
  }),
  Schema.Struct({ newcomer: Schema.Struct({ mentor: Handle }) }),
]);

export type ClaimRule = typeof ClaimRule.Type;

export const AskKind = Schema.Struct({
  checkKind: CheckKind,
  claimers: ClaimRule,
  finish: Schema.Literals(["never", "optional", "required"]),
  name: KindName,
  oneWay: Schema.Boolean,
  /** How many claims an ask takes at once; 1 is exclusive. */
  race: AtLeastOne,
  requires: Schema.Array(BriefField),
  strength: Strength,
});

export type AskKind = typeof AskKind.Type;
