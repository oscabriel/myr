// The ledger (`infra/created.jsonl`) is the allow-list: a name it doesn't hold
// is never selected, whatever it is called. A stage's namespaces, the seeded
// examples, kept imports (each with every fork) and `witness` never are.
// Each deletion is written to the ledger at once, so a cut run resumes.
import type { RepoHost } from "@repo/artifacts/repo-host";
import { RepoName } from "@repo/protocol/ids";
import { Console, Context, DateTime, Effect, Option, Schema } from "effect";
import type { FileSystem, PlatformError } from "effect";

import { readLedger, recordDeleted } from "../created.ts";
import type { Created } from "../created.ts";
import { notRecording } from "../recording.ts";
import type { RecordingInProgress } from "../recording.ts";
import { declaredStage, resources, stages as declared } from "../stages.ts";
import type { Stage } from "../stages.ts";

export interface Listed {
  readonly kind: "namespace" | "repo";
  readonly name: string;
  readonly namespace?: string;
}

const witness = "witness";

const examples = ["datekit", "burrow"] as const;

const seeded = [...examples, "datekit--maintainers"] as const;

export const protectedNames = (stages: readonly Stage[]): ReadonlySet<string> =>
  new Set([
    witness,
    ...seeded,
    ...stages.flatMap((stage) => {
      const { layers, projects } = resources(stage);

      return [projects, layers];
    }),
  ]);

const keyOf = (item: {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
}) => JSON.stringify([item.kind, item.namespace ?? "", item.name]);

const ofProject = (name: string, kept: string) =>
  name === kept || name.startsWith(`${kept}--`);

interface Scope {
  readonly ledger: readonly Created[];
  readonly stages: readonly Stage[];
  readonly keep?: readonly string[];
}

const importsOf = (ledger: readonly Created[]): ReadonlySet<string> =>
  new Set(ledger.flatMap(({ by, name }) => (by === "import" ? [name] : [])));

const deletable = (
  entry: Created,
  guarded: ReadonlySet<string>,
  imported: ReadonlySet<string>
) =>
  !guarded.has(entry.name) &&
  !examples.some((example) => ofProject(entry.name, example)) &&
  ![...imported].some((kept) => ofProject(entry.name, kept)) &&
  (entry.kind === "namespace" ||
    (entry.kind === "repo" &&
      entry.namespace !== undefined &&
      entry.namespace !== witness));

const candidatesOf = (scope: Scope): readonly Created[] => {
  const guarded = protectedNames([...declared, ...scope.stages]);
  const imported = importsOf(scope.ledger);

  return scope.ledger.filter(
    (entry) =>
      entry.deletedAt === undefined &&
      scope.stages.some((stage) => stage === entry.stage) &&
      deletable(entry, guarded, imported) &&
      !(scope.keep ?? []).some((kept) => ofProject(entry.name, kept))
  );
};

// Repos newest first, so a fork goes before its source; namespaces last, since
// Artifacts deletes only an empty one.
export const teardownPlan = (
  input: Scope & { readonly listed: readonly Listed[] }
): readonly Listed[] => {
  const present = new Map(input.listed.map((item) => [keyOf(item), item]));

  const chosen = new Map(
    candidatesOf(input).flatMap((entry) => {
      const item = present.get(keyOf(entry));

      return item === undefined ? [] : [[keyOf(item), item] as const];
    })
  );

  const newestFirst = [...chosen.values()].toReversed();

  return [
    ...newestFirst.filter(({ kind }) => kind === "repo"),
    ...newestFirst.filter(({ kind }) => kind === "namespace"),
  ];
};

export class TeardownAccount extends Context.Service<
  TeardownAccount,
  {
    readonly repos: (namespace: string) => Effect.Effect<RepoHost["Service"]>;
    readonly namespaceExists: (name: string) => Effect.Effect<boolean>;
    readonly removeNamespace: (name: string) => Effect.Effect<boolean>;
  }
>()("infra/TeardownAccount") {}

export class TeardownUsage extends Schema.TaggedError<TeardownUsage>()(
  "TeardownUsage",
  { given: Schema.String }
) {
  override get message() {
    return `${this.given} is not understood: bun infra/teardown.ts [--stage <declared stage>] [--keep <project>]… [--apply]`;
  }
}

interface Options {
  readonly apply: boolean;
  readonly stage: Option.Option<Stage>;
  readonly keep: readonly string[];
}

const optionsOf = (
  argv: readonly string[]
): Effect.Effect<Options, TeardownUsage> =>
  Effect.gen(function* () {
    const keep: string[] = [];
    let apply = false;
    let stage = Option.none<Stage>();

    for (let at = 0; at < argv.length; at += 1) {
      const flag = argv[at] ?? "";

      const value = Option.filter(
        Option.fromNullishOr(argv[at + 1]),
        (given) => given.length > 0 && !given.startsWith("--")
      );

      if (flag === "--apply") {
        apply = true;
      } else if (flag === "--stage" || flag === "--keep") {
        if (Option.isNone(value)) {
          return yield* new TeardownUsage({ given: flag });
        }

        if (flag === "--keep") {
          keep.push(value.value);
        } else {
          stage = declaredStage(value.value);

          if (Option.isNone(stage)) {
            return yield* new TeardownUsage({ given: value.value });
          }
        }

        at += 1;
      } else {
        return yield* new TeardownUsage({ given: flag });
      }
    }

    return { apply, keep, stage };
  });

const shown = (item: Listed | Created) =>
  `${item.kind} ${item.namespace === undefined ? item.name : `${item.namespace}/${item.name}`}`;

const repoName = Schema.decodeUnknownOption(RepoName);

const hostOf = (item: Listed) =>
  Effect.gen(function* () {
    const account = yield* TeardownAccount;

    const namespace = yield* Effect.fromNullishOr(item.namespace).pipe(
      Effect.catch(() => Effect.die(`${item.name} names no namespace`))
    );

    return yield* account.repos(namespace);
  });

const probe = (entry: Created) =>
  Effect.gen(function* () {
    const account = yield* TeardownAccount;

    const item: Listed =
      entry.namespace === undefined
        ? {
            kind: entry.kind === "namespace" ? "namespace" : "repo",
            name: entry.name,
          }
        : { kind: "repo", name: entry.name, namespace: entry.namespace };

    if (item.kind === "namespace") {
      return (yield* account.namespaceExists(item.name))
        ? Option.some(item)
        : Option.none<Listed>();
    }

    // A name no repo can have is no repo there.
    const name = repoName(item.name);

    if (Option.isNone(name)) {
      return Option.none<Listed>();
    }

    const host = yield* hostOf(item);

    return yield* host.remote(name.value).pipe(
      Effect.as(Option.some(item)),
      Effect.catchTag("RepoNotFound", () =>
        Effect.succeed(Option.none<Listed>())
      )
    );
  });

const remove = (item: Listed) =>
  Effect.gen(function* () {
    const account = yield* TeardownAccount;

    if (item.kind === "namespace") {
      return yield* account.removeNamespace(item.name);
    }

    const host = yield* hostOf(item);

    const name = yield* Effect.fromOption(repoName(item.name)).pipe(
      Effect.catch(() => Effect.die(`${item.name} is no repo name`))
    );

    return yield* host.remove(name);
  });

const ledgerStages = (ledger: readonly Created[]): readonly Stage[] => [
  ...new Set(
    ledger.flatMap((entry) => Option.toArray(declaredStage(entry.stage)))
  ),
];

const onStage = (ledger: readonly Created[], stage: Stage, options: Options) =>
  Effect.gen(function* () {
    const scope = { keep: options.keep, ledger, stages: [stage] };
    const entries = ledger.filter((entry) => entry.stage === stage);
    const candidates = candidatesOf(scope);

    const unique = [
      ...new Map(candidates.map((entry) => [keyOf(entry), entry])).values(),
    ];

    const listed = (yield* Effect.forEach(unique, probe, {
      concurrency: 8,
    })).flatMap(Option.toArray);

    const plan = teardownPlan({ ...scope, listed });
    const there = new Set(listed.map(keyOf));
    const live = entries.filter(({ deletedAt }) => deletedAt === undefined);
    const chosen = new Set(candidates.map(keyOf));
    const guarded = protectedNames([...declared, stage]);
    const imported = importsOf(ledger);

    const kept = live.filter(
      (entry) =>
        deletable(entry, guarded, imported) &&
        options.keep.some((name) => ofProject(entry.name, name))
    );

    // Each kept import once, though a `--tags` backfill records its repo again.
    const keptImports = [
      ...new Map(
        live.flatMap((entry) =>
          entry.by === "import" ? [[keyOf(entry), entry] as const] : []
        )
      ).values(),
    ];

    const never = live.filter(
      (entry) =>
        entry.kind !== "project" &&
        !chosen.has(keyOf(entry)) &&
        !kept.includes(entry) &&
        entry.by !== "import"
    );

    const projects = live.flatMap(({ by, kind, name }) =>
      kind === "project" && by !== "import" ? [name] : []
    );

    yield* Console.log(
      `teardown on ${stage}: ${entries.length} ledger entries, ${plan.length} to delete`
    );

    yield* Effect.forEach(
      [
        ...plan.map((item) => `  delete ${shown(item)}`),
        ...unique.flatMap((entry) =>
          there.has(keyOf(entry)) ? [] : [`  gone already: ${shown(entry)}`]
        ),
        ...kept.map((entry) => `  kept by --keep: ${shown(entry)}`),
        ...keptImports.map((entry) => `  kept import: ${shown(entry)}`),
        ...never.map((entry) => `  never selectable: ${shown(entry)}`),
        ...(projects.length === 0
          ? []
          : [
              `  kept: ${projects.length} project${projects.length === 1 ? "" : "s"} (${projects.join(", ")}): each one's Durable Object and front-page row stay`,
            ]),
      ],
      (line) => Console.log(line),
      { discard: true }
    );

    if (!options.apply) {
      return 0;
    }

    const deleted = yield* Effect.forEach(plan, (item) =>
      Effect.gen(function* () {
        if (!(yield* remove(item))) {
          yield* Console.log(`gone already: ${shown(item)}`);

          return false;
        }

        const at = yield* DateTime.now;

        yield* Effect.forEach(
          live.filter((entry) => keyOf(entry) === keyOf(item)),
          (entry) => recordDeleted(entry, at),
          { discard: true }
        );

        yield* Console.log(`deleted ${shown(item)}`);

        return true;
      })
    );

    const count = deleted.filter(Boolean).length;

    yield* Console.log(
      `deleted ${count} of ${plan.length}, each marked deleted in the ledger`
    );

    return count;
  });

// `--apply` is refused while `infra/.recording` exists, before anything else is read.
export const teardown = (
  argv: readonly string[]
): Effect.Effect<
  void,
  | TeardownUsage
  | RecordingInProgress
  | PlatformError.PlatformError
  | Schema.SchemaError,
  TeardownAccount | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (argv.includes("--apply")) {
      yield* notRecording;
    }

    const options = yield* optionsOf(argv);
    const ledger = yield* readLedger;

    const stages = Option.match(options.stage, {
      onNone: () => ledgerStages(ledger),
      onSome: (stage) => [stage],
    });

    yield* Effect.forEach(stages, (stage) => onStage(ledger, stage, options), {
      discard: true,
    });

    if (!options.apply) {
      yield* Console.log(
        "dry run: nothing deleted; --apply deletes exactly this plan"
      );
    }
  });
