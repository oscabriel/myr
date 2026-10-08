/**
 * datekit's maintainers layer and the seed's layer step: the
 * held-back checks datekit keeps in `layers/maintainers/`, each citing the
 * clause it enforces, and the seed pushing them to the private namespace
 * after the public project, never into the public tree.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Array,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  MAIN_REF,
  planSeed,
  runSeed,
  SeedTarget,
  worldTarget,
} from "../../../scripts/lib/seed.ts";
import type { SeedFile, SeedPlan } from "../../../scripts/lib/seed.ts";
import { stepLine } from "../../../scripts/seed.ts";
import { Brand } from "../../brand/src/index.ts";
import { Client } from "../../protocol/src/contracts.ts";
import {
  LayerManifest,
  LedgerEntry,
  VisibilityPolicy,
} from "../../protocol/src/domain/visibility.ts";
import { Handle, RepoName } from "../../protocol/src/ids.ts";
import { repoRoot } from "./root.ts";

/** The config folder's name, from the brand. */
const config = Brand.configDir;

/** Every file of datekit's maintainers layer, as the layer repo holds it. */
const layerFiles = [
  `${config}/layer.json`,
  `${config}/layer.ts`,
  ".agents/maintainers/finish.md",
  "checks/held-back/export/offsets.test.ts",
  "checks/held-back/export/ordinal-in-patterns.test.ts",
  "checks/held-back/export/pass-through.test.ts",
  "checks/held-back/export/quote-escapes.test.ts",
  "checks/held-back/export/quoted-literals.test.ts",
  "checks/held-back/export/twelve-hour-clock.test.ts",
  "checks/held-back/export/unknown-letters.test.ts",
  "checks/held-back/parser/fraction-digits.test.ts",
  "checks/held-back/parser/never-throws.test.ts",
  "checks/held-back/parser/ordinal-dates.test.ts",
  "checks/held-back/parser/week-bounds.test.ts",
  "known-bad/export.patch",
  "known-bad/parser.patch",
];

describe("planSeed, for a project with a layer", () => {
  it.effect(
    "plans datekit's maintainers layer from layers/maintainers, and keeps layers/ out of main",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/datekit");

        expect(
          plan.layers.map(({ files, layer, repo }) => ({
            files: files.map(({ path }) => path).toSorted(),
            layer,
            repo,
          }))
        ).toStrictEqual([
          {
            files: layerFiles.toSorted(),
            layer: "maintainers",
            repo: "datekit--maintainers",
          },
        ]);

        expect(
          plan.initFiles
            .map(({ path }) => path)
            .filter(
              (path) =>
                path.startsWith("layers/") ||
                path.startsWith("checks/") ||
                path.startsWith(".agents/")
            )
        ).toStrictEqual([]);

        expect(plan.initFiles.map(({ path }) => path)).toContain(
          `${config}/visibility.ts`
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("plans no layer for burrow, which declares none", () =>
    Effect.map(planSeed("examples/burrow"), (plan) => {
      expect(plan.layers).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

// ------------------------------------------------------------- the layer

const example = "examples/datekit";

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** `command` run in `cwd`: how it ended, and both streams. */
const run = (cwd: string, command: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd })
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { code: Number(code), output: `${stdout}\n${stderr}` };
    })
  );

/** A file of the example, as text. */
const exampleFile = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(path.join(yield* repoRoot, example, file));
  });

// Every import of the sdk by the name config files use.
const SDK = new RegExp(`(["'])${Brand.cliPackage}/rules\\1`, "gu");

/**
 * What a config module's default export is, as data: the module run by
 * bun with its sdk import pointed at the sdk's source, as the rules
 * evaluator's `/bun` adapter runs config code, then printed as JSON.
 */
const defaultExportOf = (source: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sdk = path.join(yield* repoRoot, "packages/sdk/src/index.ts");
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "layer-608-" });

      yield* fs.writeFileString(
        path.join(dir, "module.ts"),
        source.replaceAll(SDK, JSON.stringify(sdk))
      );

      yield* fs.writeFileString(
        path.join(dir, "main.ts"),
        'import data from "./module.ts";\nprocess.stdout.write(JSON.stringify(data));\n'
      );

      const ran = yield* run(dir, "bun", ["main.ts"]);

      // What bun said shows only when it failed.
      expect({
        code: ran.code,
        said: ran.code === 0 ? "" : ran.output,
      }).toStrictEqual({ code: 0, said: "" });

      return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
        ran.output.split("\n")[0] ?? ""
      );
    })
  );

/** The layer's file at `file`, as text. */
const inLayer = (plan: SeedPlan, file: string) =>
  new TextDecoder().decode(
    plan.layers[0]?.files.find(({ path }) => path === file)?.content
  );

/** datekit's plan, its maintainers layer, the manifest and the policy. */
const datekit = Effect.gen(function* () {
  const plan = yield* planSeed(example);
  const layer = yield* Effect.fromNullishOr(plan.layers[0]);

  const manifest = yield* Schema.decodeUnknownEffect(LayerManifest)(
    yield* defaultExportOf(inLayer(plan, `${config}/layer.ts`))
  );

  const policy = yield* Schema.decodeUnknownEffect(VisibilityPolicy)(
    yield* defaultExportOf(yield* exampleFile(`${config}/visibility.ts`))
  );

  return { layer, manifest, plan, policy };
});

/** The lanes datekit's `project.ts` runs on every answer: the public checks, by name. */
const publicLanes = Effect.gen(function* () {
  const { run: block } = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      run: Schema.Struct({
        checks: Schema.Record(Schema.String, Schema.String),
      }),
    })
  )(yield* defaultExportOf(yield* exampleFile(`${config}/project.ts`)));

  return Object.entries(block.checks);
});

/** A heading's anchor, as a README link names it: `## Format patterns` is `format-patterns`. */
const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replaceAll(/[^\w\s-]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-");

/** Each README section's text by its anchor: from its heading to the next. */
const sectionsOf = (readme: string) => {
  const sections = new Map<string, string>();
  let current = "";

  for (const line of readme.split("\n")) {
    const heading = /^#{1,6}\s+(?<title>.+)$/u.exec(line)?.groups?.title;

    if (heading === undefined) {
      sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
    } else {
      current = anchorOf(heading);
      sections.set(current, "");
    }
  }

  return sections;
};

describe("datekit's maintainers layer", () => {
  it.live(
    "states its manifest in layer.ts, as layer.json states it for the platform",
    () =>
      Effect.gen(function* () {
        const { manifest, plan } = yield* datekit;

        const stated = yield* Schema.decodeEffect(
          Schema.fromJsonString(LayerManifest)
        )(inLayer(plan, `${config}/layer.json`));

        expect(stated).toStrictEqual(manifest);
        expect(manifest.layer).toBe("maintainers");
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "holds seven export checks by three people and four parser checks, each a file of the layer in an area visibility.ts declares",
    () =>
      Effect.gen(function* () {
        const { layer, manifest, policy } = yield* datekit;
        const paths = new Set<string>(layer.files.map(({ path }) => path));

        const byArea = Object.fromEntries(
          Object.keys(policy.checks?.areas ?? {}).map((area) => {
            const checks = manifest.checks.filter(
              (check) => check.area === area
            );

            return [
              area,
              {
                authors: Array.dedupe(checks.map(({ author }) => author))
                  .length,
                checks: checks.length,
              },
            ];
          })
        );

        expect(byArea).toStrictEqual({
          export: { authors: 3, checks: 7 },
          parser: { authors: 3, checks: 4 },
        });

        expect(
          manifest.checks.filter(({ path }) => !paths.has(path))
        ).toStrictEqual([]);

        expect({
          holds: policy.layers.map(({ disclose, holds, name }) => ({
            disclose,
            holds,
            name,
          })),
          suite: policy.checks?.layer,
        }).toStrictEqual({
          holds: [
            {
              disclose: "sealed",
              holds: ["checks", "notes"],
              name: "maintainers",
            },
          ],
          suite: "maintainers",
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "cites for each check a clause its source says word for word: an ask's want, or a README section",
    () =>
      Effect.gen(function* () {
        const { manifest } = yield* datekit;
        const readme = sectionsOf(yield* exampleFile("README.md"));

        const unquoted = yield* Effect.filter(manifest.checks, ({ clause }) =>
          Effect.gen(function* () {
            if (clause.source === "ask") {
              const ask = yield* exampleFile(
                `${config}/asks/${clause.ref}.ask.ts`
              ).pipe(Effect.flatMap(defaultExportOf));

              const { brief } = yield* Schema.decodeUnknownEffect(
                Schema.Struct({ brief: Schema.Struct({ want: Schema.String }) })
              )(ask);

              return !brief.want.includes(clause.quote);
            }

            const [file, anchor = ""] = clause.ref.split("#");

            return (
              file !== "README.md" ||
              !(readme.get(anchor) ?? "").includes(clause.quote)
            );
          })
        );

        expect(unquoted).toStrictEqual([]);

        // Both kinds of source are cited.
        expect(
          Array.dedupe(
            manifest.checks.map(({ clause }) => clause.source)
          ).toSorted()
        ).toStrictEqual(["ask", "doc"]);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "carries one canary line in every held-back check, as visibility.ts promises",
    () =>
      Effect.gen(function* () {
        const { manifest, plan, policy } = yield* datekit;

        const canaries = Array.dedupe(
          manifest.checks.map(
            ({ path }) =>
              /canary GUID (?<guid>[\da-f-]{36})/u.exec(
                inLayer(plan, path).split("\n")[0] ?? ""
              )?.groups?.guid ?? "none"
          )
        );

        expect({
          canaries: canaries.length,
          canary: policy.checks?.canary,
        }).toStrictEqual({
          canaries: 1,
          canary: true,
        });
        expect(canaries).not.toContain("none");
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});

/** A folder holding `trees` one over another, each file at its path. */
const treeOf = (...trees: readonly (readonly SeedFile[])[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tree-608-" });

    for (const { content, path: file } of trees.flat()) {
      yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
        recursive: true,
      });
      yield* fs.writeFile(path.join(dir, file), content);
    }

    return dir;
  });

describe("datekit's held-back checks, run", () => {
  it.live(
    "pass on main, every one of them",
    () =>
      Effect.gen(function* () {
        const { layer, manifest, plan } = yield* datekit;
        const dir = yield* treeOf(plan.initFiles, layer.files);
        const ran = yield* run(dir, "bun", ["test", "./checks/held-back"]);

        expect({
          code: ran.code,
          files: /Ran \d+ tests? across (?<files>\d+) files?/u.exec(ran.output)
            ?.groups?.files,
        }).toStrictEqual({
          code: 0,
          files: String(manifest.checks.length),
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "fail in their area on each known-bad tree, which every public lane passes",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* datekit;
        const lanes = yield* publicLanes;

        const runs = yield* Effect.forEach(
          layer.knownBad,
          ({ branch, files }) =>
            Effect.gen(function* () {
              const area = branch.replace(/^known-bad\//u, "");
              const bad = yield* treeOf(files);
              const overlaid = yield* treeOf(files, layer.files);

              const held = yield* run(overlaid, "bun", [
                "test",
                `./checks/held-back/${area}`,
              ]);

              // Each lane as the Checker runs it: its command under `sh -c`.
              const failedLanes = yield* Effect.filter(lanes, ([, command]) =>
                Effect.map(
                  run(bad, "sh", ["-c", command]),
                  ({ code }) => code !== 0
                )
              );

              return {
                area,
                failedLanes: failedLanes.map(([lane]) => lane),
                heldBackFailed:
                  held.code !== 0 && /\(fail\)/u.test(held.output),
              };
            })
        );

        expect(lanes.map(([lane]) => lane)).toStrictEqual(["unit"]);
        expect(runs).toStrictEqual([
          { area: "export", failedLanes: [], heldBackFailed: true },
          { area: "parser", failedLanes: [], heldBackFailed: true },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000
  );
});

// ------------------------------------------------------------- the world

/** A vouched contributor to datekit, who reads no layer. */
const bram = Handle.make("bram");

/** Paths a public tree must never hold: the layer's, or the example's folder of layers. */
const isLayerPath = (path: string) =>
  ["layers/", "checks/held-back/", ".agents/maintainers/"].some((prefix) =>
    path.startsWith(prefix)
  );

describe("runSeed, for a project with a layer", () => {
  it.live(
    "pushes datekit's maintainers layer to the private namespace as ines-v after the public project, out of a contributor's reach and the public tree, and a second run finds it done",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed(example);
        const layer = yield* Effect.fromNullishOr(plan.layers[0]);
        const project = RepoName.make(plan.project);

        const story = Effect.gen(function* () {
          const target = yield* SeedTarget;
          const first = yield* runSeed(plan);

          expect(first.map(stepLine)).toStrictEqual([
            "Init datekit: done",
            "Push datekit: done",
            "OpenAsk datekit/add-months-clamp: done",
            "OpenAsk datekit/format-ordinal: done",
            "OpenAsk datekit/parse-iso-week: done",
            "Layer datekit--maintainers: done",
          ]);

          // A maintainer's clone: the layer's files on main, and a branch
          // for each known-bad commit its manifest names.
          const refs = yield* Effect.flatMap(
            target.refsAt(layer.repo, plan.decider),
            Effect.fromOption
          );

          const held = yield* target.pathsAt(
            layer.repo,
            MAIN_REF,
            plan.decider
          );

          expect({
            knownBad: Object.fromEntries(
              [...refs].filter(([ref]) =>
                ref.startsWith("refs/heads/known-bad/")
              )
            ),
            paths: held.toSorted(),
            refs: [...refs.keys()].toSorted(),
          }).toStrictEqual({
            knownBad: Object.fromEntries(
              layer.knownBad.map(({ branch, commit }) => [
                `refs/heads/${branch}`,
                commit,
              ])
            ),
            paths: layer.files.map(({ path }) => path).toSorted(),
            refs: [
              "HEAD",
              "refs/heads/known-bad/export",
              "refs/heads/known-bad/parser",
              MAIN_REF,
            ].toSorted(),
          });

          // A contributor's clone of the layer is turned away, and the
          // public tree holds visibility.ts and nothing of the layer.
          const refused = yield* Effect.flip(target.refsAt(layer.repo, bram));

          const published = yield* target.pathsAt(
            project,
            MAIN_REF,
            target.operator
          );

          expect({
            contributor: /\b403\b/u.test(refused.reason) ? 403 : refused.reason,
            layerPaths: published.filter(isLayerPath),
            visibility: published.some(
              (path) => path === `${config}/visibility.ts`
            ),
          }).toStrictEqual({
            contributor: 403,
            layerPaths: [],
            visibility: true,
          });

          // The public ledger declares the layer and the posture its
          // config states. (Each area's counts are published when its
          // checks are admitted: 615.)
          const ledger = yield* Client.use((client) =>
            client.ledger({ project: plan.project })
          ).pipe(Effect.provide(target.clientFor(bram)));

          expect({
            declared: ledger.entries
              .filter(LedgerEntry.guards.LayerDeclared)
              .map(({ disclose, kinds, layer: name }) => ({
                disclose,
                kinds,
                name,
              })),
            layers: ledger.layers.map(({ name }) => name),
            posture: ledger.postureLabel,
          }).toStrictEqual({
            declared: [
              {
                disclose: "sealed",
                kinds: ["checks", "notes"],
                name: "maintainers",
              },
            ],
            layers: ["maintainers"],
            posture:
              "Open with sealed evidence · sealed checks in export, parser",
          });

          // A second run finds every step done and moves no ref.
          const again = yield* runSeed(plan);
          const after = yield* target.refsAt(layer.repo, plan.decider);

          expect({
            refs: Option.map(after, (listed) => [...listed]),
            steps: again.map(stepLine),
          }).toStrictEqual({
            refs: Option.some([...refs]),
            steps: first
              .map(stepLine)
              .map((line) => line.replace(/: done$/u, ": already")),
          });
        });

        yield* story.pipe(
          Effect.provide(
            worldTarget([plan.decider, bram]).pipe(
              Layer.provide(NodeServices.layer)
            )
          )
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});
