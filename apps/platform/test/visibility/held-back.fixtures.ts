import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob, CheckRun } from "@repo/checks/check-runner";
import { noEnv, ProjectEnv } from "@repo/project/env-port";
import type { EnvPort } from "@repo/project/env-port";
import type { AttemptRow } from "@repo/project/project-store/rows";
import { noVisibility, ProjectVisibility } from "@repo/project/visibility-port";
import type {
  HeldBackJob,
  VisibilityPort,
} from "@repo/project/visibility-port";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AreaName,
  CommitSha,
  LayerName,
  RepoName,
  RepoPath,
  keyOf,
  SuiteRoot,
} from "@repo/protocol/ids";
import { Principal } from "@repo/protocol/principal";
import {
  AttemptsExhausted,
  HeldBackFailed,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import { gitClient } from "@repo/testkit/git-client";
import { heldBackValue } from "@repo/visibility/commitment";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { scanBytes, scanText } from "@repo/visibility/leak-scan";
import type { Watched } from "@repo/visibility/leak-scan";
import {
  Array,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";

import { LandingGuardsLive } from "../../src/visibility/held-back.ts";
import { alice, project, worldWith } from "../workflows/answer.fixtures.ts";

export const maintainers = LayerName.make("maintainers");

export const layerRepo = RepoName.make(`${keyOf(project)}--maintainers`);

export const exportArea = AreaName.make("export");

export const parserArea = AreaName.make("parser");

interface SealedFile {
  readonly area: AreaName;
  readonly path: RepoPath;
  readonly content: string;
}

export const sealedFiles: readonly SealedFile[] = [
  {
    area: exportArea,
    content:
      'it("escapes a title", () => expect(svg("<")).toContain("&lt;"));\n',
    path: RepoPath.make("checks/held-back/export/escape.test.ts"),
  },
  {
    area: exportArea,
    content: 'it("keeps a link", () => expect(svg("a")).toContain("href"));\n',
    path: RepoPath.make("checks/held-back/export/link.test.ts"),
  },
  {
    area: parserArea,
    content:
      'it("reads a week", () => expect(parse("2026-W41")).toBeDefined());\n',
    path: RepoPath.make("checks/held-back/parser/week.test.ts"),
  },
];

export const layerAt = CommitSha.make("e".repeat(40));

export const suiteRoot = SuiteRoot.make(`sha256:${"3f".repeat(32)}`);

const testCommand = (path: RepoPath) => `bun test ${path}`;

const encoder = new TextEncoder();

export const heldBackJob: HeldBackJob = {
  areas: [exportArea, parserArea],
  at: layerAt,
  files: sealedFiles.map(({ area, content, path }) => ({
    area,
    content: encoder.encode(content),
    path,
  })),
  runs: sealedFiles.map(({ area, path }) => ({
    area,
    command: testCommand(path),
    path,
  })),
  suite: suiteRoot,
};

const ATTEMPTS = 3;

const isoWeek = "2026-W41";

export const resetsAt = DateTime.makeUnsafe("2026-10-12T00:00:00Z");

const attemptsOn = (
  rows: readonly AttemptRow[],
  claim: { readonly ask: string; readonly claimant: string },
  area: AreaName
) =>
  rows
    .filter(
      (row) =>
        row.ask === claim.ask &&
        row.claimant === claim.claimant &&
        row.area === area
    )
    .reduce((sum, row) => sum + row.count, 0);

export class Sealed extends Context.Service<
  Sealed,
  {
    readonly blocked: Ref.Ref<boolean>;
    readonly failing: Ref.Ref<ReadonlySet<AreaName>>;
    readonly jobs: Ref.Ref<readonly CheckJob[]>;
    readonly layerPaths: Ref.Ref<ReadonlySet<RepoPath>>;
    readonly judged: Effect.Effect<number>;
  }
>()("test/Sealed") {}

const visibilityOver = (
  sealed: Sealed["Service"],
  judged: { count: number }
): VisibilityPort => ({
  ...noVisibility,
  access: (who, layer) =>
    layer === maintainers
      ? Option.some(
          Principal.guards.Person(who) && who.handle === alice.handle
            ? "write"
            : "none"
        )
      : Option.none(),
  heldBackJob: () => Effect.succeed(Option.some(heldBackJob)),
  judgeHeldBack: (input, snapshot) => {
    judged.count += 1;

    const failed = input.results.filter(({ passed, total }) => passed < total);

    const counted = failed.map((result) => ({
      count: attemptsOn(snapshot.attempts, input, result.area) + 1,
      result,
    }));

    return {
      refusals: counted.map(({ count, result }) =>
        count >= ATTEMPTS
          ? new AttemptsExhausted({ area: result.area, resetsAt })
          : new HeldBackFailed({ area: result.area, suite: result.suite })
      ),
      trailer: Array.isReadonlyArrayEmpty(failed)
        ? heldBackValue({ areas: heldBackJob.areas, results: input.results })
        : Option.none(),
      writes: {
        attempts: counted.map(({ count, result }): AttemptRow => ({
          area: result.area,
          ask: input.ask,
          claimant: input.claimant,
          count,
          week: isoWeek,
        })),
      },
    };
  },
  layerPaths: () => Ref.get(sealed.layerPaths),
  ledger: (named) => ({
    entries: [],
    layers: [
      {
        audience: "maintainers",
        disclose: "sealed",
        holds: ["checks"],
        name: maintainers,
        readers: "deciders",
        reason: "Sealed checks hold answers to the ask's words.",
        repo: layerRepo,
        writers: "deciders",
      },
    ],
    posture: "open",
    postureLabel: "Open with sealed evidence",
    project: named,
  }),
  pinSuite: () => Option.some({ at: layerAt, suite: suiteRoot }),
  readableLayers: (who) =>
    Principal.guards.Person(who) && who.handle === alice.handle
      ? new Set([maintainers])
      : new Set(),
});

const KeptValue = Schema.Struct({ fake: Schema.String });

const envPort: EnvPort = {
  ...noEnv,
  scan: (scanned, snapshot) =>
    Effect.sync(() => {
      const watched = snapshot.envValues.flatMap((row) =>
        Option.toArray(
          Option.map(
            Schema.decodeUnknownOption(KeptValue)(row.sealed),
            ({ fake }): Watched => ({
              key: row.key,
              value: Redacted.make(fake),
            })
          )
        )
      );

      return "text" in scanned
        ? scanText(scanned.text, watched)
        : scanBytes(scanned.blob, watched);
    }),
  set: (input) =>
    Effect.succeed({
      result: { key: input.key, setAt: input.now, setBy: input.by.handle },
      writes: {
        envValues: [
          {
            key: input.key,
            sealed: { fake: Redacted.value(input.value) },
            setAt: input.now,
            setBy: input.by.handle,
          },
        ],
      },
    }),
};

const fakes = Layer.effectContext(
  Effect.gen(function* () {
    const judged = { count: 0 };

    const sealed: Sealed["Service"] = {
      blocked: yield* Ref.make(false),
      failing: yield* Ref.make<ReadonlySet<AreaName>>(new Set()),
      jobs: yield* Ref.make<readonly CheckJob[]>([]),
      judged: Effect.sync(() => judged.count),
      layerPaths: yield* Ref.make<ReadonlySet<RepoPath>>(
        new Set(sealedFiles.map(({ path }) => path))
      ),
    };

    return Context.make(ProjectVisibility, visibilityOver(sealed, judged)).pipe(
      Context.add(ProjectEnv, envPort),
      Context.add(Sealed, sealed)
    );
  })
);

const bitsOf = (
  job: HeldBackJob,
  failing: ReadonlySet<AreaName>
): readonly HeldBackResult[] =>
  job.areas.map((area) => {
    const total = job.runs.filter((each) => each.area === area).length;

    return {
      area,
      passed: failing.has(area) ? total - 1 : total,
      suite: job.suite,
      total,
    };
  });

const sealedChecker = Layer.effect(
  CheckRunner,
  Effect.gen(function* () {
    const inner = yield* CheckRunner;
    const sealed = yield* Sealed;

    return CheckRunner.of({
      run: (job) =>
        job.heldBack === undefined
          ? inner.run(job)
          : Effect.gen(function* () {
              yield* Ref.update(sealed.jobs, (all) => [...all, job]);

              if (yield* Ref.get(sealed.blocked)) {
                return yield* new VerifierBlocked({});
              }

              const failing = yield* Ref.get(sealed.failing);

              return {
                durationMs: 7,
                evidence: [],
                heldBack: bitsOf(heldBackJob, failing),
                lanes: [],
              } satisfies CheckRun;
            }),
    });
  })
);

const mainRef = RefName.make("refs/heads/main");

const layerRepos = Layer.effect(
  LayerRepos,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const client = yield* gitClient(memoryFs());

    yield* host.create(layerRepo).pipe(Effect.orDie);

    const commit = yield* client.commit(
      "Seal the suite",
      sealedFiles.map(({ content, path }) => [path, content] as const),
      []
    );

    yield* host
      .push(layerRepo, client.source, [
        { from: Option.none(), ref: mainRef, to: commit },
      ])
      .pipe(Effect.orDie);

    return LayerRepos.of(host);
  })
).pipe(Layer.provide(Layer.fresh(RepoHostMemory)));

export const sealedWorld = (given: Policy) =>
  Layer.mergeAll(sealedChecker, LandingGuardsLive).pipe(
    Layer.provideMerge(worldWith(given)),
    Layer.provideMerge(layerRepos),
    Layer.provideMerge(fakes)
  );
