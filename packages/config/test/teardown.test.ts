/**
 * Teardown: `bun infra/teardown.ts` prints a plan, and only
 * `--apply` deletes it. The plan is the ledger's throwaways that the account
 * still lists, never a stage's own namespaces, never `witness`, never the
 * seeded examples, and never a name the ledger doesn't hold, whatever it is
 * called.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Console,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Path,
  Ref,
  Result,
} from "effect";

import {
  isRecorded,
  LedgerFile,
  readLedger,
  recordCreated,
  recordDeleted,
} from "../../../infra/created.ts";
import type { Created } from "../../../infra/created.ts";
import {
  protectedNames,
  teardown,
  TeardownAccount,
  teardownPlan,
  TeardownUsage,
} from "../../../infra/lib/teardown.ts";
import type { Listed } from "../../../infra/lib/teardown.ts";
import { LockFile, RecordingInProgress } from "../../../infra/recording.ts";
import { RepoHost } from "../../artifacts/src/repo-host.ts";
import { RepoHostMemory } from "../../artifacts/src/repo-host/memory.ts";
import { RepoName } from "../../protocol/src/ids.ts";

const dev = "dev-oscabriel";

const projects = "projects-dev-oscabriel";

const layers = "layers-dev-oscabriel";

/** One ledger line, made by `by` on the dev stage; a repo's names its namespace. */
const made = (
  by: Created["by"],
  kind: Created["kind"],
  name: string,
  namespace?: string
): Created => {
  const entry: Created = {
    at: DateTime.makeUnsafe("2026-10-08T16:00:00Z"),
    by,
    kind,
    name,
    stage: dev,
  };

  return namespace === undefined ? entry : { ...entry, namespace };
};

const repo = (name: string, namespace = projects): Listed => ({
  kind: "repo",
  name,
  namespace,
});

const namespace = (name: string): Listed => ({ kind: "namespace", name });

/** A smoke run's project and repos, and a `seed --as` swarm copy's. */
const ledger: readonly Created[] = [
  made("smoke", "project", "smoke-r1"),
  made("smoke", "repo", "smoke-r1", projects),
  made("smoke", "repo", "smoke-r1--parse-year--bram", projects),
  made("seed", "project", "burrow-swarm-1"),
  made("seed", "repo", "burrow-swarm-1", projects),
  made(
    "swarm",
    "repo",
    "burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol",
    projects
  ),
  made("seed", "repo", "datekit-805--maintainers", layers),
];

/** What the account lists: every ledger repo, and much that isn't the ledger's. */
const listed: readonly Listed[] = [
  repo("datekit"),
  repo("burrow"),
  repo("smoke-r1"),
  repo("smoke-r1--parse-year--bram"),
  repo("smoke-unrecorded"),
  repo("burrow-swarm-1"),
  repo("burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol"),
  repo("w3live-muyjz31t"),
  repo("datekit--maintainers", layers),
  repo("datekit-805--maintainers", layers),
  namespace(projects),
  namespace(layers),
  namespace("projects-demo"),
  namespace("layers-demo"),
  namespace("witness"),
];

/** Two imports of the preview repos, kept: each one's project and repo line. */
const imports: readonly Created[] = [
  made("import", "project", "anyhow"),
  made("import", "repo", "anyhow", projects),
  made("import", "project", "ky"),
  made("import", "repo", "ky", projects),
];

describe("the teardown plan", () => {
  it("never selects an import, nor a fork of one, even with every line in the ledger and the listing", () => {
    expect(
      teardownPlan({
        ledger: [
          ...imports,
          made("smoke", "repo", "anyhow--fix-backtrace--bram", projects),
          ...ledger,
        ],
        listed: [
          ...listed,
          repo("anyhow"),
          repo("ky"),
          repo("anyhow--fix-backtrace--bram"),
        ],
        stages: [dev],
      })
    ).toStrictEqual([
      repo("datekit-805--maintainers", layers),
      repo("burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol"),
      repo("burrow-swarm-1"),
      repo("smoke-r1--parse-year--bram"),
      repo("smoke-r1"),
    ]);
  });

  it("selects a smoke run's repos and a swarm copy's repos that are in both the ledger and the listing, forks before what they fork", () => {
    expect(teardownPlan({ ledger, listed, stages: [dev] })).toStrictEqual([
      repo("datekit-805--maintainers", layers),
      repo("burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol"),
      repo("burrow-swarm-1"),
      repo("smoke-r1--parse-year--bram"),
      repo("smoke-r1"),
    ]);
  });

  it("never selects witness, a stage's namespaces, the seeded examples or their forks, or a name absent from the ledger, even one that starts with smoke-", () => {
    const stageNames: readonly Created[] = [
      made("smoke", "namespace", "witness"),
      made("smoke", "repo", "smoke-r9", "witness"),
      made("smoke", "namespace", "projects-demo"),
      made("smoke", "namespace", "layers-demo"),
      made("smoke", "namespace", projects),
      made("smoke", "namespace", layers),
      made("seed", "repo", "datekit", projects),
      made("seed", "repo", "burrow", projects),
      made("seed", "repo", "datekit--maintainers", layers),
      made(
        "swarm",
        "repo",
        "burrow--drop-legacy-fetch-burrow-auth--wren",
        projects
      ),
      {
        ...made(
          "swarm",
          "repo",
          "burrow--drop-legacy-fetch-burrow-kit--marisol",
          "projects-demo"
        ),
        stage: "demo",
      },
      made("seed", "repo", "datekit--add-months-clamp--bram", projects),
    ];

    expect({
      everyStage: teardownPlan({
        ledger: stageNames,
        listed: [
          ...listed,
          repo("smoke-r9", "witness"),
          repo("burrow--drop-legacy-fetch-burrow-auth--wren"),
          repo(
            "burrow--drop-legacy-fetch-burrow-kit--marisol",
            "projects-demo"
          ),
          repo("datekit--add-months-clamp--bram"),
        ],
        stages: [dev, "demo"],
      }),
      unrecorded: teardownPlan({
        ledger: [],
        listed,
        stages: [dev, "demo"],
      }),
    }).toStrictEqual({ everyStage: [], unrecorded: [] });
  });

  it("treats a ledger entry the account no longer lists as already gone", () => {
    expect(
      teardownPlan({
        ledger,
        listed: listed.filter(({ name }) => !name.startsWith("smoke-")),
        stages: [dev],
      })
    ).toStrictEqual([
      repo("datekit-805--maintainers", layers),
      repo("burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol"),
      repo("burrow-swarm-1"),
    ]);
  });

  it("acts only on the stages named, and still guards every declared stage's namespaces", () => {
    const onDemo: Created = {
      ...made("smoke", "repo", "smoke-d1", "projects-demo"),
      stage: "demo",
    };

    const demoNamespace: Created = {
      ...made("smoke", "namespace", "projects-demo"),
      stage: dev,
    };

    expect({
      demo: teardownPlan({
        ledger: [onDemo],
        listed: [repo("smoke-d1", "projects-demo")],
        stages: ["demo"],
      }),
      dev: teardownPlan({
        ledger: [onDemo, demoNamespace],
        listed: [repo("smoke-d1", "projects-demo"), namespace("projects-demo")],
        stages: [dev],
      }),
    }).toStrictEqual({ demo: [repo("smoke-d1", "projects-demo")], dev: [] });
  });

  it("deletes a ledger namespace only after the repos in it", () => {
    expect(
      teardownPlan({
        ledger: [
          made("smoke", "namespace", "smoke-r2"),
          made("smoke", "repo", "smoke-r2", "smoke-r2"),
          made("smoke", "repo", "smoke-r2--parse-year--bram", "smoke-r2"),
        ],
        listed: [
          namespace("smoke-r2"),
          repo("smoke-r2", "smoke-r2"),
          repo("smoke-r2--parse-year--bram", "smoke-r2"),
        ],
        stages: [dev],
      })
    ).toStrictEqual([
      repo("smoke-r2--parse-year--bram", "smoke-r2"),
      repo("smoke-r2", "smoke-r2"),
      namespace("smoke-r2"),
    ]);
  });

  it("selects a repo the ledger holds only under the namespace it was made in", () => {
    expect(
      teardownPlan({
        ledger: [made("smoke", "repo", "smoke-r3", projects)],
        listed: [repo("smoke-r3", "projects-demo"), repo("smoke-r3", layers)],
        stages: [dev],
      })
    ).toStrictEqual([]);
  });
});

/** A fresh ledger file in a temp dir, for the scope of one test. */
const tempLedger = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "teardown-808-" });

  return path.join(dir, "created.jsonl");
});

describe("a deleted ledger entry", () => {
  it.live(
    "gains deletedAt from a deleted line appended after it, and its own line is never rewritten",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = yield* tempLedger;
        const smokeRepo = made("smoke", "repo", "smoke-r1", projects);
        const deletedAt = DateTime.makeUnsafe("2026-10-13T20:00:00Z");

        const read = yield* Effect.gen(function* () {
          yield* recordCreated(smokeRepo);
          yield* recordDeleted(smokeRepo, deletedAt);

          return yield* readLedger;
        }).pipe(Effect.provideService(LedgerFile, file));

        expect({
          lines: (yield* fs.readFileString(file)).split("\n"),
          read,
        }).toStrictEqual({
          lines: [
            '{"at":"2026-10-08T16:00:00.000Z","by":"smoke","kind":"repo","name":"smoke-r1","namespace":"projects-dev-oscabriel","stage":"dev-oscabriel"}',
            '{"deletedAt":"2026-10-13T20:00:00.000Z","kind":"repo","name":"smoke-r1","namespace":"projects-dev-oscabriel","stage":"dev-oscabriel"}',
            "",
          ],
          read: [{ ...smokeRepo, deletedAt }],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "is never planned again, while the same name made again after it is a new entry",
    () =>
      Effect.gen(function* () {
        const file = yield* tempLedger;
        const first = made("smoke", "repo", "smoke-r1", projects);

        const fork = made(
          "smoke",
          "repo",
          "smoke-r1--parse-year--bram",
          projects
        );

        const again = {
          ...first,
          at: DateTime.makeUnsafe("2026-10-14T09:00:00Z"),
        };

        const read = yield* Effect.gen(function* () {
          yield* recordCreated(first);
          yield* recordCreated(fork);
          yield* recordDeleted(
            first,
            DateTime.makeUnsafe("2026-10-13T20:00:00Z")
          );
          yield* recordDeleted(
            fork,
            DateTime.makeUnsafe("2026-10-13T20:00:01Z")
          );
          yield* recordCreated(again);

          return yield* readLedger;
        }).pipe(Effect.provideService(LedgerFile, file));

        expect({
          live: read.filter(({ deletedAt }) => deletedAt === undefined),
          plan: teardownPlan({
            ledger: read,
            listed: [repo("smoke-r1"), repo("smoke-r1--parse-year--bram")],
            stages: [dev],
          }),
        }).toStrictEqual({ live: [again], plan: [repo("smoke-r1")] });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("is no longer recorded, so a run that makes the same name again records it again", () => {
    const fork = made(
      "swarm",
      "repo",
      "burrow--drop-legacy-fetch-burrow-auth--wren",
      projects
    );

    const deletedAt = DateTime.makeUnsafe("2026-10-13T20:00:00Z");

    expect({
      deleted: isRecorded([{ ...fork, deletedAt }], fork),
      live: isRecorded([fork], fork),
      otherStage: isRecorded([fork], { ...fork, stage: "demo" }),
    }).toStrictEqual({ deleted: false, live: true, otherStage: false });
  });
});

describe("the protected names", () => {
  it("are witness and both namespaces of every stage named", () => {
    expect([...protectedNames([dev, "demo"])].toSorted()).toStrictEqual([
      "burrow",
      "datekit",
      "datekit--maintainers",
      "layers-demo",
      "layers-dev-oscabriel",
      "projects-demo",
      "projects-dev-oscabriel",
      "witness",
    ]);
  });
});

/**
 * The account in memory: each namespace a memory `RepoHost` holding `repos`.
 * A namespace it doesn't hold, `witness` among them, dies when read.
 */
const memoryAccount = (repos: Readonly<Record<string, readonly string[]>>) =>
  Effect.gen(function* () {
    const read = yield* Ref.make<readonly string[]>([]);

    const hosts = new Map(
      yield* Effect.forEach(Object.entries(repos), ([space, names]) =>
        Effect.gen(function* () {
          const host = Context.get(
            yield* Layer.build(Layer.fresh(RepoHostMemory)),
            RepoHost
          );

          yield* Effect.forEach(names, (name) =>
            host.create(RepoName.make(name)).pipe(Effect.orDie)
          );

          return [space, host] as const;
        })
      )
    );

    const hostOf = (space: string) =>
      Ref.update(read, (all) => [...all, space]).pipe(
        Effect.andThen(
          Effect.fromNullishOr(hosts.get(space)).pipe(
            Effect.catch(() => Effect.die(`${space} was read`))
          )
        )
      );

    /** Of `names`, those the namespace still holds. */
    const standing = (space: string, names: readonly string[]) =>
      Effect.gen(function* () {
        const host = yield* Effect.fromNullishOr(hosts.get(space)).pipe(
          Effect.orDie
        );

        return yield* Effect.filter(names, (name) =>
          host.remote(RepoName.make(name)).pipe(
            Effect.as(true),
            Effect.catchTag("RepoNotFound", () => Effect.succeed(false))
          )
        );
      });

    return {
      account: TeardownAccount.of({
        namespaceExists: (name) => Effect.succeed(hosts.has(name)),
        removeNamespace: (name) => Effect.die(`${name} was deleted`),
        repos: hostOf,
      }),
      read: Ref.get(read),
      standing,
    };
  });

/** A temp root with a ledger written from `entries` and no recording lock. */
const tempRoot = (entries: readonly Created[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "teardown-808-" });
    const ledgerFile = path.join(dir, "created.jsonl");

    yield* Effect.forEach(entries, recordCreated).pipe(
      Effect.provideService(LedgerFile, ledgerFile)
    );

    return { ledgerFile, lock: path.join(dir, ".recording") };
  });

/** `teardown(argv)` over `account`: how it ended, and what it printed. */
const tornDown = (
  argv: readonly string[],
  account: TeardownAccount["Service"],
  files: { readonly ledgerFile: string; readonly lock: string }
) =>
  Effect.gen(function* () {
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    const result = yield* teardown(argv).pipe(
      Effect.provideService(TeardownAccount, account),
      Effect.provideService(LedgerFile, files.ledgerFile),
      Effect.provideService(LockFile, files.lock),
      Effect.provideService(Console.Console, captured),
      Effect.result
    );

    return { printed, result };
  });

/** The dev stage's two namespaces as a smoke run, a swarm copy and the seed left them. */
const devRepos = {
  [layers]: ["datekit--maintainers", "datekit-805--maintainers"],
  [projects]: [
    "datekit",
    "burrow",
    "smoke-r1",
    "smoke-r1--parse-year--bram",
    "smoke-unrecorded",
    "burrow-swarm-1",
    "burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol",
    "w3live-muyjz31t",
  ],
};

/** The ledger: `ledger` above, one repo already gone, and one in `witness`. */
const devLedger: readonly Created[] = [
  ...ledger,
  made("smoke", "repo", "smoke-r0", projects),
  made("smoke", "repo", "smoke-r9", "witness"),
];

const thePlan = [
  "teardown on dev-oscabriel: 9 ledger entries, 5 to delete",
  "  delete repo layers-dev-oscabriel/datekit-805--maintainers",
  "  delete repo projects-dev-oscabriel/burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol",
  "  delete repo projects-dev-oscabriel/burrow-swarm-1",
  "  delete repo projects-dev-oscabriel/smoke-r1--parse-year--bram",
  "  delete repo projects-dev-oscabriel/smoke-r1",
  "  gone already: repo projects-dev-oscabriel/smoke-r0",
  "  never selectable: repo witness/smoke-r9",
  "  kept: 2 projects (smoke-r1, burrow-swarm-1): each one's Durable Object and front-page row stay",
];

describe("bun infra/teardown.ts", () => {
  it.live("prints the plan and deletes nothing without --apply", () =>
    Effect.gen(function* () {
      const files = yield* tempRoot(devLedger);
      const fake = yield* memoryAccount(devRepos);
      const { printed, result } = yield* tornDown([], fake.account, files);

      expect({
        layers: yield* fake.standing(layers, devRepos[layers]),
        ledger: (yield* readLedger.pipe(
          Effect.provideService(LedgerFile, files.ledgerFile)
        )).filter(({ deletedAt }) => deletedAt !== undefined),
        printed,
        projects: yield* fake.standing(projects, devRepos[projects]),
        result: Result.isSuccess(result),
        witnessRead: (yield* fake.read).includes("witness"),
      }).toStrictEqual({
        layers: devRepos[layers],
        ledger: [],
        printed: [
          ...thePlan,
          "dry run: nothing deleted; --apply deletes exactly this plan",
        ],
        projects: devRepos[projects],
        result: true,
        witnessRead: false,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--apply deletes exactly the plan through RepoHost's remove, marks each one deleted in the ledger, and a second run finds nothing left",
    () =>
      Effect.gen(function* () {
        const files = yield* tempRoot(devLedger);
        const fake = yield* memoryAccount(devRepos);
        const first = yield* tornDown(["--apply"], fake.account, files);
        const second = yield* tornDown(["--apply"], fake.account, files);

        const read = yield* readLedger.pipe(
          Effect.provideService(LedgerFile, files.ledgerFile)
        );

        expect({
          deleted: read
            .filter(({ deletedAt }) => deletedAt !== undefined)
            .map(({ name }) => name),
          first: first.printed,
          layers: yield* fake.standing(layers, devRepos[layers]),
          projects: yield* fake.standing(projects, devRepos[projects]),
          second: second.printed,
          witnessRead: (yield* fake.read).includes("witness"),
        }).toStrictEqual({
          deleted: [
            "smoke-r1",
            "smoke-r1--parse-year--bram",
            "burrow-swarm-1",
            "burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol",
            "datekit-805--maintainers",
          ],
          first: [
            ...thePlan,
            "deleted repo layers-dev-oscabriel/datekit-805--maintainers",
            "deleted repo projects-dev-oscabriel/burrow-swarm-1--drop-legacy-fetch-burrow-kit--marisol",
            "deleted repo projects-dev-oscabriel/burrow-swarm-1",
            "deleted repo projects-dev-oscabriel/smoke-r1--parse-year--bram",
            "deleted repo projects-dev-oscabriel/smoke-r1",
            "deleted 5 of 5, each marked deleted in the ledger",
          ],
          layers: ["datekit--maintainers"],
          projects: [
            "datekit",
            "burrow",
            "smoke-unrecorded",
            "w3live-muyjz31t",
          ],
          second: [
            "teardown on dev-oscabriel: 9 ledger entries, 0 to delete",
            "  gone already: repo projects-dev-oscabriel/smoke-r0",
            "  never selectable: repo witness/smoke-r9",
            "  kept: 2 projects (smoke-r1, burrow-swarm-1): each one's Durable Object and front-page row stay",
            "deleted 0 of 0, each marked deleted in the ledger",
          ],
          witnessRead: false,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--apply is refused with RecordingInProgress while infra/.recording exists, before it reads the ledger or the account",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* tempRoot(devLedger);
        const fake = yield* memoryAccount(devRepos);

        yield* fs.writeFileString(files.lock, "recording since a moment ago\n");

        const { printed, result } = yield* tornDown(
          ["--apply", "--stage", dev],
          fake.account,
          files
        );

        expect({
          printed,
          projects: yield* fake.standing(projects, devRepos[projects]),
          read: yield* fake.read,
          result,
        }).toStrictEqual({
          printed: [],
          projects: devRepos[projects],
          read: [],
          result: Result.fail(new RecordingInProgress({ file: files.lock })),
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "lists the kept imports apart, each once, never in the plan, and deletes none of them with --apply",
    () =>
      Effect.gen(function* () {
        // A `--tags` backfill records anyhow's repo a second time.
        const files = yield* tempRoot([
          ...devLedger,
          ...imports,
          {
            ...made("import", "repo", "anyhow", projects),
            note: "tags backfilled",
          },
        ]);

        const fake = yield* memoryAccount({
          ...devRepos,
          [projects]: [...devRepos[projects], "anyhow", "ky"],
        });

        const { printed } = yield* tornDown(["--apply"], fake.account, files);

        expect({
          kept: printed.filter((line) => /anyhow|\bky\b/u.test(line)),
          standing: yield* fake.standing(projects, ["anyhow", "ky"]),
          total: printed[0],
        }).toStrictEqual({
          kept: [
            "  kept import: project anyhow",
            "  kept import: repo projects-dev-oscabriel/anyhow",
            "  kept import: project ky",
            "  kept import: repo projects-dev-oscabriel/ky",
          ],
          standing: ["anyhow", "ky"],
          total: "teardown on dev-oscabriel: 14 ledger entries, 5 to delete",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("--keep leaves a copy's repos and forks out of the plan", () =>
    Effect.gen(function* () {
      const files = yield* tempRoot(devLedger);
      const fake = yield* memoryAccount(devRepos);

      const { printed } = yield* tornDown(
        ["--keep", "burrow-swarm-1", "--keep", "datekit-805"],
        fake.account,
        files
      );

      expect(printed.slice(0, 3)).toStrictEqual([
        "teardown on dev-oscabriel: 9 ledger entries, 2 to delete",
        "  delete repo projects-dev-oscabriel/smoke-r1--parse-year--bram",
        "  delete repo projects-dev-oscabriel/smoke-r1",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live.each([
    [["--stage", "prod"], "prod"],
    [["--stage"], "--stage"],
    [["--force"], "--force"],
    [["--keep"], "--keep"],
  ] as const)(
    "refuses %j with TeardownUsage before it reads anything",
    ([argv, given]) =>
      Effect.gen(function* () {
        const files = yield* tempRoot(devLedger);
        const fake = yield* memoryAccount(devRepos);
        const { result } = yield* tornDown(argv, fake.account, files);

        expect({ read: yield* fake.read, result }).toStrictEqual({
          read: [],
          result: Result.fail(new TeardownUsage({ given })),
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
