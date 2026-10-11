/**
 * `bun scripts/import-examples.ts`: the open-source repos the code browser
 * is previewed on, imported one at a time as the operator, skipped once a
 * platform lists them, recorded in the ledger as kept imports, on `demo`
 * as on a dev stage; and `--tags`' backfill, which pushes tags only and
 * never shows its token.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { ProjectExists } from "@repo/protocol/refusal";
import {
  Console,
  Data,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Exit,
  Ref,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { LedgerFile, readLedger } from "../../../infra/created.ts";
import {
  examples,
  planImports,
  shownCommand,
  tagBackfillCommands,
  warmPaths,
} from "../../../scripts/lib/import/plan.ts";
import type { ImportExample } from "../../../scripts/lib/import/plan.ts";
import {
  importExamples,
  ImportTarget,
  initUntilAnswered,
  optionsOf,
  TagBackfill,
  Warmer,
} from "../../../scripts/lib/import/run.ts";
import { keyOf, ProjectName } from "../../protocol/src/ids.ts";

// A project of the plan by the key it was imported under (`anyhow`), read
// as its name (`github.com/dtolnay/anyhow`), as every surface reads it.
const project = (key: string) => Schema.decodeSync(ProjectName)(key);

const names = (planned: readonly ImportExample[]) =>
  planned.map(({ name }) => name);

describe("the import plan", () => {
  it("holds the eight repos of the preview first, then thirty well-known ones, each on its branch with its licence", () => {
    expect(
      examples.map(({ branch, key, licence, url }) => [
        key,
        branch,
        url,
        licence,
      ])
    ).toStrictEqual([
      [
        "anyhow",
        "master",
        "https://github.com/dtolnay/anyhow",
        "MIT OR Apache-2.0",
      ],
      ["ky", "main", "https://github.com/sindresorhus/ky", "MIT"],
      ["gum", "main", "https://github.com/charmbracelet/gum", "MIT"],
      ["click", "main", "https://github.com/pallets/click", "BSD-3-Clause"],
      ["awesome", "main", "https://github.com/sindresorhus/awesome", "CC0-1.0"],
      ["changesets", "main", "https://github.com/changesets/changesets", "MIT"],
      ["stb", "master", "https://github.com/nothings/stb", "MIT OR Unlicense"],
      ["fuzzel", "master", "https://codeberg.org/dnkl/fuzzel", "MIT"],
      ["hono", "main", "https://github.com/honojs/hono", "MIT"],
      ["express", "master", "https://github.com/expressjs/express", "MIT"],
      ["fastify", "main", "https://github.com/fastify/fastify", "MIT"],
      ["zustand", "main", "https://github.com/pmndrs/zustand", "MIT"],
      ["immer", "main", "https://github.com/immerjs/immer", "MIT"],
      ["nanoid", "main", "https://github.com/ai/nanoid", "MIT"],
      ["commander", "master", "https://github.com/tj/commander.js", "MIT"],
      ["execa", "main", "https://github.com/sindresorhus/execa", "MIT"],
      ["chalk", "main", "https://github.com/chalk/chalk", "MIT"],
      ["mitt", "main", "https://github.com/developit/mitt", "MIT"],
      ["clsx", "master", "https://github.com/lukeed/clsx", "MIT"],
      [
        "ripgrep",
        "master",
        "https://github.com/BurntSushi/ripgrep",
        "Unlicense OR MIT",
      ],
      [
        "serde",
        "master",
        "https://github.com/serde-rs/serde",
        "MIT OR Apache-2.0",
      ],
      ["axum", "main", "https://github.com/tokio-rs/axum", "MIT"],
      ["fd", "master", "https://github.com/sharkdp/fd", "MIT OR Apache-2.0"],
      [
        "hyperfine",
        "master",
        "https://github.com/sharkdp/hyperfine",
        "MIT OR Apache-2.0",
      ],
      [
        "bubbletea",
        "main",
        "https://github.com/charmbracelet/bubbletea",
        "MIT",
      ],
      ["fzf", "master", "https://github.com/junegunn/fzf", "MIT"],
      ["cobra", "main", "https://github.com/spf13/cobra", "Apache-2.0"],
      ["gin", "master", "https://github.com/gin-gonic/gin", "MIT"],
      ["requests", "main", "https://github.com/psf/requests", "Apache-2.0"],
      ["flask", "main", "https://github.com/pallets/flask", "BSD-3-Clause"],
      ["httpx", "master", "https://github.com/encode/httpx", "BSD-3-Clause"],
      ["typer", "master", "https://github.com/fastapi/typer", "MIT"],
      ["jinja", "main", "https://github.com/pallets/jinja", "BSD-3-Clause"],
      ["lua", "master", "https://github.com/lua/lua", "MIT"],
      ["jq", "master", "https://github.com/jqlang/jq", "MIT"],
      ["kilo", "master", "https://github.com/antirez/kilo", "BSD-2-Clause"],
      ["sinatra", "main", "https://github.com/sinatra/sinatra", "MIT"],
      ["nvm", "master", "https://github.com/nvm-sh/nvm", "MIT"],
    ]);
  });

  it("names each project at its source path, beside the key it was first imported under", () => {
    expect(
      examples
        .filter(({ key }) => ["click", "commander", "fuzzel"].includes(key))
        .map(({ key, name }) => [key, name])
    ).toStrictEqual([
      ["click", "github.com/pallets/click"],
      ["fuzzel", "codeberg.org/dnkl/fuzzel"],
      ["commander", "github.com/tj/commander"],
    ]);
  });

  it.effect.each([
    ["github.com/pallets/click"],
    ["click"],
    ["GitHub.com/Pallets/click"],
  ] as const)("takes --only %s as click", ([named]) =>
    Effect.map(optionsOf(["--world", "node", "--only", named]), ({ only }) => {
      expect(only).toStrictEqual(Option.some("github.com/pallets/click"));
    })
  );

  it("names each project once, as a name the platform takes", () => {
    const all = names(examples);

    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((name) => !Schema.is(ProjectName)(name))).toStrictEqual(
      []
    );
  });

  it("skips a project the platform lists already, and keeps only the one --only names", () => {
    expect({
      all: names(
        planImports(
          examples,
          new Set([project("ky"), project("stb")]),
          Option.none()
        )
      ),
      listed: names(
        planImports(
          examples,
          new Set([project("anyhow")]),
          Option.some(project("anyhow"))
        )
      ),
      only: names(
        planImports(examples, new Set(), Option.some(project("gum")))
      ),
    }).toStrictEqual({
      all: names(examples).filter(
        (name) =>
          name !== "github.com/sindresorhus/ky" &&
          name !== "github.com/nothings/stb"
      ),
      listed: [],
      only: ["github.com/charmbracelet/gum"],
    });
  });
});

describe("the warm plan", () => {
  it("reads a project's home, its tree, its landings, and its README and why the README is there", () => {
    expect(warmPaths(project("ky"), Option.some("readme.md"))).toStrictEqual([
      "/github.com/sindresorhus/ky",
      "/github.com/sindresorhus/ky/tree/main",
      "/github.com/sindresorhus/ky/commits/main",
      "/github.com/sindresorhus/ky/blob/main/readme.md",
      "/github.com/sindresorhus/ky/why/main/readme.md",
    ]);
  });

  it("reads no README when the project has none", () => {
    expect(warmPaths(project("awesome"), Option.none())).toStrictEqual([
      "/github.com/sindresorhus/awesome",
      "/github.com/sindresorhus/awesome/tree/main",
      "/github.com/sindresorhus/awesome/commits/main",
    ]);
  });
});

describe("the tag backfill's commands", () => {
  const token = Redacted.make("artifacts-write-token-0123456789abcdef");

  const commands = tagBackfillCommands({
    mirror: "/tmp/import-tags/anyhow.git",
    remote: {
      token,
      url: "https://acct.artifacts.cloudflare.net/git/projects-dev-oscabriel/anyhow.git",
    },
    source: "https://github.com/dtolnay/anyhow",
  });

  it("fetches the source's tags into a local bare repo, then pushes refs/tags/* and nothing else", () => {
    expect(commands.map(shownCommand)).toStrictEqual([
      "git init --bare --quiet /tmp/import-tags/anyhow.git",
      "git --git-dir /tmp/import-tags/anyhow.git fetch --quiet --no-tags https://github.com/dtolnay/anyhow refs/tags/*:refs/tags/*",
      "git --git-dir /tmp/import-tags/anyhow.git push --quiet https://acct.artifacts.cloudflare.net/git/projects-dev-oscabriel/anyhow.git refs/tags/*:refs/tags/*",
    ]);

    const pushes = commands.filter(({ argv }) => argv.includes("push"));

    expect(
      pushes.map(({ argv }) => argv.filter((arg) => arg.includes(":")))
    ).toStrictEqual([
      [
        "https://acct.artifacts.cloudflare.net/git/projects-dev-oscabriel/anyhow.git",
        "refs/tags/*:refs/tags/*",
      ],
    ]);
    expect(
      pushes.flatMap(({ argv }) =>
        argv.filter((arg) => /--force|--all|--mirror|main|heads/u.test(arg))
      )
    ).toStrictEqual([]);
  });

  it("never prints the token: it rides in git's env as a header, redacted, not in an argument or a URL", () => {
    const printed = [
      ...commands.map(shownCommand),
      JSON.stringify(commands),
      JSON.stringify(commands.map(({ env }) => env)),
    ].join("\n");

    expect(printed.includes(Redacted.value(token))).toBeFalsy();
    expect(
      commands.map(({ env = {} }) =>
        Object.entries(env).map(([name, value]) => [
          name,
          Redacted.value(value),
        ])
      )
    ).toStrictEqual([
      [],
      [],
      [
        ["GIT_CONFIG_COUNT", "1"],
        ["GIT_CONFIG_KEY_0", "http.extraHeader"],
        [
          "GIT_CONFIG_VALUE_0",
          "Authorization: Bearer artifacts-write-token-0123456789abcdef",
        ],
      ],
    ]);
  });
});

/** A platform in memory: the projects it lists, and every call made to it. */
const fakePlatform = (listed: readonly string[]) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<readonly string[]>([]);
    const have = new Set(listed.map(project));
    const note = (call: string) => Ref.update(calls, (all) => [...all, call]);

    const target = ImportTarget.of({
      counts: (name) =>
        note(`ls-remote ${keyOf(name)}`).pipe(Effect.as({ heads: 2, tags: 0 })),
      initProject: (example) =>
        note(`init ${example.key} ${example.branch}`).pipe(
          Effect.tap(() => Effect.sync(() => have.add(example.name))),
          Effect.as({ landed: "a".repeat(40) })
        ),
      label: "dev-oscabriel (https://platform.test)",
      listProjects: note("listProjects").pipe(
        Effect.andThen(Effect.sync(() => new Set(have)))
      ),
    });

    const backfill = TagBackfill.of({
      backfill: (example) => note(`tags ${example.key}`).pipe(Effect.as(105)),
    });

    // Every read answers but fuzzel's why, which the web never answered.
    const warmer = Warmer.of({
      warm: (name) =>
        note(`warm ${keyOf(name)}`).pipe(
          Effect.as(
            warmPaths(name, Option.some("README.md")).map((path) =>
              keyOf(name) === "fuzzel" && path.includes("/why/")
                ? { ok: false, path, said: "no answer" }
                : { ok: true, path, said: "200" }
            )
          )
        ),
    });

    return {
      calls: Ref.get(calls),
      layer: Layer.mergeAll(
        Layer.succeed(ImportTarget, target),
        Layer.succeed(TagBackfill, backfill),
        Layer.succeed(Warmer, warmer)
      ),
    };
  });

/** `importExamples(argv)` over `layer`, with the ledger in a temp folder: how it ended, and what it printed. */
const ran = (
  argv: readonly string[],
  layer: Layer.Layer<ImportTarget | TagBackfill | Warmer>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "importing-" });
    const ledgerFile = path.join(dir, "created.jsonl");
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    const result = yield* importExamples(argv, () => layer).pipe(
      Effect.provideService(LedgerFile, ledgerFile),
      Effect.provideService(Console.Console, captured),
      Effect.result
    );

    const ledger = yield* readLedger.pipe(
      Effect.provideService(LedgerFile, ledgerFile)
    );

    return { ledger, printed, result };
  });

const onDev = (...flags: readonly string[]) => [
  "--stage",
  "dev-oscabriel",
  "--url",
  "https://platform.test",
  ...flags,
];

describe("bun scripts/import-examples.ts", () => {
  it.live(
    "takes --stage demo as any declared stage: its dry run plans the import onto demo",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform(["ky"]);

        const { ledger, printed, result } = yield* ran(
          ["--stage", "demo", "--dry-run", "--only", "anyhow"],
          platform.layer
        );

        expect({
          ledger,
          printed,
          result: Result.isSuccess(result),
        }).toStrictEqual({
          ledger: [],
          printed: [
            "import-examples on dev-oscabriel (https://platform.test): 1 to import, 0 listed already",
            "  would import github.com/dtolnay/anyhow from https://github.com/dtolnay/anyhow (master)",
            "dry run: nothing imported, nothing recorded",
          ],
          result: true,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "imports each project the platform doesn't list, one at a time, with its counts, warms it, and records each in the ledger as a kept import",
    () =>
      Effect.gen(function* () {
        const fresh = ["anyhow", "awesome", "changesets", "fuzzel"];

        const platform = yield* fakePlatform(
          examples.flatMap(({ key, name }) =>
            fresh.includes(key) ? [] : [name]
          )
        );

        const { ledger, printed, result } = yield* ran(onDev(), platform.layer);

        expect({
          calls: yield* platform.calls,
          ledger: ledger.map(({ by, kind, name, namespace, stage }) => ({
            by,
            kind,
            name,
            namespace,
            stage,
          })),
          printed: printed.filter((line) => !line.startsWith("  skip ")),
          result: Result.isSuccess(result),
          skipped: printed.filter((line) => line.startsWith("  skip ")).length,
        }).toStrictEqual({
          calls: [
            "listProjects",
            ...fresh.flatMap((name) => [
              `init ${name} ${name === "anyhow" || name === "fuzzel" ? "master" : "main"}`,
              `ls-remote ${name}`,
              `warm ${name}`,
            ]),
          ],
          ledger: fresh.flatMap((name) => [
            {
              by: "import",
              kind: "project",
              name,
              namespace: undefined,
              stage: "dev-oscabriel",
            },
            {
              by: "import",
              kind: "repo",
              name,
              namespace: "projects-dev-oscabriel",
              stage: "dev-oscabriel",
            },
          ]),
          printed: [
            "import-examples on dev-oscabriel (https://platform.test): 4 to import, 34 listed already",
            "imported github.com/dtolnay/anyhow (Rust crate, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  warmed github.com/dtolnay/anyhow: 5 of 5 pages read",
            "imported github.com/sindresorhus/awesome (Markdown list, main): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  warmed github.com/sindresorhus/awesome: 5 of 5 pages read",
            "imported github.com/changesets/changesets (TypeScript monorepo, main): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  warmed github.com/changesets/changesets: 5 of 5 pages read",
            "imported codeberg.org/dnkl/fuzzel (C on Codeberg, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  warmed codeberg.org/dnkl/fuzzel: 4 of 5 pages read; /codeberg.org/dnkl/fuzzel/why/main/README.md: no answer",
            "imported 4 of 4, each recorded in infra/created.jsonl as a kept import",
          ],
          result: true,
          skipped: 34,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--warm warms every example the platform lists already, and imports nothing it lists",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform(["ky", "gum"]);

        const { printed } = yield* ran(
          onDev("--only", "ky", "--warm"),
          platform.layer
        );

        expect({
          calls: yield* platform.calls,
          printed,
        }).toStrictEqual({
          calls: ["listProjects", "warm ky"],
          printed: [
            "import-examples on dev-oscabriel (https://platform.test): 0 to import, 1 listed already",
            "  skip github.com/sindresorhus/ky: listed already",
            "  warmed github.com/sindresorhus/ky: 5 of 5 pages read",
            "imported 0 of 0, each recorded in infra/created.jsonl as a kept import",
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("--dry-run prints the plan and imports and records nothing", () =>
    Effect.gen(function* () {
      const platform = yield* fakePlatform(["ky"]);

      const { ledger, printed } = yield* ran(
        onDev("--dry-run", "--only", "anyhow"),
        platform.layer
      );

      expect({ calls: yield* platform.calls, ledger, printed }).toStrictEqual({
        calls: ["listProjects"],
        ledger: [],
        printed: [
          "import-examples on dev-oscabriel (https://platform.test): 1 to import, 0 listed already",
          "  would import github.com/dtolnay/anyhow from https://github.com/dtolnay/anyhow (master)",
          "dry run: nothing imported, nothing recorded",
        ],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--tags backfills an import that came with no tags, and the ledger says so",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform([]);

        const { ledger, printed } = yield* ran(
          onDev("--only", "anyhow", "--tags"),
          platform.layer
        );

        expect({
          calls: yield* platform.calls,
          ledger: ledger.map(({ kind, name, note }) => [kind, name, note]),
          printed: printed.filter((line) => line.includes("tags")),
        }).toStrictEqual({
          calls: [
            "listProjects",
            "init anyhow master",
            "ls-remote anyhow",
            "tags anyhow",
            "warm anyhow",
          ],
          ledger: [
            ["project", "anyhow", undefined],
            ["repo", "anyhow", undefined],
            ["repo", "anyhow", "tags backfilled"],
          ],
          printed: [
            "imported github.com/dtolnay/anyhow (Rust crate, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  github.com/dtolnay/anyhow: 105 tags backfilled from https://github.com/dtolnay/anyhow",
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--tags backfills an earlier import the ledger records, and never a listed project it doesn't",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "importing-" });

        const ledgerFile = path.join(dir, "created.jsonl");
        const platform = yield* fakePlatform(["anyhow", "ky"]);

        // An earlier run imported anyhow; ky is someone else's project.
        yield* fs.writeFileString(
          ledgerFile,
          `${JSON.stringify({ at: "2026-10-08T20:00:00.000Z", by: "import", kind: "project", name: "anyhow", stage: "dev-oscabriel" })}\n`
        );

        yield* importExamples(onDev("--tags"), () => platform.layer).pipe(
          Effect.provideService(LedgerFile, ledgerFile),
          Effect.provideService(Console.Console, {
            ...console,
            log: () => {},
          })
        );

        expect(
          (yield* platform.calls).filter((call) => /ky|anyhow/u.test(call))
        ).toStrictEqual(["ls-remote anyhow", "tags anyhow"]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--sources asks initProject again for each import the ledger records, listed or not, and never for a listed project it doesn't",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "importing-" });

        const ledgerFile = path.join(dir, "created.jsonl");

        // An earlier run imported anyhow and gum; the platform lists anyhow
        // and ky (someone else's project), and gum not yet.
        const platform = yield* fakePlatform(["anyhow", "ky"]);

        yield* fs.writeFileString(
          ledgerFile,
          ["anyhow", "gum"]
            .map(
              (name) =>
                `${JSON.stringify({ at: "2026-10-08T20:00:00.000Z", by: "import", kind: "project", name, stage: "dev-oscabriel" })}\n`
            )
            .join("")
        );

        const printed: string[] = [];

        yield* importExamples(
          onDev("--only", "gum", "--sources"),
          () => platform.layer
        ).pipe(
          Effect.provideService(LedgerFile, ledgerFile),
          Effect.provideService(Console.Console, {
            ...console,
            log: (...args: readonly unknown[]) => {
              printed.push(args.map(String).join(" "));
            },
          })
        );

        yield* importExamples(onDev("--sources"), () => platform.layer).pipe(
          Effect.provideService(LedgerFile, ledgerFile),
          Effect.provideService(Console.Console, {
            ...console,
            log: () => {},
          })
        );

        expect(
          (yield* platform.calls).filter((call) => /gum|anyhow|ky/u.test(call))
        ).toStrictEqual([
          "init gum main",
          "init anyhow master",
          "init gum main",
        ]);
        expect(printed).toStrictEqual([
          "import-examples on dev-oscabriel (https://platform.test): 0 to import, 1 listed already",
          "  skip github.com/charmbracelet/gum: imported already, as the ledger records",
          "  github.com/charmbracelet/gum: source kept: https://github.com/charmbracelet/gum (main)",
          "imported 0 of 0, each recorded in infra/created.jsonl as a kept import",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--sources --dry-run prints each source it would keep, and keeps none",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform(["anyhow"]);

        const { ledger, printed } = yield* ran(
          onDev("--only", "anyhow", "--sources", "--dry-run"),
          platform.layer
        );

        expect({
          calls: yield* platform.calls,
          ledger,
          printed: printed.filter((line) => line.includes("source")),
        }).toStrictEqual({
          calls: ["listProjects"],
          ledger: [],
          printed: [],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "--sources in the Node world goes over every example listed, with no ledger",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform(["anyhow", "ky"]);

        const { printed } = yield* ran(
          ["--world", "node", "--sources", "--dry-run"],
          platform.layer
        );

        expect(printed.filter((line) => line.includes("source"))).toStrictEqual(
          [
            "  would keep the source of github.com/dtolnay/anyhow: https://github.com/dtolnay/anyhow (master)",
            "  would keep the source of github.com/sindresorhus/ky: https://github.com/sindresorhus/ky (main)",
          ]
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

/** A call the platform never answered, as an edge timeout leaves it. */
class NoAnswer extends Data.TaggedError("NoAnswer")<{
  readonly after: string;
}> {}

/**
 * `initUntilAnswered` over calls that answer `answers` in turn, the clock
 * moved past its waits: how it ended, and how many calls it made.
 */
const askedAgain = (
  answers: readonly Effect.Effect<
    { readonly landed?: string },
    NoAnswer | ProjectExists
  >[]
) =>
  Effect.gen(function* () {
    const made = yield* Ref.make(0);

    const call = Effect.flatMap(
      Ref.getAndUpdate(made, (count) => count + 1),
      (count) => answers[count] ?? Effect.die("asked once too often")
    );

    const fiber = yield* Effect.forkChild(
      initUntilAnswered(call, (error) => !(error instanceof NoAnswer))
    );

    yield* TestClock.adjust(Duration.minutes(2));

    return { calls: yield* Ref.get(made), ended: yield* Fiber.await(fiber) };
  });

describe("an import's initProject, asked again", () => {
  const anyhow = project("anyhow");

  it.effect(
    "takes ProjectExists after a call that got no answer as that call's project, made",
    () =>
      Effect.gen(function* () {
        expect(
          yield* askedAgain([
            Effect.fail(new NoAnswer({ after: "100 s" })),
            Effect.fail(new ProjectExists({ project: anyhow })),
          ])
        ).toStrictEqual({ calls: 2, ended: Exit.succeed({}) });
      })
  );

  it.effect(
    "answers ProjectExists on the first call, and asks nothing again",
    () =>
      Effect.gen(function* () {
        expect(
          yield* askedAgain([
            Effect.fail(new ProjectExists({ project: anyhow })),
          ])
        ).toStrictEqual({
          calls: 1,
          ended: Exit.fail(new ProjectExists({ project: anyhow })),
        });
      })
  );

  it.effect("gives up after three more calls with no answer", () =>
    Effect.gen(function* () {
      const lost = Effect.fail(new NoAnswer({ after: "100 s" }));

      expect(yield* askedAgain([lost, lost, lost, lost])).toStrictEqual({
        calls: 4,
        ended: Exit.fail(new NoAnswer({ after: "100 s" })),
      });
    })
  );
});
