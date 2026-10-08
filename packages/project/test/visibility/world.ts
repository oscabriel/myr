/**
 * datekit's world for the visibility cartridge's tests (W6 612): the
 * project service over memory adapters (`../world.ts`) with the live
 * `ProjectVisibility` plugged in, over a second `RepoHost` `/memory` as the
 * private namespace's `LayerRepos`, salts drawn from a counter, and
 * admissions recorded instead of started. Answer runs wait for the test to
 * drive them (`drive`), so an answer can stop where its held-back run is.
 *
 * Its rules evaluator returns the scenario's policy at every commit, with
 * datekit's visibility config (a maintainers layer; sealed areas `export`
 * and `parser`) whenever the commit's config folder holds `visibility.ts`:
 * the rules package does not read that file yet (601 #4, 604 #2).
 */
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

/**
 * datekit, decided by ines-v and okonkwo for the whole repo, so a change
 * one of them makes can be countersigned by the other; bob contributes.
 */
export const scenario = aProject({
  deciders: ["ines-v", "okonkwo"],
  people: ["bob"],
}).pipe(
  withVouches(["ines-v", "okonkwo", "bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" })
);

export const { project } = scenario;

export const repo = RepoName.make(project);

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

export const inesV = person("ines-v");

export const okonkwo = person("okonkwo");

export const bob = person("bob");

export const maintainers = LayerName.make("maintainers");

/** The maintainers layer's repo in the private namespace. */
export const layerRepo = RepoName.make(`${project}--${maintainers}`);

/** The config file that declares datekit's layers and held-back checks. */
export const visibilityFile = RepoPath.make(`${Brand.configDir}/visibility.ts`);

/** Where a layer's manifest is committed, as JSON, in the layer's repo. */
export const manifestFile = RepoPath.make(`${Brand.configDir}/layer.json`);

/** datekit's `visibility.ts`, as the rules would evaluate it: admission off. */
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

/** The project as ines-v first pushes it, with no visibility config. */
export const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

/** `start` with datekit's visibility config added. */
export const sealed: Files = [
  ...start,
  [visibilityFile, "export default visibility({ layers: { maintainers } });\n"],
];

/** One held-back check, as the layer's manifest lists it. */
export interface SealedFile {
  readonly area: string;
  readonly author: string;
  readonly content: string;
  readonly path: string;
}

/** A layer commit's files: the checks themselves and the manifest naming them. */
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

/** What the cartridge's stand-ins were asked, in order. */
export class Seen extends Context.Service<
  Seen,
  {
    /** Every layer repo the cartridge asked the private namespace to create. */
    readonly created: Effect.Effect<readonly RepoName[]>;
    /** Every salt drawn. */
    readonly salts: Effect.Effect<readonly Uint8Array[]>;
    /** Every admission the cartridge started. */
    readonly admissions: Effect.Effect<
      readonly {
        readonly head: CommitSha;
        readonly layer: LayerName;
        readonly project: ProjectName;
      }[]
    >;
  }
>()("test/Seen") {}

/** Commits to a layer's repo, as a maintainer's git would push them. */
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

/** The private namespace, the salts and the admissions, recorded. */
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

/**
 * The scenario's policy at any commit, holding the asks whose files the
 * commit's config folder has, and, when it has `visibility.ts`, the config
 * `configs` gives for that file's source, or `visibility`.
 */
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

/**
 * The world: datekit over memory adapters, answer runs left to the test,
 * and the visibility cartridge's live port over the stand-ins. Its
 * `visibility.ts` evaluates to `visibility`, or to the config `configs`
 * gives for its source.
 */
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

/** Where datekit's `main` stands now. */
export const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

/** ines-v makes datekit and pushes it first, with no visibility config. */
export const made = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* api.initProject(inesV, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    return yield* api.recordFirstPush(inesV, first);
  });

/**
 * `who` lands `files` from their working fork, brought up to main first as
 * their git would fetch it, as a decider's own change: every lane scripted
 * to pass on the merge, and the run driven to its end. Landing the same
 * request again changes nothing.
 */
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

/** An ask's own files: its file in the config folder, and its check, which fails on main. */
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

/** main's files once the visibility config landed and the asks opened. */
export const mainFiles: Files = [
  ...sealed,
  ...scenario.policy.asks.flatMap((ask) =>
    askFilesOf(ask).map(({ content, path }) => [path, content] as const)
  ),
];

/** ines-v opens each of the scenario's asks on main as it stands, its check red first. */
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

/** Three sealed checks: two in `export` by two authors, one in `parser`. */
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

/** ines-v makes datekit at noon on Oct 7, then lands its visibility config. */
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

/** The open posture-change decisions okonkwo sees on Today. */
export const postureDecisions = (api: ProjectApi) =>
  Effect.map(api.today(okonkwo), ({ decisions }) =>
    decisions.filter(({ subject }) =>
      DecisionSubject.guards.PostureChange(subject)
    )
  );

/** okonkwo accepts the posture change a day after it opened, and the notice runs out. */
export const countersigned = (api: ProjectApi) =>
  Effect.gen(function* () {
    const [decision] = yield* postureDecisions(api);
    const opened = Option.getOrThrow(Option.fromUndefinedOr(decision));

    yield* advanceTo("2026-10-08T12:00:00Z");
    yield* api.decide(okonkwo, { choice: "accept", decision: opened.id });
    yield* advanceTo("2026-10-14T12:00:00Z");

    return opened;
  });

/** A push of `checks` to the maintainers layer, on `parent`, as ines-v. */
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
