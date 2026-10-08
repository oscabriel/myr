/**
 * The fence-shaped example's config folder (issue 508): the `/bun` adapter
 * evaluates `examples/burrow`'s config folder, with the facts the platform
 * reads from burrow's tree (its root files, its six workspace packages and
 * its vouch file), into the policy the ratchet and the six-way migrate demo
 * run on.
 *
 * The folder is found as the one at burrow's root that holds a `project.ts`:
 * its name is the brand's, which `rules` never spells. Its presence is
 * asserted before it is read, so a missing folder is a failed assertion.
 */
import { describe, expect, it } from "@effect/vitest";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import { Policy } from "@repo/protocol/domain/policy";
import { Effect, FileSystem, Path, Schema } from "effect";

import { EvaluationFacts, RulesEvaluator } from "../src/rules-evaluator.ts";
import { at, bundleOf, bunEvaluator, configFolder, now } from "./world.ts";

/** A text file under burrow's root, by its path there. */
interface File {
  readonly content: string;
  readonly path: string;
}

const Manifest = Schema.Struct({
  exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  name: Schema.String,
  workspaces: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));

/** The folders at `root` that hold a `project.ts`, and the files beside them. */
const rootEntries = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folders: string[] = [];
    const files: File[] = [];

    for (const name of (yield* fs.readDirectory(root)).toSorted()) {
      const full = path.join(root, name);

      if ((yield* fs.stat(full)).type === "File") {
        files.push({ content: yield* fs.readFileString(full), path: name });
      } else if (
        name.startsWith(".") &&
        (yield* fs.exists(path.join(full, "project.ts")))
      ) {
        folders.push(name);
      }
    }

    return { files, folders };
  });

/** Every `.ts` file under a folder, keyed by its path inside it. */
const sourcesIn = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sources: Record<string, string> = {};

    for (const file of (yield* fs.readDirectory(folder, {
      recursive: true,
    })).toSorted()) {
      const full = path.join(folder, file);

      if ((yield* fs.stat(full)).type === "File" && file.endsWith(".ts")) {
        sources[file] = yield* fs.readFileString(full);
      }
    }

    return sources;
  });

/**
 * The workspace packages a root manifest declares, as the platform reads
 * them: each `<dir>/*` glob is every folder in `<dir>`, and each package's
 * `exports` targets are its public files.
 */
const workspacesAt = (root: string, globs: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dirs = yield* Effect.forEach(globs, (glob) =>
      Effect.map(
        fs.readDirectory(path.join(root, glob.replace(/\/\*$/u, ""))),
        (names) =>
          names.toSorted().map((name) => `${glob.replace(/\*$/u, "")}${name}`)
      )
    );

    return yield* Effect.forEach(dirs.flat(), (dir) =>
      Effect.map(
        Effect.flatMap(
          fs.readFileString(path.join(root, dir, "package.json")),
          decodeManifest
        ),
        ({ exports, name }) => ({
          dir,
          exports: Object.values(exports ?? {}).map(
            (target) => `${dir}/${target.replace(/^\.\//u, "")}`
          ),
          name,
        })
      )
    );
  });

/** burrow's config folder as a bundle, and the facts the platform reads around it. */
const readBurrow = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = yield* path.fromFileUrl(
      new URL("../../../examples/burrow/", import.meta.url)
    );

    const { files, folders } = yield* rootEntries(root);

    expect(folders, "one config folder with a project.ts").toHaveLength(1);

    const [folder = ""] = folders;

    const manifest = yield* decodeManifest(
      yield* fs.readFileString(path.join(root, "package.json"))
    );

    const facts = yield* Schema.decodeEffect(EvaluationFacts)({
      ci: files,
      initializer: "okafor",
      now,
      project: "burrow",
      seed: 508,
      vouchFile: yield* fs.readFileString(
        path.join(root, folder, "vouched.td")
      ),
      workspaces: yield* workspacesAt(root, manifest.workspaces ?? []),
    });

    return {
      facts,
      modules: bundleOf(yield* sourcesIn(path.join(root, folder))),
    };
  });

/** burrow's policy at `at`, as `Policy` encodes it. */
const evaluated = () =>
  Effect.gen(function* () {
    const { facts, modules } = yield* readBurrow();
    const evaluator = yield* RulesEvaluator;

    return yield* Schema.encodeEffect(Policy)(
      yield* evaluator.evaluate({ at, facts, modules })
    );
  });

/** Every workspace package as its own module: its folder, and its `exports`. */
const modules = [
  {
    module: "@burrow/auth",
    paths: ["packages/auth/**"],
    publicFiles: ["packages/auth/src/index.ts"],
  },
  {
    module: "@burrow/billing",
    paths: ["packages/billing/**"],
    publicFiles: ["packages/billing/src/index.ts"],
  },
  {
    module: "@burrow/catalog",
    paths: ["packages/catalog/**"],
    publicFiles: ["packages/catalog/src/index.ts"],
  },
  {
    module: "@burrow/kit",
    paths: ["packages/kit/**"],
    publicFiles: ["packages/kit/src/index.ts", "packages/kit/src/testing.ts"],
  },
  {
    module: "@burrow/notify",
    paths: ["packages/notify/**"],
    publicFiles: ["packages/notify/src/index.ts"],
  },
  {
    module: "@burrow/search",
    paths: ["packages/search/**"],
    publicFiles: ["packages/search/src/index.ts"],
  },
];

/** The migrate ask, as `Policy` encodes it. */
const dropLegacyFetch = {
  askedBy: "okafor",
  blockedBy: [],
  brief: {
    context: [
      "http.get hands back a failed request as a value, where legacyFetch threw, so each caller decides what a failure means",
    ],
    outOfScope: ["The module-level state the lint warns about: its ratchet"],
    want: "Replace every call to legacyFetch with http.get, then delete legacyFetch",
  },
  check: CheckSpec.cases.Migrate.make({
    count: Command.make("bun scripts/count-callers.ts legacyFetch --json"),
    from: SymbolName.make("legacyFetch"),
    to: SymbolName.make("http.get"),
  }),
  file: `${configFolder}/asks/drop-legacy-fetch.ask.ts`,
  id: "drop-legacy-fetch",
  kind: "migrate",
  openedAt: now,
  openedIn: at,
  project: "burrow",
  state: "open",
  territory: { module: ".", paths: ["packages/**"] },
};

/** The sdk's `migrate` kind, as `Policy` encodes it. */
const migrateKind = {
  checkKind: "migrate",
  claimers: "vouched",
  finish: "never",
  name: "migrate",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
};

describe("examples/burrow's config folder", () => {
  it.live(
    "evaluates to six modules, a ratchet on the rule's lint count, the migrate kind and one migrate ask",
    () =>
      Effect.gen(function* () {
        const policy = yield* evaluated();

        expect({
          asks: policy.asks,
          migrate: policy.kinds.filter(({ name }) => name === "migrate"),
          modules: policy.modules,
          ratchets: policy.ratchets,
          source: policy.source,
        }).toStrictEqual({
          asks: [dropLegacyFetch],
          migrate: [migrateKind],
          modules,
          ratchets: [
            {
              measure: RatchetMeasure.cases.Count.make({
                command: Command.make("bun run lint --format json"),
                rule: "burrow/no-module-level-mutable-state",
              }),
              name: "no-module-level-mutable-state",
            },
          ],
          source: "config",
        });
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "names its deciders, the people who may claim, and the run block its hooks run",
    () =>
      Effect.gen(function* () {
        const policy = yield* evaluated();

        expect({
          deciders: policy.deciders,
          run: policy.run,
          vouches: policy.vouches.map(({ denounced, handle }) => [
            handle,
            denounced,
          ]),
        }).toStrictEqual({
          deciders: [{ handles: ["okafor", "lin-h"], paths: "**" }],
          run: {
            checks: {
              lint: "bun run lint",
              types: "bun run typecheck",
              unit: "bun test",
            },
            setup: "bun install --frozen-lockfile",
            test: "bun test {path}",
          },
          // The two deciders, six contributors (one for each migrate child),
          // and one person denounced.
          vouches: [
            ["okafor", false],
            ["lin-h", false],
            ["wren", false],
            ["tamsin", false],
            ["ivo", false],
            ["marisol", false],
            ["dagny", false],
            ["pell", false],
            ["quickclaim", true],
          ],
        });
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("spans every package with the migrate ask's territory", () =>
    Effect.gen(function* () {
      const policy = yield* evaluated();
      const globs = policy.asks.flatMap(({ territory }) => territory.paths);

      // Each module's folder lies under one of the ask's `<dir>/**` globs.
      const covered = policy.modules.filter(({ paths: [folder] }) =>
        globs.some(
          (glob) =>
            glob.endsWith("/**") &&
            folder.startsWith(glob.slice(0, -"**".length))
        )
      );

      expect(covered.map(({ module }) => module)).toStrictEqual(
        modules.map(({ module }) => module)
      );
    }).pipe(Effect.provide(bunEvaluator()))
  );
});
