import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  LayerManifest,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import {
  LandedSha,
  LaneName,
  LayerName,
  RepoName,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha, ProjectName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { LayerRepos } from "@repo/visibility/layer-repos";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";

import { AnswerRuns } from "../../src/answer-runs.ts";
import { drive } from "../../src/answer-runs/steps.ts";
import { FinishersFromChecks, projectService } from "../../src/project.ts";
import type { ProjectApi } from "../../src/project.ts";
import {
  AdmissionStarts,
  ProjectVisibilityLive,
  SaltSource,
} from "../../src/visibility/state.ts";
import {
  CheckScript,
  composedAt,
  mergedAt,
  Pusher,
  worldOf,
} from "../world.ts";

export const scenario = aProject({
  deciders: ["ines-v", "okonkwo"],
  people: ["bob"],
}).pipe(
  withVouches(["ines-v", "okonkwo", "bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" })
);

export const { project } = scenario;

export const repo = RepoName.make(keyOf(project));

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

export const inesV = person("ines-v");

export const okonkwo = person("okonkwo");

export const bob = person("bob");

export const maintainers = LayerName.make("maintainers");

export const layerRepo = RepoName.make(`${keyOf(project)}--${maintainers}`);

export const visibilityFile = RepoPath.make(`${Brand.configDir}/visibility.ts`);

export const manifestFile = RepoPath.make(`${Brand.configDir}/layer.json`);

export const datekitVisibility = Schema.decodeUnknownSync(VisibilityPolicy)({
  checks: {
    areas: { export: "src/export/**", parser: "src/parser/**" },
    attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
    canary: false,
    commit: "salted-sha256-merkle",
    layer: "maintainers",
    pin: "claim",
    result: "area-bit",
  },
  env: { setters: "deciders" },
  flows: { noWriteDown: true, release: "deciders" },
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks", "notes"],
      name: "maintainers",
      readers: "deciders",
      reason: "Held-back checks for export and parser",
      writers: "deciders",
    },
  ],
  notice: { narrowingDays: 7 },
});

export const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

export const sealed: Files = [
  ...start,
  [visibilityFile, "export default visibility({ layers: { maintainers } });\n"],
];

export interface SealedFile {
  readonly area: string;
  readonly author: string;
  readonly content: string;
  readonly path: string;
}

export const layerFiles = (checks: readonly SealedFile[]): Files => [
  [
    manifestFile,
    `${JSON.stringify(
      Schema.encodeSync(LayerManifest)(
        Schema.decodeUnknownSync(LayerManifest)({
          checks: checks.map(({ area, author, path }) => ({
            area,
            author,
            clause: {
              quote: `${area} keeps its promise`,
              ref: "docs/promises.md",
              source: "doc",
            },
            path,
          })),
          knownBad: [],
          layer: maintainers,
        })
      )
    )}\n`,
  ],
  ...checks.map(({ content, path }) => [path, content] as const),
];

export class Seen extends Context.Service<
  Seen,
  {
    readonly created: Effect.Effect<readonly RepoName[]>;
    readonly salts: Effect.Effect<readonly Uint8Array[]>;
    readonly admissions: Effect.Effect<
      readonly {
        readonly head: CommitSha;
        readonly layer: LayerName;
        readonly project: ProjectName;
      }[]
    >;
  }
>()("test/Seen") {}

export class LayerPusher extends Context.Service<
  LayerPusher,
  {
    readonly push: (
      parent: Option.Option<CommitSha>,
      files: Files,
      message?: string
    ) => Effect.Effect<CommitSha>;
  }
>()("test/LayerPusher") {}

const mainRef = RefName.make("refs/heads/main");

const standIns = Layer.effectContext(
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const created = yield* Ref.make<readonly RepoName[]>([]);
    const salts = yield* Ref.make<readonly Uint8Array[]>([]);

    const admissions = yield* Ref.make<
      readonly {
        readonly head: CommitSha;
        readonly layer: LayerName;
        readonly project: ProjectName;
      }[]
    >([]);

    const client = yield* gitClient(memoryFs());

    const repos = LayerRepos.of({
      ...host,
      create: (name) =>
        Effect.andThen(
          Ref.update(created, (all) => [...all, name]),
          host.create(name)
        ),
    });

    return Context.make(LayerRepos, repos).pipe(
      Context.add(SaltSource, {
        next: Ref.modify(salts, (all) => {
          const salt = new Uint8Array(32).fill(all.length + 1);

          return [salt, [...all, salt]];
        }),
      }),
      Context.add(AdmissionStarts, {
        start: (input) => Ref.update(admissions, (all) => [...all, input]),
      }),
      Context.add(Seen, {
        admissions: Ref.get(admissions),
        created: Ref.get(created),
        salts: Ref.get(salts),
      }),
      Context.add(LayerPusher, {
        push: (parent, files, message = "Seal") =>
          Effect.gen(function* () {
            const sha = yield* client.commit(
              message,
              files,
              Option.toArray(parent)
            );

            yield* repos
              .push(layerRepo, client.source, [
                { from: parent, ref: mainRef, to: sha },
              ])
              .pipe(Effect.orDie);

            return sha;
          }),
      })
    );
  })
).pipe(Layer.provide(Layer.fresh(RepoHostMemory)));

const rulesWith = (
  visibility: VisibilityPolicy,
  configs: ReadonlyMap<string, VisibilityPolicy>
) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const finishers = yield* Finishers;

      return RulesEvaluator.of({
        call: () => Effect.succeed(false),
        evaluate: ({ at, facts, modules }) =>
          Effect.sync(() => {
            const { policy } = scenario;

            const evaluated: Policy = {
              ...policy,
              asks: policy.asks.filter(({ file }) => file in modules.modules),
              at,
              judge: finishers.judgeClosure(policy.run, facts.ci),
            };

            return Option.match(
              Option.fromUndefinedOr(modules.modules[visibilityFile]),
              {
                onNone: () => evaluated,
                onSome: (source) => ({
                  ...evaluated,
                  visibility: configs.get(source) ?? visibility,
                }),
              }
            );
          }),
      });
    })
  ).pipe(Layer.provide(FinishersFromChecks));

export const visibilityWorld = (
  visibility = datekitVisibility,
  configs: ReadonlyMap<string, VisibilityPolicy> = new Map()
) =>
  Layer.mergeAll(
    worldOf(scenario, "memory"),
    Layer.succeed(AnswerRuns, AnswerRuns.of({ start: () => Effect.void })),
    rulesWith(visibility, configs),
    ProjectVisibilityLive.pipe(Layer.provideMerge(standIns))
  );

export const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

export const made = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* api.initProject(inesV, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    return yield* api.recordFirstPush(inesV, first);
  });

export const landOwn = (
  api: ProjectApi,
  who: Person,
  input: {
    readonly files: Files;
    readonly message: string;
    readonly requestId: string;
  }
) =>
  Effect.gen(function* () {
    const forked = yield* api.fork(who);

    yield* RepoHost.use((host) =>
      Effect.andThen(host.remove(forked.fork), host.fork(repo, forked.fork))
    ).pipe(Effect.orDie);

    const base = yield* mainTip;

    const head = yield* Pusher.use((pusher) =>
      pusher.push(forked.fork, Option.some(base), input.files)
    );

    const merged = yield* mergedAt({
      base,
      fork: forked.fork,
      head,
      main: base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        Object.keys(scenario.policy.run.checks),
        (lane) => checker.script(merged, LaneName.make(lane), ["passed"]),
        { discard: true }
      )
    );

    const request = {
      base,
      head,
      message: input.message,
      requestId: RequestId.make(input.requestId),
    };

    const receipt = yield* api.land(who, request);

    yield* drive(api, request.requestId);

    return { receipt, request };
  });

export const askFilesOf = (ask: Ask) =>
  Arr.make(
    { content: `export default "${ask.id}";\n`, path: ask.file },
    {
      content: `it("${ask.id}", () => { throw new Error("red"); });\n`,
      path: CheckSpec.guards.RedThenGreen(ask.check)
        ? ask.check.path
        : RepoPath.make(`test/${ask.id}.test.ts`),
    }
  );

export const mainFiles: Files = [
  ...sealed,
  ...scenario.policy.asks.flatMap((ask) =>
    askFilesOf(ask).map(({ content, path }) => [path, content] as const)
  ),
];

export const openAsks = (api: ProjectApi) =>
  Effect.forEach(
    scenario.policy.asks,
    (ask) =>
      Effect.gen(function* () {
        const files = askFilesOf(ask);
        const composed = yield* composedAt(repo, yield* mainTip, files);

        yield* CheckScript.use((checker) =>
          checker.script(composed, LaneName.make("redThenGreen"), [
            "failed",
            "failed",
          ])
        );

        yield* api.openAsk(inesV, { ask: ask.id, files });
      }),
    { discard: true }
  );

export const firstSuite: readonly SealedFile[] = [
  {
    area: "export",
    author: "ines-v",
    content: 'it("escapes link titles in svg", () => {});\n',
    path: "checks/held-back/export/svg-title.test.ts",
  },
  {
    area: "export",
    author: "okonkwo",
    content: 'it("quotes csv cells", () => {});\n',
    path: "checks/held-back/export/csv-quote.test.ts",
  },
  {
    area: "parser",
    author: "ines-v",
    content: 'it("reads week dates", () => {});\n',
    path: "checks/held-back/parser/iso-week.test.ts",
  },
];

export const sealedByInes = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* made(api);

  const landing = {
    files: sealed,
    message: "Seal checks for export and parser",
    requestId: "land-visibility",
  };

  const { request } = yield* landOwn(api, inesV, landing);

  yield* openAsks(api);

  return { api, request };
});

export const postureDecisions = (api: ProjectApi) =>
  Effect.map(api.today(okonkwo), ({ decisions }) =>
    decisions.filter(({ subject }) =>
      DecisionSubject.guards.PostureChange(subject)
    )
  );

export const countersigned = (api: ProjectApi) =>
  Effect.gen(function* () {
    const [decision] = yield* postureDecisions(api);
    const opened = Option.getOrThrow(Option.fromUndefinedOr(decision));

    yield* advanceTo("2026-10-08T12:00:00Z");
    yield* api.decide(okonkwo, { choice: "accept", decision: opened.id });
    yield* advanceTo("2026-10-14T12:00:00Z");

    return opened;
  });

export const pushLayer = (
  api: ProjectApi,
  parent: Option.Option<CommitSha>,
  checks: readonly SealedFile[]
) =>
  Effect.gen(function* () {
    const head = yield* LayerPusher.use((pusher) =>
      pusher.push(parent, layerFiles(checks))
    );

    yield* api.recordLayerPush(inesV, { head, layer: maintainers });

    return head;
  });
