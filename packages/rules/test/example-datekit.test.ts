/**
 * The datekit example's config folder (issue 507), evaluated by the `/bun`
 * adapter as the Lander's bundle of it would be: every file in the folder,
 * keyed by its repo path, with the facts the platform would give a
 * single-package repo (no workspaces, its vouch file, `ines-v` as the
 * initializer). Its `.ts` files import the sdk by the name users write, the
 * published one, which the adapter points at the sdk.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Policy } from "@repo/protocol/domain/policy";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Exit, FileSystem, Path, Schema } from "effect";

import { EvaluationFacts, RulesEvaluator } from "../src/rules-evaluator.ts";
import type { ConfigBundle } from "../src/rules-evaluator.ts";
import { at, bunEvaluator, now } from "./world.ts";

/** Where the example lives, from this test's folder. */
const exampleUrl = new URL("../../../examples/datekit/", import.meta.url);

/**
 * The example's dot-folders that hold a `project.ts`: its config folder, as
 * the repo names it. `rules` never spells that name (it lives in
 * `packages/brand`), so the test finds it.
 */
const configFolders = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(exampleUrl);

  const folders = yield* Effect.filter(
    (yield* fs.readDirectory(root)).filter((name) => name.startsWith(".")),
    (name) =>
      Effect.flatMap(fs.stat(path.join(root, name)), ({ type }) =>
        type === "Directory"
          ? fs.exists(path.join(root, name, "project.ts"))
          : Effect.succeed(false)
      )
  );

  return { folders, root };
});

/** Every file in the example's config folder, as the bundle the Lander makes of it. */
const exampleBundle = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { folders, root } = yield* configFolders;

  const folder = yield* Effect.fromNullishOr(
    folders.length === 1 ? folders[0] : undefined
  );

  const dir = path.join(root, folder);
  const modules: Record<string, string> = {};

  for (const file of (yield* fs.readDirectory(dir, {
    recursive: true,
  })).toSorted()) {
    const full = path.join(dir, file);

    if ((yield* fs.stat(full)).type === "File") {
      modules[`${folder}/${file}`] = yield* fs.readFileString(full);
    }
  }

  return {
    bundle: {
      entry: `${folder}/project.ts`,
      modules,
      sdkVersion: "0.0.0",
    } satisfies ConfigBundle,
    folder,
  };
});

/** The policy the example's config folder evaluates to, encoded. */
const evaluated = Effect.gen(function* () {
  const { bundle, folder } = yield* exampleBundle;
  const evaluator = yield* RulesEvaluator;

  const facts = yield* Schema.decodeEffect(EvaluationFacts)({
    ci: [],
    initializer: "ines-v",
    now,
    project: "datekit",
    seed: 7,
    vouchFile: bundle.modules[`${folder}/vouched.td`] ?? "",
    workspaces: [],
  });

  const policy = yield* evaluator.evaluate({ at, facts, modules: bundle });

  return { folder, policy: yield* Schema.encodeEffect(Policy)(policy) };
});

/** What one of the example's asks is, beside its brief. */
const askOf = (
  folder: string,
  id: string,
  territory: readonly [string, ...string[]]
) => ({
  askedBy: "ines-v",
  blockedBy: [],
  check: CheckSpec.cases.RedThenGreen.make({
    path: RepoPath.make(`test/asks/${id}.test.ts`),
  }),
  file: `${folder}/asks/${id}.ask.ts`,
  id,
  kind: "fix",
  openedAt: now,
  openedIn: at,
  project: "datekit",
  state: "open",
  territory: { module: ".", paths: territory },
});

describe("the datekit example's config folder", () => {
  it.live("is the example's one dot-folder with a project file", () =>
    Effect.gen(function* () {
      const { folders } = yield* configFolders;

      expect(folders).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "evaluates under /bun to a policy with its run block, its deciders and its kinds",
    () =>
      Effect.gen(function* () {
        const { folder, policy } = yield* evaluated;

        expect(Exit.isSuccess(Schema.decodeExit(Policy)(policy))).toBeTruthy();
        expect({
          agents: policy.agents,
          deciders: policy.deciders,
          kinds: policy.kinds.map(({ name }) => name),
          run: policy.run,
          source: policy.source,
          vouch: policy.vouch,
        }).toStrictEqual({
          agents: "trailer",
          deciders: [
            { handles: ["ines-v"], paths: "**" },
            { handles: ["okonkwo"], paths: "src/tz.ts" },
          ],
          kinds: ["fix", "changeJudge"],
          run: {
            checks: { unit: "bun test --path-ignore-patterns='test/asks/**'" },
            test: "bun test {path}",
          },
          source: "config",
          vouch: { file: `${folder}/vouched.td`, mode: "forCode" },
        });
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "holds its three asks, each checked by its own red-then-green test",
    () =>
      Effect.gen(function* () {
        const { folder, policy } = yield* evaluated;

        expect(
          policy.asks.map(({ brief: _brief, ...ask }) => ask)
        ).toStrictEqual([
          askOf(folder, "add-months-clamp", ["src/add.ts", "test/add.test.ts"]),
          {
            ...askOf(folder, "format-ordinal", [
              "src/format.ts",
              "test/format.test.ts",
            ]),
            mentor: "okonkwo",
            reserve: "newcomers",
          },
          askOf(folder, "parse-iso-week", [
            "src/parse.ts",
            "test/parse.test.ts",
          ]),
        ]);
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "states each ask's want without a path or a line, what happens today, and what is out of scope",
    () =>
      Effect.gen(function* () {
        const { policy } = yield* evaluated;

        expect(
          policy.asks.map(({ brief, id }) => ({
            current: brief.current !== undefined,
            id,
            outOfScope: (brief.outOfScope ?? []).length > 0,
            // A want is behavioural: no file paths, no line numbers.
            wantNamesCode: /\.ts\b|:\d+|\bline \d/u.test(brief.want),
          }))
        ).toStrictEqual(
          ["add-months-clamp", "format-ordinal", "parse-iso-week"].map(
            (id) => ({
              current: true,
              id,
              outOfScope: true,
              wantNamesCode: false,
            })
          )
        );
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "evaluates its visibility.ts into the policy: a sealed maintainers layer of checks for export and parser",
    () =>
      Effect.gen(function* () {
        const { policy } = yield* evaluated;
        const { visibility } = policy;

        expect({
          areas: visibility?.checks?.areas,
          layers: visibility?.layers.map(
            ({ audience, disclose, holds, name, readers, writers }) => ({
              audience,
              disclose,
              holds,
              name,
              readers,
              writers,
            })
          ),
          suite: {
            admit: visibility?.checks?.admit,
            canary: visibility?.checks?.canary,
            layer: visibility?.checks?.layer,
          },
        }).toStrictEqual({
          areas: { export: "src/format.ts", parser: "src/parse.ts" },
          layers: [
            {
              audience: "maintainers",
              disclose: "sealed",
              holds: ["checks", "notes"],
              name: "maintainers",
              readers: "deciders",
              writers: "deciders",
            },
          ],
          suite: {
            admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
            canary: true,
            layer: "maintainers",
          },
        });
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("reads its vouch file: the two maintainers and one contributor", () =>
    Effect.gen(function* () {
      const { policy } = yield* evaluated;

      expect(
        policy.vouches.map(({ denounced, handle }) => ({ denounced, handle }))
      ).toStrictEqual([
        { denounced: false, handle: "bram" },
        { denounced: false, handle: "ines-v" },
        { denounced: false, handle: "okonkwo" },
      ]);
    }).pipe(Effect.provide(bunEvaluator()))
  );
});
