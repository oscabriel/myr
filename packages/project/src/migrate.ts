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

export const CallerCount = Schema.Struct({
  byModule: Schema.Record(Schema.String, NoneOrMore),
  total: NoneOrMore,
});

export type CallerCount = typeof CallerCount.Type;

export const callerCountOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(CallerCount)
);

export const sameCount = (one: CallerCount, other: CallerCount): boolean =>
  one.total === other.total &&
  Array.dedupe([
    ...Object.keys(one.byModule),
    ...Object.keys(other.byModule),
  ]).every(
    (module) => (one.byModule[module] ?? 0) === (other.byModule[module] ?? 0)
  );

type MigrateCheck = Extract<CheckSpec, { readonly _tag: "Migrate" }>;

export interface FamilyFile {
  readonly content: string;
  readonly path: RepoPath;
}

export interface MigrateFamily {
  readonly parent: Ask;
  readonly children: Array.NonEmptyReadonlyArray<Ask>;
  readonly deleteChild: Ask;
  readonly files: Array.NonEmptyReadonlyArray<FamilyFile>;
  readonly ratchet: {
    readonly name: RatchetName;
    readonly baseline: number;
  };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

/** Never holds `--`, which repo names keep as their separator. */
export const childId = (parent: AskId, module: string): AskId =>
  AskId.make(`${parent}-${slug(module) || "root"}`);

export const deleteChildId = (parent: AskId): AskId =>
  AskId.make(`${parent}-delete`);

export const callersRatchet = (from: SymbolName): RatchetName =>
  RatchetName.make(`callers-${slug(from) || "name"}`);

export const remainingBlockers = (
  ask: Ask,
  asks: ReadonlyMap<AskId, Ask>
): readonly AskId[] =>
  ask.blockedBy.filter((blocker) => asks.get(blocker)?.state !== "closed");

export const familyClosed = (
  parent: AskId,
  asks: ReadonlyMap<AskId, Ask>
): boolean => {
  const members = [...asks.values()].filter((ask) => ask.parent === parent);

  return members.length > 0 && members.every(({ state }) => state === "closed");
};

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

/** In its module when the territory names one; in the modules it spans when some but not all; else everywhere. */
export const callersIn = (
  territory: Territory,
  counts: CallerCount,
  modules: readonly Territory[]
): number => {
  const within = modulesWithin(territory, modules);

  return within.length === 0 || within.length === modules.length
    ? counts.total
    : within.reduce(
        (sum, { module }) => sum + (counts.byModule[module] ?? 0),
        0
      );
};

export const callersSpec = (check: MigrateCheck): RatchetSpec => ({
  measure: RatchetMeasure.cases.Metric.make({
    command: check.count,
    path: JsonPath.make("$.total"),
  }),
  name: callersRatchet(check.from),
});

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
  `// A child of the migrate ask ${parent}, written by ${Brand.name} when it opened.`;

const sdk = quoted(`${Brand.cliPackage}/rules`);

const fields = (entries: readonly (readonly [string, string])[]) =>
  entries.map(([key, value]) => `  ${key}: ${value},`);

const childFile = (child: Ask, check: MigrateCheck, parent: AskId) => {
  const stated: (readonly [string, string])[] = [
    ["parent", quoted(parent)],
    ["territory", `territory.package(${quoted(child.territory.module)})`],
    ["want", quoted(child.brief.want)],
  ];

  const args: (readonly [string, string])[] = [
    ["count", quoted(check.count)],
    ["from", quoted(check.from)],
    ...(check.to === undefined ? [] : [["to", quoted(check.to)] as const]),
  ];

  if (child.kind === "migrate") {
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
    "const own = kind({",
    "  args: {},",
    `  check: () => check.migrate({ ${args.map(([key, value]) => `${key}: ${value}`).join(", ")} }),`,
    `  checkKind: "migrate",`,
    `  name: ${quoted(child.kind)},`,
    "});",
    "",
    "export default own.ask({",
    ...fields(stated),
    "});",
    "",
  ].join("\n");
};

/** The sdk has no `symbolAbsent` builder, so the file makes its own kind whose check is the name gone. */
const deleteFile = (child: Ask, check: MigrateCheck, parent: AskId) =>
  [
    header(parent),
    `import { kind } from ${sdk};`,
    "",
    "const own = kind({",
    "  args: {},",
    `  check: () => ({ _tag: "SymbolAbsent", count: ${quoted(check.count)}, symbol: ${quoted(check.from)} }),`,
    `  checkKind: "symbolAbsent",`,
    `  name: ${quoted(child.kind)},`,
    "});",
    "",
    "export default own.ask({",
    ...fields([
      ["blockedBy", JSON.stringify(child.blockedBy)],
      ["parent", quoted(parent)],
      ["territory", JSON.stringify(child.territory)],
      ["want", quoted(child.brief.want)],
    ]),
    "});",
    "",
  ].join("\n");

const callersOf = (count: number) =>
  count === 1 ? "1 caller" : `${count} callers`;

const childWant = (module: string, count: number, check: MigrateCheck) =>
  check.to === undefined
    ? `${module}: ${callersOf(count)} of ${check.from} to remove`
    : `${module}: ${callersOf(count)} of ${check.from} → ${check.to}`;

/** `None` for a non-migrate ask, or when fewer than two modules have callers: a split of one is the ask itself. */
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

  const member = (
    id: AskId,
    own: Pick<Ask, "blockedBy" | "brief" | "check" | "state" | "territory">
  ): Ask => ({
    ...parent,
    ...own,
    file: fileOf(id),
    id,
    parent: parent.id,
  });

  const called = modulesWithin(parent.territory, input.modules).flatMap(
    (module) => {
      const count = counts.byModule[module.module] ?? 0;

      return count > 0
        ? [
            member(childId(parent.id, module.module), {
              blockedBy: [],
              brief: { want: childWant(module.module, count, check) },
              check,
              state: "open",
              territory: module,
            }),
          ]
        : [];
    }
  );

  const [first, second, ...rest] = called;

  if (first === undefined || second === undefined) {
    return Option.none();
  }

  const children = Array.make(first, second, ...rest);
  const childIds = children.map(({ id }) => id);
  const deleteId = deleteChildId(parent.id);

  const deleteChild = member(deleteId, {
    blockedBy: childIds,
    brief: { want: `Delete ${check.from}: nothing calls it any more` },
    check: CheckSpec.cases.SymbolAbsent.make({
      count: check.count satisfies Command,
      symbol: check.from,
    }),
    state: "waitingOnParent",
    territory: parent.territory,
  });

  return Option.some({
    children,
    deleteChild,
    files: Array.append(
      Array.map(children, (each) => ({
        content: childFile(each, check, parent.id),
        path: each.file,
      })),
      {
        content: deleteFile(deleteChild, check, parent.id),
        path: deleteChild.file,
      }
    ),
    parent: {
      ...parent,
      blockedBy: Array.dedupe([...parent.blockedBy, ...childIds, deleteId]),
    },
    ratchet: { baseline: counts.total, name: callersRatchet(check.from) },
  });
};
