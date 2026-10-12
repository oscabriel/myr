import { describe, expect, it } from "@effect/vitest";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  LayerManifest,
  LedgerEntry,
  SealedChecks,
} from "@repo/protocol/domain/visibility";
import {
  AreaName,
  AskId,
  BlobSha,
  CommitSha,
  LandedSha,
  LayerName,
  RepoPath,
  SuiteRoot,
} from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import { UnstatedRequirement } from "@repo/protocol/refusal";
import { at } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { areaRoots } from "@repo/visibility/commitment";
import { Array as Arr, Effect, Option, Result, Schema } from "effect";

import { ProjectStore } from "../../src/project-store.ts";
import type { ProjectApi } from "../../src/project.ts";
import { AdmissionRun } from "../../src/visibility-port.ts";
import type {
  AdmissionPlan,
  AdmissionReport,
  HeldBackJob,
} from "../../src/visibility-port.ts";
import {
  judgeAdmission,
  planAdmission,
  PushedManifest,
} from "../../src/visibility/admission.ts";
import {
  bob,
  countersigned,
  datekitVisibility,
  firstSuite,
  inesV,
  layerFiles,
  LayerPusher,
  manifestFile,
  project,
  sealedByInes,
  Seen,
  visibilityWorld,
} from "./world.ts";
import type { SealedFile } from "./world.ts";

const maintainers = LayerName.make("maintainers");

const anyone = Anonymous.make({});

const exportArea = AreaName.make("export");

const parserArea = AreaName.make("parser");

const head = CommitSha.make("1".repeat(40));

const main = LandedSha.make("2".repeat(40));

const unescaped = CommitSha.make("3".repeat(40));

const misread = CommitSha.make("4".repeat(40));

const suite = SuiteRoot.make(`sha256:${"5".repeat(64)}`);

const policy = Schema.decodeSync(SealedChecks)({
  admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
  areas: { export: "src/export/**", parser: "src/parser/**" },
  attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
  canary: false,
  commit: "salted-sha256-merkle",
  layer: "maintainers",
  pin: "claim",
  result: "area-bit",
});

const run = Schema.decodeSync(RunBlock)({
  checks: { unit: "bun test" },
  test: "bun test {path}",
});

const utf8 = (text: string) => new TextEncoder().encode(text);

const check = (input: {
  readonly area: string;
  readonly author: string;
  readonly blob: string;
  readonly path: string;
}) => ({
  ...input,
  content: utf8(`it(${JSON.stringify(input.path)}, () => {});\n`),
});

const isoWeek = check({
  area: "parser",
  author: "ines-v",
  blob: "a".repeat(40),
  path: "checks/held-back/parser/iso-week.test.ts",
});

const svgTitle = check({
  area: "export",
  author: "ines-v",
  blob: "b".repeat(40),
  path: "checks/held-back/export/svg-title.test.ts",
});

const csvQuote = check({
  area: "export",
  author: "okonkwo",
  blob: "c".repeat(40),
  path: "checks/held-back/export/csv-quote.test.ts",
});

const manifestOf = (
  checks: readonly ReturnType<typeof check>[],
  knownBad: readonly CommitSha[] = []
) =>
  Schema.decodeUnknownSync(LayerManifest)({
    checks: checks.map(({ area, author, path }) => ({
      area,
      author,
      clause: {
        quote: `${area} keeps its promise`,
        ref: "README.md#promises",
        source: "doc",
      },
      path,
    })),
    knownBad,
    layer: maintainers,
  });

const filesOf = (checks: readonly ReturnType<typeof check>[]) =>
  new Map(
    checks.map(({ blob, content, path }) => [
      path,
      { blob: BlobSha.make(blob), content },
    ])
  );

const blobsOf = (checks: readonly ReturnType<typeof check>[]) =>
  new Map(checks.map(({ blob, path }) => [path, BlobSha.make(blob)]));

const badSvg = { content: utf8("export const svg = (t) => t;\n") };

const badWeek = { content: utf8("export const week = () => 0;\n") };

const twoExportChecks = {
  files: filesOf([isoWeek, svgTitle, csvQuote]),
  head,
  knownBad: new Map([
    [unescaped, [{ ...badSvg, path: RepoPath.make("src/export/svg.ts") }]],
  ]),
  landed: blobsOf([isoWeek]),
  main,
  manifest: manifestOf([isoWeek, svgTitle, csvQuote], [unescaped]),
  policy,
  previous: Option.some(manifestOf([isoWeek])),
  run,
  suite,
};

const jobOf = (
  area: AreaName,
  checks: readonly ReturnType<typeof check>[],
  overlay: readonly {
    readonly content: Uint8Array;
    readonly path: string;
  }[] = []
): HeldBackJob => ({
  areas: [area],
  at: head,
  files: [
    ...overlay.map(({ content, path }) => ({
      area,
      content,
      path: RepoPath.make(path),
    })),
    ...checks.map(({ content, path }) => ({
      area,
      content,
      path: RepoPath.make(path),
    })),
  ],
  runs: checks.map(({ path }) => ({
    area,
    command: `bun test ${path}`,
    path: RepoPath.make(path),
  })),
  suite,
});

const label = (each: AdmissionRun) =>
  AdmissionRun.match(each, {
    OnKnownBad: ({ area, tree }) => `${area} on ${tree}`,
    OnMain: ({ area, attempt }) => `${area} on main #${attempt}`,
  });

const areasRun = (plan: ReturnType<typeof planAdmission>) =>
  Result.map(plan, ({ runs }) => runs.map(label));

describe("a layer push's admission plan", () => {
  it("runs a layer push's changed area on main three times and on each known-bad tree, and leaves an unchanged area alone", () => {
    const plan = planAdmission(twoExportChecks);

    const exportJob = jobOf(exportArea, [csvQuote, svgTitle]);

    expect(plan).toStrictEqual(
      Result.succeed<AdmissionPlan>({
        admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
        head,
        layer: maintainers,
        main,
        run,
        runs: [
          AdmissionRun.cases.OnMain.make({
            area: exportArea,
            attempt: 1,
            job: exportJob,
          }),
          AdmissionRun.cases.OnMain.make({
            area: exportArea,
            attempt: 2,
            job: exportJob,
          }),
          AdmissionRun.cases.OnMain.make({
            area: exportArea,
            attempt: 3,
            job: exportJob,
          }),
          AdmissionRun.cases.OnKnownBad.make({
            area: exportArea,
            job: jobOf(
              exportArea,
              [csvQuote, svgTitle],
              [{ ...badSvg, path: "src/export/svg.ts" }]
            ),
            tree: unescaped,
          }),
        ],
      })
    );
  });

  it("refuses a check that cites no clause as UnstatedRequirement, before planning any run", () => {
    const { clause: _, ...uncited } = Option.getOrThrow(
      Option.fromUndefinedOr(
        twoExportChecks.manifest.checks.find(
          ({ path }) => path === csvQuote.path
        )
      )
    );

    const manifest: PushedManifest = {
      ...twoExportChecks.manifest,
      checks: twoExportChecks.manifest.checks.map((each) =>
        each.path === csvQuote.path ? uncited : each
      ),
    };

    expect(planAdmission({ ...twoExportChecks, manifest })).toStrictEqual(
      Result.fail(new UnstatedRequirement({ area: "export" }))
    );
  });

  it("runs every area a layer's first push holds, and nothing for a push that changes no check", () => {
    const first = planAdmission({
      ...twoExportChecks,
      landed: new Map(),
      previous: Option.none(),
    });

    const unchanged = planAdmission({
      ...twoExportChecks,
      landed: blobsOf([isoWeek, svgTitle, csvQuote]),
      previous: Option.some(twoExportChecks.manifest),
    });

    expect([areasRun(first), areasRun(unchanged)]).toStrictEqual([
      Result.succeed([
        "export on main #1",
        "export on main #2",
        "export on main #3",
        `export on ${unescaped}`,
        "parser on main #1",
        "parser on main #2",
        "parser on main #3",
        `parser on ${unescaped}`,
      ]),
      Result.succeed([]),
    ]);
  });

  it("runs every check of a changed area on main, but only its new or rewritten checks on a known-bad tree", () => {
    const plan = planAdmission({
      ...twoExportChecks,
      landed: blobsOf([isoWeek, svgTitle]),
      previous: Option.some(manifestOf([isoWeek, svgTitle])),
    });

    expect(
      Result.map(plan, ({ runs }) =>
        runs.map((each) => [label(each), each.job.runs.map(({ path }) => path)])
      )
    ).toStrictEqual(
      Result.succeed([
        ["export on main #1", [csvQuote.path, svgTitle.path]],
        ["export on main #2", [csvQuote.path, svgTitle.path]],
        ["export on main #3", [csvQuote.path, svgTitle.path]],
        [`export on ${unescaped}`, [csvQuote.path]],
      ])
    );
  });

  it("runs only the known-bad commits the manifest names and the layer holds, each once", () => {
    const plan = planAdmission({
      ...twoExportChecks,
      knownBad: new Map([
        [unescaped, [{ ...badSvg, path: RepoPath.make("src/export/svg.ts") }]],
        [misread, [{ ...badWeek, path: RepoPath.make("src/parser/week.ts") }]],
      ]),
      manifest: manifestOf(
        [isoWeek, svgTitle, csvQuote],
        [unescaped, unescaped, CommitSha.make("6".repeat(40))]
      ),
    });

    expect(
      Result.map(plan, ({ runs }) =>
        runs.flatMap((each) =>
          AdmissionRun.guards.OnKnownBad(each) ? [each.tree] : []
        )
      )
    ).toStrictEqual(Result.succeed([unescaped]));
  });
});

const planned = Result.getOrThrow(planAdmission(twoExportChecks));

const bits = (area: AreaName, passed: number): HeldBackResult => ({
  area,
  passed,
  suite,
  total: 2,
});

const reported = (onMain: readonly number[], onBad: number) =>
  planned.runs.map((each, index) => ({
    areas: [
      bits(
        exportArea,
        AdmissionRun.guards.OnMain(each) ? (onMain[index] ?? 2) : onBad
      ),
    ],
    run: each,
  }));

const admittedAt = at("2026-10-11T09:00:00Z");

describe("an admission's judgement", () => {
  it("admits an area green on main every time and red on a known-bad tree, with its counts", () => {
    expect(
      judgeAdmission(planned, reported([2, 2, 2], 1), admittedAt)
    ).toStrictEqual({
      admitted: [
        LedgerEntry.cases.Admitted.make({
          area: exportArea,
          at: admittedAt,
          knownBadCaught: 1,
          mainRuns: 3,
          seq: 0,
          suite,
        }),
      ],
      refused: [],
    });
  });

  it("refuses an area red on main once as flaky, and one no known-bad tree turns red as catching nothing, with the run counts", () => {
    expect([
      judgeAdmission(planned, reported([2, 1, 2], 0), admittedAt),
      judgeAdmission(planned, reported([2, 2, 2], 2), admittedAt),
    ]).toStrictEqual([
      {
        admitted: [],
        refused: [
          {
            area: exportArea,
            knownBad: 1,
            knownBadCaught: 1,
            mainPassed: 2,
            mainRuns: 3,
            reason: "flaky",
          },
        ],
      },
      {
        admitted: [],
        refused: [
          {
            area: exportArea,
            knownBad: 1,
            knownBadCaught: 0,
            mainPassed: 3,
            mainRuns: 3,
            reason: "catchesNothing",
          },
        ],
      },
    ]);
  });

  it("decides nothing for an area while one of its runs is unreported", () => {
    expect(
      judgeAdmission(planned, reported([2, 2, 2], 1).slice(1), admittedAt)
    ).toStrictEqual({ admitted: [], refused: [] });
  });

  it("decides the same way for the same plan and runs, replayed", () => {
    const replay = () =>
      judgeAdmission(
        Result.getOrThrow(planAdmission(twoExportChecks)),
        reported([2, 2, 2], 1),
        admittedAt
      );

    expect(replay()).toStrictEqual(replay());
    expect(planAdmission(twoExportChecks)).toStrictEqual(
      planAdmission(twoExportChecks)
    );
  });
});

const admitting = {
  ...datekitVisibility,
  checks: {
    ...Option.getOrThrow(Option.fromUndefinedOr(datekitVisibility.checks)),
    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
  },
};

const parseIso = AskId.make("parse-iso");

const secondSuite: readonly SealedFile[] = firstSuite.map((each) =>
  each.area === "parser"
    ? { ...each, content: 'it("reads ordinal dates", () => {});\n' }
    : each
);

const layerWith = (
  checks: readonly SealedFile[],
  knownBad: readonly CommitSha[],
  uncited: readonly string[] = []
): Files =>
  layerFiles(checks).map(([path, content]) => {
    if (path !== manifestFile) {
      return [path, content] as const;
    }

    const manifest: PushedManifest = Schema.decodeUnknownSync(
      Schema.fromJsonString(PushedManifest)
    )(content);

    return [
      path,
      `${JSON.stringify(
        Schema.encodeSync(PushedManifest)({
          ...manifest,
          checks: manifest.checks.map(({ clause, ...each }) =>
            clause === undefined || uncited.includes(each.path)
              ? each
              : { ...each, clause }
          ),
          knownBad,
        })
      )}\n`,
    ] as const;
  });

const pushed = (
  api: ProjectApi,
  parent: Option.Option<CommitSha>,
  files: Files
) =>
  Effect.gen(function* () {
    const pushedHead = yield* LayerPusher.use((pusher) =>
      pusher.push(parent, files)
    );

    yield* api.recordLayerPush(inesV, {
      head: pushedHead,
      layer: maintainers,
    });

    return pushedHead;
  });

const knownBadCommit = LayerPusher.use((pusher) =>
  pusher.push(
    Option.none(),
    [["src/export/svg.ts", "export const svg = (title) => title;\n"]],
    "Drop the escaping"
  )
);

const reportOf = (
  plan: AdmissionPlan,
  bitOf: (run: AdmissionRun) => number
): AdmissionReport["results"] =>
  plan.runs.map((each) => ({
    areas: [
      {
        area: each.area,
        passed: bitOf(each),
        suite: each.job.suite,
        total: 2,
      },
    ],
    run: each,
  }));

const admissible = (each: AdmissionRun) =>
  AdmissionRun.guards.OnMain(each) ? 2 : 1;

const stored = ProjectStore.use((store) => store.load());

const layerRow = Effect.map(stored, ({ layers }) =>
  Option.getOrThrow(Arr.head(layers))
);

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));

const gitBlobId = (content: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(
        `blob ${new TextEncoder().encode(content).length}\0${content}`
      )
    )
  ).pipe(
    Effect.map((digest) =>
      BlobSha.make(
        [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      )
    )
  );

const rootsUnderStoredSalt = (checks: readonly SealedFile[]) =>
  Effect.gen(function* () {
    const row = yield* layerRow;

    const files = yield* Effect.forEach(checks, ({ area, content, path }) =>
      Effect.map(gitBlobId(content), (blob) => ({
        area: AreaName.make(area),
        blob,
        path: RepoPath.make(path),
      }))
    );

    return yield* areaRoots(fromHex(row.saltRef ?? ""), files);
  });

const admittedFirst = Effect.gen(function* () {
  const { api } = yield* sealedByInes;

  yield* countersigned(api);

  const bad = yield* knownBadCommit;

  const first = yield* pushed(
    api,
    Option.some(bad),
    layerWith(firstSuite, [bad])
  );

  const plan = Option.getOrThrow(
    yield* api.admissionPlan({ head: first, layer: maintainers })
  );

  yield* api.recordAdmission({
    head: first,
    layer: maintainers,
    results: reportOf(plan, admissible),
  });

  return { api, bad, first, plan };
});

describe("admission through the project service", () => {
  it.effect(
    "lands an admitted push under a fresh commitment, appends each area's Admitted entry rooted at it, and pins the next claim to it",
    () =>
      Effect.gen(function* () {
        const { api, bad, first, plan } = yield* admittedFirst;
        const row = yield* layerRow;
        const { claim } = yield* api.claim(bob, parseIso);
        const { entries } = yield* api.ledger(anyone);
        const roots = yield* rootsUnderStoredSalt(firstSuite);
        const rootOf = (area: AreaName) => roots.get(area);

        expect({
          entries: entries.flatMap((entry) => {
            if (LedgerEntry.guards.Admitted(entry)) {
              const { area, knownBadCaught, mainRuns, suite: root } = entry;

              return [["Admitted", area, mainRuns, knownBadCaught, root]];
            }

            return LedgerEntry.guards.CommitmentPublished(entry)
              ? [["CommitmentPublished", entry.area, entry.suite]]
              : [];
          }),
          pinned: claim.suite,
          row: [row.landedSha, row.proposed],
          runs: plan.runs.map(label),
          started: yield* Seen.use(({ admissions }) => admissions),
        }).toStrictEqual({
          entries: [
            ["CommitmentPublished", exportArea, rootOf(exportArea)],
            ["CommitmentPublished", parserArea, rootOf(parserArea)],
            ["Admitted", exportArea, 3, 1, rootOf(exportArea)],
            ["Admitted", parserArea, 3, 1, rootOf(parserArea)],
          ],
          pinned: row.suiteRoot,
          row: [first, undefined],
          runs: [
            "export on main #1",
            "export on main #2",
            "export on main #3",
            `export on ${bad}`,
            "parser on main #1",
            "parser on main #2",
            "parser on main #3",
            `parser on ${bad}`,
          ],
          started: [{ head: first, layer: maintainers, project }],
        });
      }).pipe(Effect.provide(visibilityWorld(admitting)))
  );

  it.effect(
    "keeps the landed suite pinned when a push's area is red on main once, and appends nothing",
    () =>
      Effect.gen(function* () {
        const { api, bad, first } = yield* admittedFirst;
        const before = yield* stored;

        const second = yield* pushed(
          api,
          Option.some(first),
          layerWith(secondSuite, [bad])
        );

        const plan = Option.getOrThrow(
          yield* api.admissionPlan({ head: second, layer: maintainers })
        );

        yield* api.recordAdmission({
          head: second,
          layer: maintainers,
          results: reportOf(plan, (each) =>
            AdmissionRun.guards.OnMain(each) && each.attempt === 2
              ? 1
              : admissible(each)
          ),
        });

        const after = yield* stored;
        const row = yield* layerRow;
        const { claim } = yield* api.claim(bob, parseIso);

        expect({
          ledger: after.ledger.length - before.ledger.length,
          pinned: claim.suite,
          row: [row.landedSha, row.proposed, row.suiteRoot],
          runs: plan.runs.map(label),
        }).toStrictEqual({
          ledger: 0,
          pinned: Option.getOrThrow(Arr.head(before.layers)).suiteRoot,
          row: [
            first,
            second,
            Option.getOrThrow(Arr.head(before.layers)).suiteRoot,
          ],
          runs: [
            "parser on main #1",
            "parser on main #2",
            "parser on main #3",
            `parser on ${bad}`,
          ],
        });
      }).pipe(Effect.provide(visibilityWorld(admitting)))
  );

  it.effect(
    "lands a push that changes no held-back check at once, starting no admission",
    () =>
      Effect.gen(function* () {
        const { api, bad, first } = yield* admittedFirst;

        const rubric = yield* pushed(api, Option.some(first), [
          ...layerWith(firstSuite, [bad]),
          [".agents/maintainers/finish.md", "Escape every title.\n"],
        ]);

        const row = yield* layerRow;

        expect({
          plan: yield* api.admissionPlan({ head: rubric, layer: maintainers }),
          row: [row.landedSha, row.proposed],
          started: (yield* Seen.use(({ admissions }) => admissions)).map(
            ({ head: started }) => started
          ),
        }).toStrictEqual({
          plan: Option.none(),
          row: [rubric, undefined],
          started: [first],
        });
      }).pipe(Effect.provide(visibilityWorld(admitting)))
  );

  it.effect(
    "with admission off, lands a push but keeps a check that cites no clause out of its suite and commitments",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const [svg, csv, iso] = firstSuite;
        const cited = [svg, iso].flatMap((each) => (each ? [each] : []));

        const landed = yield* pushed(
          api,
          Option.none(),
          layerWith(firstSuite, [], [csv?.path ?? ""])
        );

        const row = yield* layerRow;
        const roots = yield* rootsUnderStoredSalt(cited);
        const { entries } = yield* api.ledger(anyone);

        expect({
          committed: entries.flatMap((entry) =>
            LedgerEntry.guards.CommitmentPublished(entry)
              ? [[entry.area, entry.checks, entry.authors, entry.suite]]
              : []
          ),
          row: [row.landedSha, row.proposed],
        }).toStrictEqual({
          committed: [
            [exportArea, 1, 1, roots.get(exportArea)],
            [parserArea, 1, 1, roots.get(parserArea)],
          ],
          row: [landed, undefined],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect(
    "leaves a push whose check cites no clause proposed, planning and starting no run",
    () =>
      Effect.gen(function* () {
        const { api } = yield* sealedByInes;

        yield* countersigned(api);

        const bad = yield* knownBadCommit;

        const uncited = yield* pushed(
          api,
          Option.some(bad),
          layerWith(firstSuite, [bad], [firstSuite[0]?.path ?? ""])
        );

        const row = yield* layerRow;

        expect({
          plan: yield* api.admissionPlan({
            head: uncited,
            layer: maintainers,
          }),
          row: [row.landedSha, row.proposed],
          started: yield* Seen.use(({ admissions }) => admissions),
        }).toStrictEqual({
          plan: Option.none(),
          row: [undefined, uncited],
          started: [],
        });
      }).pipe(Effect.provide(visibilityWorld(admitting)))
  );
});
