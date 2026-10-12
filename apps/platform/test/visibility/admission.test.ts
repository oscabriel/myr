import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob, HeldBackPart } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import {
  AdmissionStarts,
  ProjectVisibilityLive,
} from "@repo/project/visibility/state";
import type { HeldBackResult, LaneResult } from "@repo/protocol/domain/answer";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  AskId,
  CommitSha,
  LaneName,
  LayerName,
  ProjectName,
  RepoName,
  keyOf,
  RepoPath,
} from "@repo/protocol/ids";
import { LayerRepos } from "@repo/visibility/layer-repos";
import type { Context } from "effect";
import { Array, Effect, FileSystem, Layer, Order } from "effect";

import { AdmissionParams } from "../../src/answer-runs.ts";
import type { WorkerPorts } from "../../src/ports.ts";
import { LayerGateLive } from "../../src/visibility/layers.ts";
import { WebCryptoSalts } from "../../src/visibility/state.ts";
import { admissionSteps } from "../../src/workflows/admission-steps.ts";
import { memoSteps } from "../../src/workflows/step.ts";
import type { StepRunner } from "../../src/workflows/step.ts";
import { coreLoopWorld } from "../world.ts";

const project = ProjectName.make("ines-v/datekit");

const maintainers = LayerName.make("maintainers");

const layerRepo = RepoName.make(`${keyOf(project)}--${maintainers}`);

const tokens = {
  bram: "bram-admission-token-0123456789abcdef",
  "ines-v": "ines-v-admission-token-0123456789abcdef",
  okonkwo: "okonkwo-admission-token-0123456789abcdef",
} as const;

const sdk = `${Brand.cliPackage}/rules`;

const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: "bram\nines-v\nokonkwo\n",
  [`${Brand.configDir}/visibility.ts`]: [
    `import { flows, layer, sealedChecks, visibility } from "${sdk}";`,
    ``,
    `export default visibility({`,
    `  checks: sealedChecks({`,
    `    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },`,
    `    areas: { export: "src/export/**", parser: "src/parser/**" },`,
    `  }),`,
    `  flows: flows.noWriteDown(),`,
    `  layers: {`,
    `    maintainers: layer({`,
    `      disclose: "sealed",`,
    `      holds: ["checks", "notes"],`,
    `      reason: "Held-back checks for export and parser",`,
    `    }),`,
    `  },`,
    `});`,
    ``,
  ].join("\n"),
  "package.json": '{ "name": "ines-v/datekit", "private": true }\n',
  "src/export/svg.ts":
    'export const svg = (title: string) => title.replaceAll("<", "&lt;");\n',
  "src/parser/week.ts": "export const week = (iso: string) => 1;\n",
};

const checkFile = (area: string, name: string, body: string) =>
  [
    `checks/held-back/${area}/${name}.test.ts`,
    `import { it } from "bun:test";\n\nit(${JSON.stringify(body)}, () => {});\n`,
  ] as const;

const svgTitle = checkFile("export", "svg-title", "escapes titles");

const csvQuote = checkFile("export", "csv-quote", "quotes cells");

const isoWeek = checkFile("parser", "iso-week", "reads week dates");

const ordinal = checkFile("parser", "iso-week", "reads ordinal dates");

const layerTree = (
  checks: readonly (readonly [string, string])[],
  knownBad: readonly CommitSha[]
) => ({
  ...Object.fromEntries(checks),
  [`${Brand.configDir}/layer.json`]: `${JSON.stringify({
    checks: checks.map(([path]) => ({
      area: path.split("/")[2],
      author: "ines-v",
      clause: {
        quote: "Titles are escaped wherever they are exported",
        ref: "README.md#export",
        source: "doc",
      },
      path,
    })),
    knownBad,
    layer: maintainers,
  })}\n`,
});

const unescaped = "src/export/svg.ts";

const redThenGreen = LaneName.make("redThenGreen");

const askFiles = (ask: AskId) =>
  Array.make(
    {
      content: [
        `import { kinds, territory } from "${sdk}";`,
        ``,
        `export default kinds.fix.ask({`,
        `  path: "test/${ask}.test.ts",`,
        `  territory: territory.paths("src/**"),`,
        `  want: "titles stay escaped",`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`),
    },
    {
      content: 'it("escapes", () => { throw new Error("red"); });\n',
      path: RepoPath.make(`test/${ask}.test.ts`),
    }
  );

const admissionWorld = Effect.gen(function* () {
  const jobs: CheckJob[] = [];
  const script = new Map<string, readonly LaneResult[]>();
  const queued: AdmissionParams[] = [];
  const stores: RepoHost["Service"][] = [];
  const captured: Context.Context<WorkerPorts>[] = [];
  const mainRuns = new Map<string, number>();
  const redOnMain = new Set<string>();

  const bitsOf = (part: HeldBackPart): readonly HeldBackResult[] =>
    part.areas.map((area) => {
      const total = part.runs.filter((run) => run.area === area).length;
      const knownBad = part.files.some(({ path }) => path === unescaped);
      const nth = knownBad ? 0 : (mainRuns.get(area) ?? 0) + 1;

      if (!knownBad) {
        mainRuns.set(area, nth);
      }

      const flaky = redOnMain.has(`${area} on main #${nth}`);

      return {
        area,
        passed: knownBad || flaky ? total - 1 : total,
        suite: part.suite,
        total,
      };
    });

  const checker = Layer.effect(
    CheckRunner,
    Effect.map(
      Effect.provide(
        Effect.service(CheckRunner),
        CheckRunnerMemory.layer(script)
      ),
      (lanes) =>
        CheckRunner.of({
          run: (job) => {
            const part = job.heldBack;

            return part === undefined
              ? lanes.run(job)
              : Effect.sync(() => {
                  jobs.push(job);

                  return {
                    durationMs: 1,
                    evidence: [],
                    heldBack: bitsOf(part),
                    lanes: [],
                  };
                });
          },
        })
    )
  );

  const world = yield* coreLoopWorld({
    checker: () => checker,
    plugIn: (store) => {
      stores.push(store);

      const layers = Layer.succeed(LayerRepos, LayerRepos.of(store));

      return {
        project: ProjectVisibilityLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              layers,
              WebCryptoSalts,
              Layer.succeed(
                AdmissionStarts,
                AdmissionStarts.of({
                  start: (input) =>
                    Effect.sync(() => {
                      queued.push(AdmissionParams.make(input));
                    }),
                })
              )
            )
          )
        ),
        worker: Layer.mergeAll(
          LayerGateLive.pipe(Layer.provide(layers)),
          Layer.effectDiscard(
            Effect.map(Effect.context<WorkerPorts>(), (ports) => {
              captured.push(ports);
            })
          )
        ),
      };
    },
    sessions: Object.fromEntries(
      Object.entries(tokens).map(([handle, token]) => [token, handle])
    ),
  });

  const ports = yield* Effect.fromNullishOr(captured[0]);
  const ines = yield* world.person("ines-v");
  const bram = yield* world.person("bram");

  const made = yield* ines.rpc.initProject({ project });
  const home = yield* ines.git.clone(made.remote);

  yield* ines.git.commit(home, "Start datekit", start);
  yield* ines.git.ok(home, "push", "--quiet", "origin", "HEAD:main");

  const admit = (params: AdmissionParams, steps: Layer.Layer<StepRunner>) =>
    admissionSteps(params).pipe(
      Effect.provide(Layer.merge(Layer.succeedContext(ports), steps))
    );

  const openAsk = (ask: AskId) =>
    Effect.gen(function* () {
      const files = askFiles(ask);

      const red: LaneResult = {
        command: "run redThenGreen",
        durationMs: 1,
        lane: redThenGreen,
        result: "failed",
      };

      script.set(
        scriptKey(
          CheckAt.cases.Commit.make({
            commit: yield* world.composed(project, files),
          }),
          redThenGreen
        ),
        [red, red]
      );

      yield* ines.rpc.openAsk({ ask, files, project });
    });

  return {
    admit,
    bram,
    ines,
    jobs,
    openAsk,
    queued,
    redOnMain,
    stores,
    world,
  };
});

describe("admission of a layer push's held-back checks", () => {
  it.live(
    "admits a push green on main three times and red on its known-bad tree, pins later claims to its new commitment, and keeps that suite when the next push is red on main",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const { admit, bram, ines, jobs, openAsk, queued, redOnMain, world } =
          yield* admissionWorld;

        const layerUrl = `${world.origin}/${project}--maintainers.git`;
        const outside = yield* fs.makeTempDirectoryScoped();

        const bad = `${outside}/known-bad`;

        yield* ines.git.ok(
          outside,
          "init",
          "--quiet",
          "--initial-branch=known-bad",
          bad
        );

        const knownBad = yield* ines.git.commit(bad, "Drop the escaping", {
          [unescaped]: "export const svg = (title: string) => title;\n",
        });

        yield* ines.git.ok(
          bad,
          "push",
          "--quiet",
          layerUrl,
          "HEAD:refs/heads/known-bad"
        );

        const suite = `${outside}/suite`;

        yield* ines.git.ok(
          outside,
          "init",
          "--quiet",
          "--initial-branch=main",
          suite
        );

        const first = yield* ines.git.commit(
          suite,
          "Seal export and parser",
          layerTree([svgTitle, csvQuote, isoWeek], [knownBad])
        );

        yield* ines.git.ok(suite, "push", "--quiet", layerUrl, "HEAD:main");

        const started = [...queued];

        const main = CommitSha.make(
          (yield* ines.git.ok(
            outside,
            "ls-remote",
            `${world.origin}/${project}.git`,
            "refs/heads/main"
          )).split("\t")[0] ?? ""
        );

        expect(started).toStrictEqual([
          AdmissionParams.make({ head: first, layer: maintainers, project }),
        ]);

        const steps = yield* memoSteps();

        yield* admit(
          AdmissionParams.make({ head: first, layer: maintainers, project }),
          steps
        );

        const ledger = yield* world.rpc("anonymous").ledger({ project });

        const settled = ledger.entries.flatMap((entry) => {
          if (LedgerEntry.guards.Admitted(entry)) {
            const { area, knownBadCaught, mainRuns, suite: root } = entry;

            return [["Admitted", area, mainRuns, knownBadCaught, root]];
          }

          if (LedgerEntry.guards.CommitmentPublished(entry)) {
            const { area, authors, checks, suite: root } = entry;

            return [["CommitmentPublished", area, checks, authors, root]];
          }

          return [];
        });

        const roots = new Map(
          ledger.entries.flatMap((entry) =>
            LedgerEntry.guards.CommitmentPublished(entry)
              ? [[entry.area, entry.suite] as const]
              : []
          )
        );

        const rootOf = (area: string) => roots.get(AreaName.make(area));

        const ran = jobs.map((job) => ({
          areas: job.heldBack?.areas,
          at: job.at,
          files: job.heldBack?.files.map(({ path }) => path),
          lanes: job.lanes,
          repo: job.repo,
        }));

        const exportFiles = [csvQuote[0], svgTitle[0]];

        expect({
          ran: Array.sort(
            ran.map(({ areas, files }) => JSON.stringify([areas, files])),
            Order.String
          ),
          sealedNames: JSON.stringify(ledger).includes("held-back"),
          sentLayer: jobs.some((job) =>
            JSON.stringify({ ...job, heldBack: undefined }).includes(layerRepo)
          ),
          settled,
          where: Array.dedupe(
            ran.map(({ at, lanes, repo }) =>
              JSON.stringify({ at, lanes, repo })
            )
          ),
        }).toStrictEqual({
          ran: Array.sort(
            [
              [["export"], exportFiles],
              [["export"], exportFiles],
              [["export"], exportFiles],
              [["export"], [unescaped, ...exportFiles]],
              [["parser"], [isoWeek[0]]],
              [["parser"], [isoWeek[0]]],
              [["parser"], [isoWeek[0]]],
              [["parser"], [unescaped, isoWeek[0]]],
            ].map((each) => JSON.stringify(each)),
            Order.String
          ),
          sealedNames: false,
          sentLayer: false,
          settled: [
            ["CommitmentPublished", "export", 2, 1, rootOf("export")],
            ["CommitmentPublished", "parser", 1, 1, rootOf("parser")],
            ["Admitted", "export", 3, 1, rootOf("export")],
            ["Admitted", "parser", 3, 1, rootOf("parser")],
          ],
          where: [
            JSON.stringify({
              at: CheckAt.cases.Commit.make({ commit: main }),
              lanes: [],
              repo: keyOf(project),
            }),
          ],
        });

        const firstAsk = AskId.make("keep-titles");

        yield* openAsk(firstAsk);

        const { claim: bramsClaim } = yield* bram.rpc.claim({
          ask: firstAsk,
          project,
        });

        const second = yield* ines.git.commit(
          suite,
          "Read ordinal dates",
          layerTree([svgTitle, csvQuote, ordinal], [knownBad])
        );

        const jobsBefore = jobs.length;

        redOnMain.add("parser on main #5");

        yield* ines.git.ok(suite, "push", "--quiet", layerUrl, "HEAD:main");
        yield* admit(
          AdmissionParams.make({ head: second, layer: maintainers, project }),
          yield* memoSteps()
        );

        const secondAsk = AskId.make("keep-weeks");

        yield* openAsk(secondAsk);

        const { claim: inesClaim } = yield* ines.rpc.claim({
          ask: secondAsk,
          project,
        });

        const after = yield* world.rpc("anonymous").ledger({ project });

        yield* admit(
          AdmissionParams.make({ head: first, layer: maintainers, project }),
          steps
        );
        yield* admit(
          AdmissionParams.make({ head: first, layer: maintainers, project }),
          yield* memoSteps()
        );

        const replayed = yield* world.rpc("anonymous").ledger({ project });

        expect({
          after: after.entries.length,
          bramsSuite: bramsClaim.suite !== undefined,
          inesSuite: inesClaim.suite,
          queued: queued.map(({ head }) => head),
          replayed: replayed.entries.length,
          secondRuns: jobs.slice(jobsBefore).map((job) => job.heldBack?.areas),
        }).toStrictEqual({
          after: ledger.entries.length,
          bramsSuite: true,
          inesSuite: bramsClaim.suite,
          queued: [first, second],
          replayed: ledger.entries.length,
          secondRuns: [["parser"], ["parser"], ["parser"], ["parser"]],
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
