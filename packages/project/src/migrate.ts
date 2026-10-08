/**
 * A migrate ask's family (CAA §2.F): one ask that moves every use of a name
 * to another opens, when its callers sit in two or more of the project's
 * modules, as one step per module with callers, each with that module as
 * its territory and "no callers in this module" as its check, and a delete
 * step that waits on every step and checks the name is gone. The steps'
 * territories are disjoint, so their claims never overlap and their answers
 * re-merge cleanly through the serial landing queue; the parent closes when
 * its last step lands.
 *
 * Pure: the callers are counted by the project's own command (its stdout is
 * `CallerCount`), never by a scan here, and the service lands the family and
 * moves it after each landing.
 */
import { Brand } from "@repo/brand";
import { matchAny } from "@repo/gate/glob";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import type { RatchetSpec } from "@repo/protocol/domain/check";
import { JsonPath, NoneOrMore } from "@repo/protocol/domain/common";
import type { Command, SymbolName } from "@repo/protocol/domain/common";
import type { Territory } from "@repo/protocol/domain/territory";
import { AskId, RatchetName, RepoPath } from "@repo/protocol/ids";
import { Array, Option, Schema } from "effect";

/**
 * What a migrate ask's count command prints: every caller of the name, and
 * the callers in each module, by the module's name.
 */
export const CallerCount = Schema.Struct({
  byModule: Schema.Record(Schema.String, NoneOrMore),
  total: NoneOrMore,
});

export type CallerCount = typeof CallerCount.Type;

/** A count command's stdout, read as its `CallerCount`. */
export const callerCountOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(CallerCount)
);

/** Whether two counts are the same: the same total, and the same callers in every module. */
export const sameCount = (one: CallerCount, other: CallerCount): boolean =>
  one.total === other.total &&
  Array.dedupe([
    ...Object.keys(one.byModule),
    ...Object.keys(other.byModule),
  ]).every(
    (module) => (one.byModule[module] ?? 0) === (other.byModule[module] ?? 0)
  );

/** A migrate ask's check: the name it moves from, where to, and the command that counts callers. */
type MigrateCheck = Extract<CheckSpec, { readonly _tag: "Migrate" }>;

/** One file the family adds to the config folder. */
export interface FamilyFile {
  readonly content: string;
  readonly path: RepoPath;
}

/** A migrate ask split into its family, and what its opening lands. */
export interface MigrateFamily {
  /** The migrate ask, blocked by every step and the delete step. */
  readonly parent: Ask;
  /** One step per module with callers, in the policy's module order. */
  readonly children: Array.NonEmptyReadonlyArray<Ask>;
  /** The last step: the name is gone. Blocked by every step until they land. */
  readonly deleteChild: Ask;
  /** The steps' and the delete step's ask files, in that order. */
  readonly files: Array.NonEmptyReadonlyArray<FamilyFile>;
  /** The callers ratchet the opening records, at the counted total. */
  readonly ratchet: {
    readonly name: RatchetName;
    readonly baseline: number;
  };
}

/** `@burrow/http-kit` → `burrow-http-kit`: a name an ask id can carry. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

/**
 * The id of a family's step in `module`: `drop-legacy-fetch-p1`. It never
 * holds `--`, which repo names keep as their separator (spec §4.5).
 */
export const childId = (parent: AskId, module: string): AskId =>
  AskId.make(`${parent}-${slug(module) || "root"}`);

/** The id of a family's delete step: `drop-legacy-fetch-delete`. */
export const deleteChildId = (parent: AskId): AskId =>
  AskId.make(`${parent}-delete`);

/** The ratchet on a name's callers: `legacyFetch` → `callers-legacyfetch`. */
export const callersRatchet = (from: SymbolName): RatchetName =>
  RatchetName.make(`callers-${slug(from) || "name"}`);

/** What an ask still waits on: each ask it is blocked by that has not closed. */
export const remainingBlockers = (
  ask: Ask,
  asks: ReadonlyMap<AskId, Ask>
): readonly AskId[] =>
  ask.blockedBy.filter((blocker) => asks.get(blocker)?.state !== "closed");

/** Whether a family is done: it has steps, and every one has closed. */
export const familyClosed = (
  parent: AskId,
  asks: ReadonlyMap<AskId, Ask>
): boolean => {
  const members = [...asks.values()].filter((ask) => ask.parent === parent);

  return members.length > 0 && members.every(({ state }) => state === "closed");
};

/**
 * The modules a territory spans: the one it names, or every module whose
 * paths its globs all cover (`packages/**` covers `packages/p1/**`).
 */
export const modulesWithin = (
  territory: Territory,
  modules: readonly Territory[]
): readonly Territory[] => {
  const named = modules.filter(({ module }) => module === territory.module);

  return named.length > 0
    ? named
    : modules.filter(({ paths }) =>
        paths.every((glob) => matchAny(territory.paths, glob))
      );
};

/**
 * The callers an ask's own check counts: in its module, when its territory
 * names one; everywhere, when it spans the repo.
 */
export const callersIn = (
  territory: Territory,
  counts: CallerCount,
  modules: readonly Territory[]
): number =>
  modules.some(({ module }) => module === territory.module)
    ? (counts.byModule[territory.module] ?? 0)
    : counts.total;

/**
 * The ratchet a migrate ask's callers are counted by on every answer while
 * it is open: its count command's `total`, over the whole project.
 */
export const callersSpec = (check: MigrateCheck): RatchetSpec => ({
  measure: RatchetMeasure.cases.Metric.make({
    command: check.count,
    path: JsonPath.make("$.total"),
  }),
  name: callersRatchet(check.from),
});

/** The callers ratchets of every migrate ask still open, one per name. */
export const callersSpecs = (asks: Iterable<Ask>): readonly RatchetSpec[] =>
  Array.dedupeWith(
    [...asks].flatMap(({ check, state }) =>
      CheckSpec.guards.Migrate(check) && state !== "closed"
        ? [callersSpec(check)]
        : []
    ),
    (one, other) => one.name === other.name
  );

const quoted = (text: string) => JSON.stringify(text);

const header = (parent: AskId) =>
  `// A step of the migrate ask ${parent}, written by ${Brand.name} when it opened.`;

const sdk = quoted(`${Brand.cliPackage}/rules`);

/** An object literal's lines, each `key: value,`, indented by two. */
const fields = (entries: readonly (readonly [string, string])[]) =>
  entries.map(([key, value]) => `  ${key}: ${value},`);

/**
 * A step's file, through the sdk's `kinds.migrate` when the parent is of
 * that kind, else through a kind of the parent's name made in the file.
 */
const stepFile = (step: Ask, check: MigrateCheck, parent: AskId) => {
  const stated: (readonly [string, string])[] = [
    ["parent", quoted(parent)],
    ["territory", `territory.package(${quoted(step.territory.module)})`],
    ["want", quoted(step.brief.want)],
  ];

  const args: (readonly [string, string])[] = [
    ["count", quoted(check.count)],
    ["from", quoted(check.from)],
    ...(check.to === undefined ? [] : [["to", quoted(check.to)] as const]),
  ];

  if (step.kind === "migrate") {
    return [
      header(parent),
      `import { kinds, territory } from ${sdk};`,
      "",
      "export default kinds.migrate.ask({",
      ...fields(
        [...args, ...stated].toSorted(([a], [b]) => a.localeCompare(b))
      ),
      "});",
      "",
    ].join("\n");
  }

  return [
    header(parent),
    `import { check, kind, territory } from ${sdk};`,
    "",
    "const step = kind({",
    "  args: {},",
    `  check: () => check.migrate({ ${args.map(([key, value]) => `${key}: ${value}`).join(", ")} }),`,
    `  checkKind: "migrate",`,
    `  name: ${quoted(step.kind)},`,
    "});",
    "",
    "export default step.ask({",
    ...fields(stated),
    "});",
    "",
  ].join("\n");
};

/**
 * The delete step's file: the sdk has no `symbolAbsent` builder, so the
 * file makes a kind of the parent's name whose check is the name gone.
 */
const deleteFile = (step: Ask, check: MigrateCheck, parent: AskId) =>
  [
    header(parent),
    `import { kind } from ${sdk};`,
    "",
    "const step = kind({",
    "  args: {},",
    `  check: () => ({ _tag: "SymbolAbsent", count: ${quoted(check.count)}, symbol: ${quoted(check.from)} }),`,
    `  checkKind: "symbolAbsent",`,
    `  name: ${quoted(step.kind)},`,
    "});",
    "",
    "export default step.ask({",
    ...fields([
      ["blockedBy", JSON.stringify(step.blockedBy)],
      ["parent", quoted(parent)],
      ["territory", JSON.stringify(step.territory)],
      ["want", quoted(step.brief.want)],
    ]),
    "});",
    "",
  ].join("\n");

const callersOf = (count: number) =>
  count === 1 ? "1 caller" : `${count} callers`;

/** A step's want: `p1: 5 callers of legacyFetch → http.get`. */
const stepWant = (module: string, count: number, check: MigrateCheck) =>
  check.to === undefined
    ? `${module}: ${callersOf(count)} of ${check.from} to remove`
    : `${module}: ${callersOf(count)} of ${check.from} → ${check.to}`;

/**
 * Splits a migrate ask into its family: a step for each module of its
 * territory that has callers, in the policy's module order, and a delete
 * step blocked by all of them, each asked by the parent's asker and held
 * as the parent is held. `None` when the ask is no migrate ask, or fewer
 * than two of its modules have callers: a split of one is the ask itself.
 */
export const splitFamily = (input: {
  readonly parent: Ask;
  readonly counts: CallerCount;
  readonly modules: readonly Territory[];
  readonly configDir: string;
}): Option.Option<MigrateFamily> => {
  const { counts, parent } = input;
  const { check } = parent;

  if (!CheckSpec.guards.Migrate(check)) {
    return Option.none();
  }

  const fileOf = (id: AskId) =>
    RepoPath.make(`${input.configDir}/asks/${id}.ask.ts`);

  const step = (
    id: AskId,
    own: Pick<Ask, "blockedBy" | "brief" | "check" | "state" | "territory">
  ): Ask => ({
    ...parent,
    ...own,
    file: fileOf(id),
    id,
    parent: parent.id,
  });

  const children = modulesWithin(parent.territory, input.modules).flatMap(
    (module) => {
      const count = counts.byModule[module.module] ?? 0;

      return count > 0
        ? [
            step(childId(parent.id, module.module), {
              blockedBy: [],
              brief: { want: stepWant(module.module, count, check) },
              check,
              state: "open",
              territory: module,
            }),
          ]
        : [];
    }
  );

  const [first, second, ...rest] = children;

  if (first === undefined || second === undefined) {
    return Option.none();
  }

  const steps = Array.make(first, second, ...rest);
  const stepIds = steps.map(({ id }) => id);
  const deleteId = deleteChildId(parent.id);

  const deleteChild = step(deleteId, {
    blockedBy: stepIds,
    brief: { want: `Delete ${check.from}: nothing calls it any more` },
    check: CheckSpec.cases.SymbolAbsent.make({
      count: check.count satisfies Command,
      symbol: check.from,
    }),
    state: "waitingOnParent",
    territory: parent.territory,
  });

  return Option.some({
    children: steps,
    deleteChild,
    files: Array.append(
      Array.map(steps, (each) => ({
        content: stepFile(each, check, parent.id),
        path: each.file,
      })),
      {
        content: deleteFile(deleteChild, check, parent.id),
        path: deleteChild.file,
      }
    ),
    parent: {
      ...parent,
      blockedBy: Array.dedupe([...parent.blockedBy, ...stepIds, deleteId]),
    },
    ratchet: { baseline: counts.total, name: callersRatchet(check.from) },
  });
};
