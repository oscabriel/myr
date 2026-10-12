import type { Brief } from "@repo/protocol/domain/ask";
import { AskKind } from "@repo/protocol/domain/kind";
import type {
  BriefField,
  CheckKind,
  ClaimRule,
} from "@repo/protocol/domain/kind";
import type { AskInput } from "@repo/protocol/domain/policy";
import { Territory } from "@repo/protocol/domain/territory";
import { Schema, Struct } from "effect";

import { check } from "./check.ts";
import type { CheckSpecInput } from "./check.ts";
import { checked } from "./checked.ts";
import { withFunctions } from "./functions.ts";
import type { KindFunctions, OpensAlone, WithFunctions } from "./functions.ts";
import type { TerritoryInput } from "./territory.ts";

export type AskKindInput = typeof AskKind.Encoded;

type AskInputEncoded = typeof AskInput.Encoded;

export type AskStated = Omit<AskInputEncoded, "askedBy" | "file" | "id">;

export type AskDefinition = AskStated & WithFunctions<KindFunctions>;

export type AskFields = typeof Brief.Encoded &
  Partial<Pick<AskInputEncoded, "blockedBy">> &
  Pick<AskInputEncoded, "mentor" | "parent" | "reserve">;

export type TerritoryMode = "derived" | "stated";

type TerritoryField<Mode extends TerritoryMode> = Mode extends "derived"
  ? { readonly territory?: TerritoryInput }
  : { readonly territory: TerritoryInput };

export type ArgFields = Readonly<
  Record<PropertyKey, Schema.Constraint & { readonly DecodingServices: never }>
>;

export type AskArgs<
  Args extends ArgFields,
  Mode extends TerritoryMode = "stated",
> = Schema.Struct.Encoded<Args> & AskFields & TerritoryField<Mode>;

export type DeriveTerritory<Args extends ArgFields> = (
  args: Schema.Struct.Type<Args>
) => TerritoryInput;

export interface KindDefinition<
  Args extends ArgFields,
  K extends CheckKind = CheckKind,
> {
  readonly args: Args;
  /** Builds an ask's check from its args; it must be of `checkKind`. */
  readonly check: (
    args: Schema.Struct.Type<Args>
  ) => CheckSpecInput<Capitalize<K>>;
  readonly checkKind: K;
  readonly claimers?: typeof ClaimRule.Encoded;
  /** Whether a maintainer's finish is never offered, optional, or required before landing. */
  readonly finish?: AskKindInput["finish"];
  readonly name: string;
  /** Answers can't be undone by a later answer: judge changes, dependency changes. */
  readonly oneWay?: boolean;
  /** Whether a proposal for an ask of this kind opens without a maintainer. */
  readonly opensAlone?: OpensAlone;
  /** How many claims an ask takes at once; 1 is exclusive. */
  readonly race?: number;
  readonly requires?: readonly BriefField[];
  /** How strong an ask's check must be: failing on main by an assertion, or also failing a null answer. */
  readonly strength?: AskKindInput["strength"];
  readonly territory?: DeriveTerritory<Args>;
}

export interface DeclaredKind extends WithFunctions<KindFunctions> {
  readonly askKind: AskKindInput;
}

export interface KindHandle<
  Args extends ArgFields,
  Mode extends TerritoryMode = "stated",
> extends DeclaredKind {
  /** An ask of this kind; the args are checked at the call, so a malformed ask fails with a Schema issue. */
  readonly ask: (input: AskArgs<Args, Mode>) => AskDefinition;
}

const askKindOf = checked(AskKind);

const territoryOf = Schema.decodeUnknownSync(Territory);

const encodeTerritory = Schema.encodeSync(Territory);

export interface KindBuilder {
  <const Args extends ArgFields, const K extends CheckKind>(
    definition: KindDefinition<Args, K> & {
      readonly territory: DeriveTerritory<Args>;
    }
  ): KindHandle<Args, "derived">;
  <const Args extends ArgFields, const K extends CheckKind>(
    definition: KindDefinition<Args, K>
  ): KindHandle<Args>;
}

/**
 * Declares an ask kind, checked at the call: `kind({ name: "fixBug", args: {
 * repro: Schema.NonEmptyString }, checkKind: "redThenGreen", check: ({ repro })
 * => check.redThenGreen(repro) })`.
 */
export const kind: KindBuilder = <
  const Args extends ArgFields,
  const K extends CheckKind,
>(
  definition: KindDefinition<Args, K>
): KindHandle<Args, TerritoryMode> => {
  const decodeArgs = Schema.decodeSync(Schema.Struct(definition.args));
  const functions: KindFunctions = { opensAlone: definition.opensAlone };

  const ask = (input: AskArgs<Args, TerritoryMode>): AskDefinition => {
    const args = decodeArgs(input);
    const fields: AskFields & { readonly territory?: TerritoryInput } = input;

    const stated: AskStated = {
      ...Struct.pick(fields, ["mentor", "parent", "reserve"]),
      blockedBy: fields.blockedBy ?? [],
      brief: Struct.pick(fields, [
        "context",
        "current",
        "outOfScope",
        "terms",
        "want",
      ]),
      check: definition.check(args),
      kind: definition.name,
      // A territory the ask leaves out comes from its kind; with neither,
      // this fails at the call, as malformed args do.
      territory: encodeTerritory(
        territoryOf(fields.territory ?? definition.territory?.(args))
      ),
    };

    return withFunctions(stated, functions);
  };

  return withFunctions(
    {
      ask,
      askKind: askKindOf({
        checkKind: definition.checkKind,
        claimers: definition.claimers ?? "vouched",
        finish: definition.finish ?? "optional",
        name: definition.name,
        oneWay: definition.oneWay ?? false,
        race: definition.race ?? 1,
        requires: definition.requires ?? ["want", "check", "territory"],
        strength: definition.strength ?? "assertion",
      }),
    },
    functions
  );
};

export interface AskOrigin {
  readonly askedBy: string;
  readonly file: string;
}

const askSuffix = ".ask.ts";

const askIdOf = (file: string): string => {
  const name = file.slice(file.lastIndexOf("/") + 1);

  return name.endsWith(askSuffix) ? name.slice(0, -askSuffix.length) : name;
};

export const toAskInput = (
  definition: AskDefinition,
  origin: AskOrigin
): AskInputEncoded => ({
  ...definition,
  askedBy: origin.askedBy,
  file: origin.file,
  id: askIdOf(origin.file),
});

const path = { path: Schema.NonEmptyString };

/** The ask kinds a project gets without declaring any; list the ones it uses in `project({ kinds })`. */
export const kinds = {
  /** Changes what judges answers (a check, lint or CI file): one-way, and a maintainer finishes every answer. */
  changeJudge: kind({
    args: path,
    check: (args) => check.redThenGreen(args.path),
    checkKind: "redThenGreen",
    finish: "required",
    name: "changeJudge",
    oneWay: true,
  }),
  /** A sentence and a check file that fails on main by an assertion; an answer must pass it. */
  fix: kind({
    args: path,
    check: (args) => check.redThenGreen(args.path),
    checkKind: "redThenGreen",
    name: "fix",
  }),
  /** A lint rule's count in the territory goes to zero. Never finished. */
  lintToZero: kind({
    args: { command: Schema.NonEmptyString, rule: Schema.NonEmptyString },
    check: (args) => check.lintToZero(args.rule, args.command),
    checkKind: "lintToZero",
    finish: "never",
    name: "lintToZero",
  }),
  /** Every use of one name moves to another, package by package. Never finished. */
  migrate: kind({
    args: {
      count: Schema.NonEmptyString,
      from: Schema.NonEmptyString,
      to: Schema.optionalKey(Schema.NonEmptyString),
    },
    check: (args) => check.migrate(args),
    checkKind: "migrate",
    finish: "never",
    name: "migrate",
  }),
  /** A named ratchet goes down. Never finished. */
  ratchetDown: kind({
    args: { ratchet: Schema.NonEmptyString },
    check: (args) => check.ratchet.down(args.ratchet),
    checkKind: "ratchet",
    finish: "never",
    name: "ratchetDown",
  }),
};
