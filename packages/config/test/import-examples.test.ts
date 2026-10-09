/**
 * `bun scripts/import-examples.ts`: the open-source repos the code browser
 * is previewed on, imported one at a time as the operator, skipped once a
 * platform lists them, recorded in the ledger as kept imports, never on
 * `demo`; and `--tags`' backfill, which pushes tags only and never shows
 * its token.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Ref,
  Result,
} from "effect";

import { LedgerFile, readLedger } from "../../../infra/created.ts";
import {
  examples,
  planImports,
  shownCommand,
  tagBackfillCommands,
} from "../../../scripts/lib/import/plan.ts";
import type { ImportExample } from "../../../scripts/lib/import/plan.ts";
import {
  ImportExamplesFailed,
  importExamples,
  ImportTarget,
  TagBackfill,
} from "../../../scripts/lib/import/run.ts";
import { ProjectName } from "../../protocol/src/ids.ts";

const project = (name: string) => ProjectName.make(name);

const names = (planned: readonly ImportExample[]) =>
  planned.map(({ project: name }) => name);

describe("the import plan", () => {
  it("holds the eight repos of the preview, anyhow first, each master repo on its branch", () => {
    expect(
      examples.map(({ branch, project: name, url }) => [name, branch, url])
    ).toStrictEqual([
      ["anyhow", "master", "https://github.com/dtolnay/anyhow"],
      ["ky", "main", "https://github.com/sindresorhus/ky"],
      ["gum", "main", "https://github.com/charmbracelet/gum"],
      ["click", "main", "https://github.com/pallets/click"],
      ["awesome", "main", "https://github.com/sindresorhus/awesome"],
      ["changesets", "main", "https://github.com/changesets/changesets"],
      ["stb", "master", "https://github.com/nothings/stb"],
      ["fuzzel", "master", "https://codeberg.org/dnkl/fuzzel"],
    ]);
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
      all: ["anyhow", "gum", "click", "awesome", "changesets", "fuzzel"],
      listed: [],
      only: ["gum"],
    });
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
        note(`ls-remote ${name}`).pipe(Effect.as({ heads: 2, tags: 0 })),
      initProject: (example) =>
        note(`init ${example.project} ${example.branch}`).pipe(
          Effect.tap(() => Effect.sync(() => have.add(example.project))),
          Effect.as({ landed: "a".repeat(40) })
        ),
      label: "dev-oscabriel (https://platform.test)",
      listProjects: note("listProjects").pipe(
        Effect.andThen(Effect.sync(() => new Set(have)))
      ),
    });

    const backfill = TagBackfill.of({
      backfill: (example) =>
        note(`tags ${example.project}`).pipe(Effect.as(105)),
    });

    return {
      calls: Ref.get(calls),
      layer: Layer.mergeAll(
        Layer.succeed(ImportTarget, target),
        Layer.succeed(TagBackfill, backfill)
      ),
    };
  });

/** `importExamples(argv)` over `layer`, with the ledger in a temp folder: how it ended, and what it printed. */
const ran = (
  argv: readonly string[],
  layer: Layer.Layer<ImportTarget | TagBackfill>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "import-913-" });
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
    "refuses --stage demo before it builds a target or calls anything",
    () =>
      Effect.gen(function* () {
        let built = 0;

        const result = yield* importExamples(["--stage", "demo"], () => {
          built += 1;

          return Layer.mergeAll(
            Layer.effect(ImportTarget, Effect.die("a target was built")),
            Layer.effect(TagBackfill, Effect.die("a backfill was built"))
          );
        }).pipe(Effect.result);

        expect({ built, result }).toStrictEqual({
          built: 0,
          result: Result.fail(
            new ImportExamplesFailed({
              reason:
                "--stage demo is the recording stage: the imports go on a dev stage only",
            })
          ),
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "imports each project the platform doesn't list, one at a time, with its counts, and records each in the ledger as a kept import",
    () =>
      Effect.gen(function* () {
        const platform = yield* fakePlatform(["ky", "stb", "click", "gum"]);
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
          printed,
          result: Result.isSuccess(result),
        }).toStrictEqual({
          calls: [
            "listProjects",
            "init anyhow master",
            "ls-remote anyhow",
            "init awesome main",
            "ls-remote awesome",
            "init changesets main",
            "ls-remote changesets",
            "init fuzzel master",
            "ls-remote fuzzel",
          ],
          ledger: ["anyhow", "awesome", "changesets", "fuzzel"].flatMap(
            (name) => [
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
            ]
          ),
          printed: [
            "import-examples on dev-oscabriel (https://platform.test): 4 to import, 4 listed already",
            "  skip ky: listed already",
            "  skip gum: listed already",
            "  skip click: listed already",
            "  skip stb: listed already",
            "imported anyhow (Rust crate, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "imported awesome (Markdown list, main): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "imported changesets (TypeScript monorepo, main): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "imported fuzzel (C on Codeberg, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "imported 4 of 4, each recorded in infra/created.jsonl as a kept import",
          ],
          result: true,
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
          "  would import anyhow from https://github.com/dtolnay/anyhow (master)",
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
          ],
          ledger: [
            ["project", "anyhow", undefined],
            ["repo", "anyhow", undefined],
            ["repo", "anyhow", "tags backfilled"],
          ],
          printed: [
            "imported anyhow (Rust crate, master): main at aaaaaaaaaaaa, 2 heads, 0 tags",
            "  anyhow: 105 tags backfilled from https://github.com/dtolnay/anyhow",
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

        const dir = yield* fs.makeTempDirectoryScoped({
          prefix: "import-913-",
        });

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
});
