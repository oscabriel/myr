import { NodeServices } from "@effect/platform-node";
import { Glob } from "@repo/protocol/domain/common";
import { FromCI, PolicyInput } from "@repo/protocol/domain/policy";
import { LandedSha } from "@repo/protocol/ids";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { defaultPolicyInput } from "../src/defaults.ts";
import { Finishers } from "../src/finish.ts";
import { EvaluationFacts } from "../src/rules-evaluator.ts";
import type { ConfigBundle } from "../src/rules-evaluator.ts";
import { rulesEvaluatorBun } from "../src/rules-evaluator/bun.ts";
import type { BunOptions } from "../src/rules-evaluator/bun.ts";

/**
 * The config folder these bundles hold. A bundle names its own folder (its
 * `entry` is the folder's `project.ts`), so any name serves; the real one
 * lives in `packages/brand`, which `rules` and its tests don't import.
 */
export const configFolder = ".cfg";

/** The vouch file a policy that names none gets: `PolicyInput`'s default. */
export const defaultVouchFile = Schema.decodeSync(PolicyInput)({
  asks: [],
  deciders: [],
  functions: { admit: false, opensAlone: false },
  kinds: [],
  ratchets: [],
  run: FromCI.make({}),
  source: "defaults",
  weakening: { markers: [] },
}).vouch.file;

/** The landed commit every test evaluates at. */
export const at = LandedSha.make("a".repeat(40));

/** The frozen clock the facts carry, as text and in epoch milliseconds. */
export const now = "2026-10-07T12:00:00.000Z";

export const nowMs = "1791374400000";

/**
 * What the platform knows about datekit: two workspace packages, one CI
 * file, a vouch file with a vouch, a denouncement and a handle on another
 * platform, and its initializer.
 */
export const factsEncoded = {
  ci: [{ content: "steps: [bun test]", path: ".github/workflows/ci.yml" }],
  initializer: "olivia",
  now,
  project: "oscabriel/datekit",
  seed: 7,
  vouchFile: "# vouched\npriya\n-mallory Spam\ngitlab:eve\n",
  workspaces: [
    {
      dir: "packages/parse",
      exports: ["packages/parse/src/index.ts"],
      name: "@datekit/parse",
    },
    { dir: "./packages/format/", exports: [], name: "@datekit/format" },
  ],
} satisfies typeof EvaluationFacts.Encoded;

export const facts = Schema.decodeSync(EvaluationFacts)(factsEncoded);

/**
 * Fakes for `checks`' finder and judge closure: the finder finds one lane in
 * any CI, and the closure names the config folder, every CI file, and the
 * run block's test command it was handed.
 */
export const finishers = Finishers.of({
  findRunBlock: (files) => ({
    run: { checks: { unit: "bun test" }, test: "bun test {path}" },
    sources: files.map(({ path }) => path),
  }),
  judgeClosure: (run, files) => ({
    paths: [
      Glob.make(`${configFolder}/**`),
      ...files.map(({ path }) => Glob.make(path)),
    ],
    pointers: ["package.json#/scripts", `test:${run.test}`],
  }),
});

/** The `/bun` adapter over Node, with the fake finishers. */
export const bunEvaluator = (
  options: BunOptions = {},
  finish: Finishers["Service"] = finishers
) =>
  rulesEvaluatorBun(options).pipe(
    Layer.provide(Layer.succeed(Finishers, finish)),
    Layer.provideMerge(NodeServices.layer)
  );

/** A bundle of config-folder files, keyed by their path inside the folder. */
export const bundleOf = (files: Readonly<Record<string, string>>) =>
  ({
    entry: `${configFolder}/project.ts`,
    modules: Object.fromEntries(
      Object.entries(files).map(([file, source]) => [
        `${configFolder}/${file}`,
        source,
      ])
    ),
    sdkVersion: "0.0.0",
  }) satisfies ConfigBundle;

/**
 * A fixture folder under `test/fixtures/`, read into the bundle the Lander
 * makes of a config folder. The folder has no config-folder segment on
 * disk; the bundle's keys get it.
 */
export const folder = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = yield* path.fromFileUrl(
      new URL(`fixtures/${name}`, import.meta.url)
    );

    const files: Record<string, string> = {};

    for (const file of (yield* fs.readDirectory(root, {
      recursive: true,
    })).toSorted()) {
      const full = path.join(root, file);

      if ((yield* fs.stat(full)).type === "File") {
        files[file] = yield* fs.readFileString(full);
      }
    }

    return bundleOf(files);
  });

/** A project module that exports the defaults as config: a base to vary. */
export const baseProject = Effect.map(
  Schema.encodeEffect(PolicyInput)({ ...defaultPolicyInput, source: "config" }),
  (encoded) => `export default ${JSON.stringify(encoded)};\n`
);
