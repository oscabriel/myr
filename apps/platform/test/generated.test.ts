/**
 * The project's contribute skill kept current on the platform: a
 * landing that changes what the generated files say is followed by the
 * platform's own landing of only those files, regenerated with
 * `@repo/agent-kit` as the platform's Project DOs do it
 * (`workflows/generated.ts`), credited `Decided-by` the decider whose
 * landing changed the config. Node world, memory adapters: `RepoHostMemory`,
 * the isomorphic-git `Lander` over it, a scripted Checker, `ProjectsMemory`,
 * and a rules evaluator whose run block is the config folder's `run.json`.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import { authorLine, creditsOf, parseTrailers } from "@repo/git/trailers";
import { treeDiff } from "@repo/git/tree-diff";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRunsInline } from "@repo/project/answer-runs/inline";
import { platformHandle } from "@repo/project/attention/effects";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import type { LaneResult } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import { RunBlock } from "@repo/protocol/domain/run";
import type { CommitSha } from "@repo/protocol/ids";
import {
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  RequestId,
  keyOf,
  TreeSha,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { RepoBusy, VerifierBlocked } from "@repo/protocol/refusal";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { Context, Effect, Exit, Layer, Option, Ref, Schema } from "effect";

import { ProjectSkillGenerator } from "../src/workflows/generated.ts";

const scenario = aProject();

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const alice = Person.make({ handle: scenario.initializer });

const mainRef = RefName.make("refs/heads/main");

const runFile = `${Brand.configDir}/run.json`;

const skill = `.agents/skills/${project}-contribute/SKILL.md`;

const claudeSkill = `.claude/skills/${project}-contribute/SKILL.md`;

const generatedPaths = [skill, claudeSkill, "AGENTS.md"];

const lintOnly = { checks: { lint: "bun run lint" }, test: "bun test {path}" };

const withUnit = {
  checks: { lint: "bun run lint", unit: "bun run test" },
  test: "bun test {path}",
};

/** What alice pushes first: a package, the run block, and notes of the project's own. */
const start: Files = [
  ["package.json", '{ "name": "datekit" }\n'],
  ["src/parse.ts", "export const parse = (s) => ({});\n"],
  [runFile, `${JSON.stringify(lintOnly)}\n`],
  ["AGENTS.md", "# Datekit\n\nOur own notes for agents.\n"],
];

const decodeRun = Schema.decodeEffect(Schema.fromJsonString(RunBlock));

/**
 * The scenario's policy at any commit, with the run block its config
 * folder's `run.json` states, or lint alone when it states none.
 */
const rules = Layer.succeed(
  RulesEvaluator,
  RulesEvaluator.of({
    call: () => Effect.succeed(false),
    evaluate: ({ at, modules }) =>
      Effect.map(
        Effect.orDie(
          decodeRun(modules.modules[runFile] ?? JSON.stringify(lintOnly))
        ),
        (run) => ({ ...scenario.policy, at, run })
      ),
  })
);

/** What the Checker answers: every lane passes on any tree the test names. */
class Passing extends Context.Service<
  Passing,
  {
    readonly on: (at: CheckAt, lanes: readonly string[]) => Effect.Effect<void>;
  }
>()("test/Passing") {}

const checker = Layer.effectContext(
  Effect.gen(function* () {
    const script = new Map<string, readonly LaneResult[]>();

    const memory = Context.get(
      yield* Layer.build(CheckRunnerMemory.layer(script)),
      CheckRunner
    );

    return Context.make(CheckRunner, memory).pipe(
      Context.add(Passing, {
        on: (at, lanes) =>
          Effect.sync(() => {
            for (const name of lanes) {
              const lane = LaneName.make(name);

              script.set(scriptKey(at, lane), [
                {
                  command: `run ${lane}`,
                  durationMs: 1,
                  lane,
                  result: "passed",
                },
              ]);
            }
          }),
      })
    );
  })
);

/**
 * What goes wrong with the next follow-up's land, once: nothing, a busy
 * repo before anything is pushed, or a push that went through and whose
 * answer was lost on the way back (a Lander call that timed out after it).
 */
type Mishap = "none" | "busy" | "lost";

class Mishaps extends Context.Service<
  Mishaps,
  { readonly next: (mishap: Mishap) => Effect.Effect<void> }
>()("test/Mishaps") {}

/** The isomorphic-git Lander, with the next follow-up's mishap played on its land. */
const mishapLander = Layer.effectContext(
  Effect.gen(function* () {
    const real = Context.get(yield* Layer.build(LanderIsogit), Lander);
    const next = yield* Ref.make<Mishap>("none");

    const land: Lander["Service"]["land"] = (job) =>
      Effect.gen(function* () {
        const mishap = job.requestId.startsWith("gen-")
          ? yield* Ref.getAndSet(next, "none")
          : "none";

        if (mishap === "busy") {
          return yield* new RepoBusy({});
        }

        const landed = yield* real.land(job);

        return mishap === "lost" ? yield* new VerifierBlocked({}) : landed;
      });

    return Context.make(Lander, Lander.of({ ...real, land })).pipe(
      Context.add(Mishaps, { next: (mishap) => Ref.set(next, mishap) })
    );
  })
);

/** Commits made the way git would make them, pushed to a repo's `main`. */
class Pusher extends Context.Service<
  Pusher,
  {
    readonly push: (
      to: RepoName,
      parent: Option.Option<CommitSha>,
      files: Files
    ) => Effect.Effect<CommitSha>;
  }
>()("test/Pusher") {}

const pusher = Layer.effect(
  Pusher,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const client = yield* gitClient(memoryFs());

    return Pusher.of({
      push: (to, parent, files) =>
        Effect.gen(function* () {
          const sha = yield* client.commit(
            "Work",
            files,
            Option.toArray(parent)
          );

          yield* host
            .push(to, client.source, [{ from: parent, ref: mainRef, to: sha }])
            .pipe(Effect.orDie);

          return sha;
        }),
    });
  })
);

/**
 * The project's ports, the generator only among the Project's own, as a
 * Project DO's shell gives them: the calls the test makes run without it.
 */
const world = Layer.mergeAll(
  ProjectsMemory.pipe(Layer.provide(ProjectSkillGenerator)),
  pusher
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(AnswerRunsInline, AlarmsMemory, ProjectionMemory, rules)
  ),
  Layer.provideMerge(Layer.merge(mishapLander, checker)),
  Layer.provideMerge(RepoHostMemory)
);

/** Where canonical `main` stands. */
const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

const commitAt = (sha: CommitSha) =>
  Effect.flatMap(RepoHost, (host) =>
    host
      .readCommit(repo, sha)
      .pipe(Effect.orDie, Effect.flatMap(Effect.fromOption))
  ).pipe(Effect.orDie);

/** A file's text at a commit of the canonical repo. */
const textAt = (sha: CommitSha, path: string) =>
  Effect.flatMap(RepoHost, (host) =>
    host
      .readFile(repo, Revision.Commit({ sha }), RepoPath.make(path))
      .pipe(
        Effect.orDie,
        Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes)))
      )
  );

/** What one commit changed against its first parent, by path. */
const changedBy = (sha: CommitSha) =>
  Effect.gen(function* () {
    const commit = yield* commitAt(sha);
    const parent = yield* commitAt(commit.parents[0] ?? sha);

    const changes = yield* treeDiff(
      repo,
      TreeSha.make(parent.tree),
      TreeSha.make(commit.tree)
    ).pipe(Effect.orDie);

    return changes.map(({ path }) => path).toSorted();
  });

/** The platform's follow-up at `sha`: its parent, what it changed, who it credits and names. */
const followUpAt = (sha: CommitSha) =>
  Effect.gen(function* () {
    const commit = yield* commitAt(sha);

    return {
      author: commit.author,
      changed: yield* changedBy(sha),
      credits: creditsOf(commit.message).credits,
      parent: commit.parents[0],
      requestId: parseTrailers(commit.message).find(
        ({ key }) => key === "Request-Id"
      )?.value,
      subject: commit.message.split("\n")[0],
    };
  });

/** Every file of the tree at `sha` the test knows of, as a commit on it would carry them. */
const filesAt = (sha: CommitSha, run: typeof RunBlock.Encoded) =>
  Effect.gen(function* () {
    const generated = yield* Effect.forEach(generatedPaths, (path) =>
      Effect.map(
        textAt(sha, path),
        (text) => [path, Option.getOrElse(text, () => "")] as const
      )
    );

    return [
      ...start.filter(([path]) => path !== runFile && path !== "AGENTS.md"),
      [runFile, `${JSON.stringify(run)}\n`],
      ...generated,
    ] satisfies Files;
  });

/** The project made, and alice's first push to it recorded. */
const firstPushed = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* Projects.use((each) => each.create(project)).pipe(
    Effect.orDie
  );

  yield* api.initProject(alice, {}).pipe(Effect.orDie);

  const first = yield* Pusher.use((each) =>
    each.push(repo, Option.none(), start)
  );

  yield* api.recordFirstPush(alice, first).pipe(Effect.orDie);

  return { api, first };
});

/** alice's own change from her working fork, `files` on top of `base`, made ready to land. */
const aliceLands = (base: LandedSha, files: Files, requestId: string) =>
  Effect.gen(function* () {
    const api = yield* Projects.use((each) => each.get(project)).pipe(
      Effect.orDie
    );

    const { fork } = yield* api.fork(alice).pipe(Effect.orDie);

    const head = yield* Pusher.use((each) =>
      each.push(fork, Option.some(base), files)
    );

    const merged = yield* Lander.use((lander) =>
      lander.merge({ base, fork, head, main: base, repo })
    ).pipe(Effect.orDie);

    yield* Passing.use((passing) =>
      passing.on(CheckAt.cases.Tree.make({ tree: merged.tree }), [
        "lint",
        "unit",
      ])
    );

    const request = {
      base,
      head,
      message: "Change the project",
      requestId: RequestId.make(requestId),
    };

    return { api, land: () => api.land(alice, request).pipe(Effect.orDie) };
  });

const landedSha = (outcome: Outcome) =>
  Outcome.guards.Landed(outcome) ? Option.some(outcome.sha) : Option.none();

describe("the contribute skill, regenerated by the platform", () => {
  it.effect(
    "follows the first push with a landing of the generated files alone, credited to the initializer",
    () =>
      Effect.gen(function* () {
        const { api, first } = yield* firstPushed;
        const tip = yield* mainTip;

        expect(yield* followUpAt(tip)).toStrictEqual({
          author: authorLine(platformHandle),
          changed: generatedPaths.toSorted(),
          credits: [{ handle: alice.handle, role: "Decided-by" }],
          parent: first,
          requestId: `gen-${first}`,
          subject: "Regenerate the contribute skill and the AGENTS.md block",
        });

        const agents = Option.getOrElse(
          yield* textAt(tip, "AGENTS.md"),
          () => ""
        );

        expect(agents).toMatch(
          /^# Datekit\n\nOur own notes for agents\.\n\n<!-- BEGIN /u
        );
        expect(yield* textAt(tip, skill)).toStrictEqual(
          yield* textAt(tip, claudeSkill)
        );

        // The same first push recorded again is still the project's first push.
        expect(
          yield* Effect.exit(api.recordFirstPush(alice, first))
        ).toStrictEqual(Exit.succeed({ landed: first }));
        expect(yield* mainTip).toBe(tip);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "follows a landing that changed the run block with one more platform commit, and a replay lands nothing",
    () =>
      Effect.gen(function* () {
        yield* firstPushed;

        const generatedOnce = yield* mainTip;

        const changed = yield* aliceLands(
          generatedOnce,
          yield* filesAt(generatedOnce, withUnit),
          "land-alice-unit-lane"
        );

        const landed = Option.getOrThrow(
          landedSha((yield* changed.land()).outcome)
        );

        const tip = yield* mainTip;

        expect(yield* changedBy(landed)).toStrictEqual([runFile]);
        expect(yield* followUpAt(tip)).toStrictEqual({
          author: authorLine(platformHandle),
          changed: generatedPaths.toSorted(),
          credits: [{ handle: alice.handle, role: "Decided-by" }],
          parent: landed,
          requestId: `gen-${landed}`,
          subject: "Regenerate the contribute skill and the AGENTS.md block",
        });
        expect(Option.getOrElse(yield* textAt(tip, skill), () => "")).toContain(
          "bun run test"
        );

        const replayed = yield* changed.land();

        expect(landedSha(replayed.outcome)).toStrictEqual(Option.some(landed));
        expect(yield* mainTip).toBe(tip);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "lands nothing of its own after a landing that changed only src/",
    () =>
      Effect.gen(function* () {
        yield* firstPushed;

        const generatedOnce = yield* mainTip;
        const files = yield* filesAt(generatedOnce, lintOnly);

        const changed = yield* aliceLands(
          generatedOnce,
          files.map(([path, text]) =>
            path === "src/parse.ts"
              ? ([
                  path,
                  "export const parse = (s) => ({ year: 2026 });\n",
                ] as const)
              : ([path, text] as const)
          ),
          "land-alice-parse"
        );

        const landed = landedSha((yield* changed.land()).outcome);

        expect(Option.some(yield* mainTip)).toStrictEqual(landed);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "leaves the landing it follows standing when the follow-up could not land",
    () =>
      Effect.gen(function* () {
        yield* firstPushed;

        const generatedOnce = yield* mainTip;

        const changed = yield* aliceLands(
          generatedOnce,
          yield* filesAt(generatedOnce, withUnit),
          "land-alice-unit-lane"
        );

        yield* Mishaps.use((each) => each.next("busy"));

        const landed = landedSha((yield* changed.land()).outcome);

        expect(Option.some(yield* mainTip)).toStrictEqual(landed);
        expect(yield* changedBy(Option.getOrThrow(landed))).toStrictEqual([
          runFile,
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "fails the call when the follow-up reached main but its answer was lost, and the call run again records both landings",
    () =>
      Effect.gen(function* () {
        yield* firstPushed;

        const generatedOnce = yield* mainTip;

        const changed = yield* aliceLands(
          generatedOnce,
          yield* filesAt(generatedOnce, withUnit),
          "land-alice-unit-lane"
        );

        yield* Mishaps.use((each) => each.next("lost"));

        const lost = yield* Effect.exit(changed.land());
        const tip = yield* mainTip;
        const followed = yield* followUpAt(tip);
        const again = yield* changed.land();

        expect({
          followed: followed.requestId,
          lost: Exit.isFailure(lost),
          main: yield* mainTip,
        }).toStrictEqual({
          followed: `gen-${followed.parent}`,
          lost: true,
          main: tip,
        });
        expect(landedSha(again.outcome)).toStrictEqual(
          Option.some(followed.parent)
        );

        const recorded = yield* changed.api
          .landing(alice, tip)
          .pipe(Effect.orDie);

        expect(recorded.landing.requestId).toBe(`gen-${followed.parent}`);
      }).pipe(Effect.provide(world))
  );
});
