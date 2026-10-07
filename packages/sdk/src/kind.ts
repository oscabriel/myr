/**
 * Ask kinds and the asks made from them: what the config folder's
 * `asks/<id>.ask.ts` exports by default.
 */
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

/** An ask kind as data: what a project's policy lists. */
export type AskKindInput = typeof AskKind.Encoded;

type AskInputEncoded = typeof AskInput.Encoded;

/**
 * An ask as its file states it: everything but its id and file, which come
 * from where the file sits, and who asked, which the platform knows.
 */
export type AskStated = Omit<AskInputEncoded, "askedBy" | "file" | "id">;

/**
 * An ask file's default export: the ask as its file states it, carrying its
 * kind's function-valued rule beside the data.
 */
export type AskDefinition = AskStated & WithFunctions<KindFunctions>;

/**
 * The fields every ask states, whatever its kind: its brief (`want` and
 * the optional `current`, `outOfScope`, `terms`, `context`), who it is held
 * for (`reserve`, `mentor`), and its place in a migrate family (`parent`,
 * `blockedBy`).
 */
export type AskFields = typeof Brief.Encoded &
  Partial<Pick<AskInputEncoded, "blockedBy">> &
  Pick<AskInputEncoded, "mentor" | "parent" | "reserve">;

/** Whether an ask states its territory, or its kind derives it from the args. */
export type TerritoryMode = "derived" | "stated";

type TerritoryField<Mode extends TerritoryMode> = Mode extends "derived"
  ? { readonly territory?: TerritoryInput }
  : { readonly territory: TerritoryInput };

/**
 * A kind's args: config fields as Effect schemas that decode with no
 * services, `{ path: Schema.NonEmptyString }`.
 */
export type ArgFields = Readonly<
  Record<PropertyKey, Schema.Constraint & { readonly DecodingServices: never }>
>;

/**
 * What an ask of a kind takes: the kind's args, the fields every ask states,
 * and its territory unless the kind derives it.
 */
export type AskArgs<
  Args extends ArgFields,
  Mode extends TerritoryMode = "stated",
> = Schema.Struct.Encoded<Args> & AskFields & TerritoryField<Mode>;

/** Derives an ask's territory from its kind's args. */
export type DeriveTerritory<Args extends ArgFields> = (
  args: Schema.Struct.Type<Args>
) => TerritoryInput;

/**
 * An ask kind, as a maintainer declares it: a typed template for asks that
 * fixes the brief's args, the check kind, who may claim, and whether a
 * finish is required. Left out: claimers `"vouched"`, finish `"optional"`,
 * race 1, not one-way, strength `"assertion"`, and every ask needing its
 * want, check and territory.
 */
export interface KindDefinition<
  Args extends ArgFields,
  K extends CheckKind = CheckKind,
> {
  /** The args an ask of this kind takes, beyond the fields every ask states. */
  readonly args: Args;
  /** Builds an ask's check from its args; it must be of `checkKind`. */
  readonly check: (
    args: Schema.Struct.Type<Args>
  ) => CheckSpecInput<Capitalize<K>>;
  /** The check kind this kind's asks are judged by. */
  readonly checkKind: K;
  /** Who may claim an ask of this kind. */
  readonly claimers?: typeof ClaimRule.Encoded;
  /** Whether a decider's finish is never offered, optional, or required before landing. */
  readonly finish?: AskKindInput["finish"];
  /** The kind's name, as its asks and the policy name it: `fixBug`. */
  readonly name: string;
  /** Answers can't be undone by a later answer: judge changes, dependency changes. */
  readonly oneWay?: boolean;
  /** Whether a proposal for an ask of this kind opens without a decider. */
  readonly opensAlone?: OpensAlone;
  /** How many claims an ask takes at once; 1 is exclusive. */
  readonly race?: number;
  /** The brief's fields an ask of this kind must have. */
  readonly requires?: readonly BriefField[];
  /** How strong an ask's check must be: failing on main by an assertion, or also failing a null answer. */
  readonly strength?: AskKindInput["strength"];
  /** Derives an ask's territory from its args, so its asks need not state one. */
  readonly territory?: DeriveTerritory<Args>;
}

/**
 * An ask kind as the project lists it: its data, and its function-valued
 * rule beside it.
 */
export interface DeclaredKind extends WithFunctions<KindFunctions> {
  /** The ask kind as data. */
  readonly askKind: AskKindInput;
}

/**
 * A declared ask kind. List it in `project({ kinds })`, and make an ask file
 * with `ask`: `export default fixBug.ask({ want, repro, territory })`.
 */
export interface KindHandle<
  Args extends ArgFields,
  Mode extends TerritoryMode = "stated",
> extends DeclaredKind {
  /**
   * An ask of this kind, as its file states it. The args are checked at the
   * call, so a malformed ask fails with a Schema issue.
   */
  readonly ask: (input: AskArgs<Args, Mode>) => AskDefinition;
}

const askKindOf = checked(AskKind);

const territoryOf = Schema.decodeUnknownSync(Territory);

const encodeTerritory = Schema.encodeSync(Territory);

/**
 * Declares an ask kind: a typed template for asks, which fixes the brief's
 * args, the check kind, who may claim, and whether a finish is required.
 */
export interface KindBuilder {
  /** A kind that derives each ask's territory from its args, so its asks need not state one. */
  <const Args extends ArgFields, const K extends CheckKind>(
    definition: KindDefinition<Args, K> & {
      readonly territory: DeriveTerritory<Args>;
    }
  ): KindHandle<Args, "derived">;
  /** A kind whose asks each state their territory. */
  <const Args extends ArgFields, const K extends CheckKind>(
    definition: KindDefinition<Args, K>
  ): KindHandle<Args>;
}

/**
 * Declares an ask kind: a typed template for asks, which fixes the brief's
 * args, the check kind, who may claim, and whether a finish is required.
 * Its data is checked at the call, as an ask's args are, so a malformed
 * kind fails where it is written.
 * `kind({ name: "fixBug", args: { repro: Schema.NonEmptyString }, checkKind:
 * "redThenGreen", check: ({ repro }) => check.redThenGreen(repro) })`.
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

/** Where an ask file sits, and who asked: what the platform knows and the file doesn't. */
export interface AskOrigin {
  /** The person credited with deciding the change was worth making. */
  readonly askedBy: string;
  /** The ask file's path in the repo: `<config folder>/asks/<id>.ask.ts`. */
  readonly file: string;
}

const askSuffix = ".ask.ts";

/** An ask's id, from its file's name: `parse-iso-week.ask.ts` is `parse-iso-week`. */
const askIdOf = (file: string): string => {
  const name = file.slice(file.lastIndexOf("/") + 1);

  return name.endsWith(askSuffix) ? name.slice(0, -askSuffix.length) : name;
};

/**
 * An ask file's data, for the rules evaluator: the ask its file states, with
 * its id and file from where the file sits, and who asked.
 */
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

/**
 * The ask kinds a project gets without declaring any. Each is vouched-only
 * and exclusive; list the ones a project uses in `project({ kinds })`.
 */
export const kinds = {
  /**
   * Changes what judges answers (a check, lint or CI file), shown by a check
   * file that fails on main: one-way, and a decider finishes every answer.
   */
  changeJudge: kind({
    args: path,
    check: (args) => check.redThenGreen(args.path),
    checkKind: "redThenGreen",
    finish: "required",
    name: "changeJudge",
    oneWay: true,
  }),
  /**
   * A sentence and a check file that fails on main by an assertion; an
   * answer must pass it. A finish is optional.
   */
  fix: kind({
    args: path,
    check: (args) => check.redThenGreen(args.path),
    checkKind: "redThenGreen",
    name: "fix",
  }),
  /**
   * A lint rule's count in the territory goes to zero, as the project's own
   * lint command reports it. Mechanical, so never finished.
   */
  lintToZero: kind({
    args: { command: Schema.NonEmptyString, rule: Schema.NonEmptyString },
    check: (args) => check.lintToZero(args.rule, args.command),
    checkKind: "lintToZero",
    finish: "never",
    name: "lintToZero",
  }),
  /**
   * Every use of one name moves to another: the parent of a migrate family,
   * whose steps answer it package by package. Never finished.
   */
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
