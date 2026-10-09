/**
 * A draft's run as the `Answer` Workflow takes it (W9-D14): the program's
 * steps over memory steps that record and replay as the engine does
 * (`memoSteps`), the memory drafter scripted per attempt, and a project in
 * memory whose rehearsals run on the scripted Checker. The Workflow's own
 * start (`DraftRunsWorkflow`) is held to create-or-restart over a fake
 * binding, and the engine is handed each draft step's timeout.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt } from "@repo/checks/check-runner";
import { DraftFailed } from "@repo/drafting/drafted";
import type { DraftedAsk } from "@repo/drafting/drafted";
import type { Drafter } from "@repo/drafting/drafter";
import type { AiLike } from "@repo/drafting/drafter/binding";
import { DrafterMemory, DraftsAsked } from "@repo/drafting/drafter/memory";
import { draftedFiles } from "@repo/drafting/render";
import { DraftModel } from "@repo/drafting/run";
import { DraftRuns } from "@repo/project/draft-runs";
import { Lander } from "@repo/project/lander";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { DraftState } from "@repo/protocol/domain/proposal";
import {
  AskId,
  LandedSha,
  LaneName,
  ProposalId,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { CapReached } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

import { DraftRunsWorkflow } from "../../src/adapters/draft-runs-workflow.ts";
import type { DraftWorkflow } from "../../src/adapters/draft-runs-workflow.ts";
import { DraftParams, draftId } from "../../src/answer-runs.ts";
import { Handlers } from "../../src/handlers.ts";
import type { PlatformConfig } from "../../src/platform.ts";
import { runDraftWorkflow } from "../../src/workflows/answer.ts";
import type { EngineSteps } from "../../src/workflows/draft-steps.ts";
import { draftSteps } from "../../src/workflows/draft-steps.ts";
import { memoSteps, StepRunner } from "../../src/workflows/step.ts";
import type { StepRetry } from "../../src/workflows/step.ts";
import { as, seeded, worldOf } from "../handlers.fixtures.ts";
import { Checker, Pusher, worldWith } from "./answer.fixtures.ts";

/** What the engine is handed with each step. */
type EngineConfig = Parameters<EngineSteps["do"]>[1];

/** datekit, decided by alice, with carol vouched and one `fix` ask she may want drafted. */
const scenario = aProject({ people: ["carol"] }).pipe(
  withVouches(["carol"]),
  withAsk({ id: "parse-week", territory: "." })
);

const { policy, project } = scenario;

const repo = RepoName.make(project);

const alice = Person.make({ handle: scenario.initializer });

const carol = Person.make({
  handle: scenario.people.get("carol") ?? scenario.initializer,
});

const redThenGreen = LaneName.make("redThenGreen");

const model = "@cf/moonshotai/kimi-k2.7-code";

const want = "Parse an ISO week date such as 2026-W41";

const proposal = ProposalId.make("prop-000001");

const params = DraftParams.make({ project, proposal, round: 1 });

const start = [
  ["package.json", '{ "name": "datekit", "type": "module" }\n'],
  ["src/parse.ts", "export const parse = (s) => ({});\n"],
] as const;

/** A draft of the scenario's ask whose test says `assertion`. */
const draftOf = (assertion: string, id = "parse-week"): DraftedAsk => ({
  id: AskId.make(id),
  kind: "fix",
  rationale: `${id}: parseWeek is missing, so its test fails by an assertion`,
  territory: [RepoPath.make("src/parse.ts")],
  test: {
    path: RepoPath.make(`test/${id}.test.ts`),
    source: [
      'import { expect, it } from "bun:test";',
      'import { parse } from "../src/parse.ts";',
      "",
      `it("${id}", () => {`,
      `  ${assertion}`,
      "});",
      "",
    ].join("\n"),
  },
  want,
});

/** A test that passes on main, so its draft is not red first. */
const passing = draftOf("expect(parse('2026-W41')).toStrictEqual({});");

/** A second test that passes on main. */
const passingToo = draftOf("expect(parse('2026-W42')).toStrictEqual({});");

/** A test that fails on main by its assertion. */
const red = draftOf("expect(parse('2026-W41').week).toBe(41);");

/** A draft of an ask the project's rules do not state. */
const unstated = draftOf(
  "expect(parse('2026-W41').week).toBe(41);",
  "parse-month"
);

/** carol proposes the want with a draft, on datekit's first push. */
const proposed = Effect.gen(function* () {
  yield* advanceTo("2026-10-08T12:00:00Z");

  const api = yield* Projects.use((each) => each.create(project)).pipe(
    Effect.orDie
  );

  yield* api.initProject(alice, {}).pipe(Effect.orDie);

  const first = yield* Pusher.use((each) =>
    each.push(repo, Option.none(), start)
  );

  yield* api.recordFirstPush(alice, first).pipe(Effect.orDie);

  // The project's first proposal: `proposal`.
  yield* api
    .proposeAsk(carol, { draft: true, territory: "src/parse.ts", want })
    .pipe(Effect.orDie);

  return { api, main: LandedSha.make(first) };
});

/** `drafted`'s files composed onto `main`, its check scripted to end `runs` there. */
const scripted = (
  main: LandedSha,
  drafted: DraftedAsk,
  result: "passed" | "failed"
) =>
  Effect.gen(function* () {
    const { commit } = yield* Lander.use((lander) =>
      lander.compose({ files: draftedFiles(drafted), main, repo })
    ).pipe(Effect.orDie);

    yield* Checker.use((script) =>
      script.script(CheckAt.cases.Commit.make({ commit }), redThenGreen, [
        result === "passed"
          ? { result }
          : { result, signature: "redThenGreen: expected 41, got undefined" },
      ])
    );
  });

/** The proposal's draft state, as anyone reads it. */
const draftOfProposal = (api: ProjectApi) =>
  Effect.map(
    Effect.orDie(api.showProposal(Anonymous.make({}), proposal)),
    ({ proposal: shown }) => shown.draft
  );

/** alice's open-proposal decisions on Today. */
const proposalDecisions = (api: ProjectApi) =>
  Effect.map(Effect.orDie(api.today(alice)), ({ decisions }) =>
    decisions.filter(({ subject }) =>
      DecisionSubject.guards.OpenProposal(subject)
    )
  );

const asked = DraftsAsked.use(({ inputs }) => inputs);

/** The world, the memory drafter scripted with `script`, and the platform's model. */
const worldDrafting = (script: Parameters<typeof DrafterMemory>[0]) =>
  Layer.mergeAll(
    worldWith(policy),
    DrafterMemory(script),
    Layer.succeed(DraftModel, model)
  );

describe("a draft's run, over steps that replay", () => {
  it.effect(
    "feeds attempt 1's NotRedFirst into attempt 2, puts up one decision with the red-first evidence, and a replay asks the model nothing more",
    () =>
      Effect.gen(function* () {
        const { api, main } = yield* proposed;

        yield* scripted(main, passing, "passed");
        yield* scripted(main, red, "failed");

        const steps = yield* memoSteps();

        yield* draftSteps(params).pipe(Effect.provide(steps));

        const inputs = yield* asked;
        const decisions = yield* proposalDecisions(api);

        expect({
          attempts: inputs.map(({ attempt }) => attempt),
          decisions: decisions.length,
          draft: yield* draftOfProposal(api),
          firstFeedback: inputs[0]?.feedback,
          redFirst: decisions[0]?.evidence.find(
            ({ label }) => label === "red first"
          )?.value,
          refusedWith: inputs[1]?.feedback?.split("\n")[0]?.split(":")[0],
        }).toStrictEqual({
          attempts: [1, 2],
          decisions: 1,
          draft: DraftState.cases.Ready.make({
            attempts: 2,
            model,
            red: {
              lane: redThenGreen,
              signature: "redThenGreen: expected 41, got undefined",
            },
            round: 1,
          }),
          firstFeedback: undefined,
          redFirst: `${redThenGreen}: redThenGreen: expected 41, got undefined`,
          refusedWith: "NotRedFirst",
        });

        // The finished instance, run again: every step reads its record.
        yield* draftSteps(params).pipe(Effect.provide(steps));

        expect({
          asked: (yield* asked).length,
          decisions: (yield* proposalDecisions(api)).length,
        }).toStrictEqual({ asked: 2, decisions: 1 });
      }).pipe(Effect.provide(worldDrafting([passing, red])))
  );

  it.effect(
    "settles Failed with the last refusal's tag once three attempts are refused",
    () =>
      Effect.gen(function* () {
        const { api, main } = yield* proposed;

        yield* scripted(main, passing, "passed");
        yield* scripted(main, passingToo, "passed");

        yield* draftSteps(params).pipe(Effect.provide(yield* memoSteps()));

        expect({
          asked: (yield* asked).length,
          decisions: (yield* proposalDecisions(api)).length,
          draft: yield* draftOfProposal(api),
        }).toStrictEqual({
          asked: 3,
          decisions: 1,
          draft: DraftState.cases.Failed.make({
            attempts: 3,
            model,
            refusal: "IncompleteBrief",
            round: 1,
          }),
        });
      }).pipe(Effect.provide(worldDrafting([passing, passingToo, unstated])))
  );

  it.effect(
    "retries a rate-limited model as a step, without spending an attempt",
    () =>
      Effect.gen(function* () {
        const { api, main } = yield* proposed;

        yield* scripted(main, red, "failed");

        yield* draftSteps(params).pipe(Effect.provide(yield* memoSteps()));

        expect({
          asked: (yield* asked).map(({ attempt }) => attempt),
          draft: yield* draftOfProposal(api),
        }).toStrictEqual({
          asked: [1, 1],
          draft: DraftState.cases.Ready.make({
            attempts: 1,
            model,
            red: {
              lane: redThenGreen,
              signature: "redThenGreen: expected 41, got undefined",
            },
            round: 1,
          }),
        });
      }).pipe(
        Effect.provide(
          worldDrafting([new DraftFailed({ reason: "rate-limited" }), red])
        )
      )
  );

  it.effect(
    "stops after its context when the proposal is gone: no attempt, no settling",
    () =>
      Effect.gen(function* () {
        yield* proposed;

        const names = yield* Ref.make<readonly string[]>([]);

        const memo = Context.get(
          yield* Layer.build(yield* memoSteps()),
          StepRunner
        );

        const logged = StepRunner.of({
          step: (name, schema, effect, retry?: StepRetry) =>
            Effect.andThen(
              Ref.update(names, (all) => [...all, name]),
              memo.step(name, schema, effect, retry)
            ),
        });

        yield* draftSteps(
          DraftParams.make({
            project,
            proposal: ProposalId.make("prop-000009"),
            round: 1,
          })
        ).pipe(Effect.provideService(StepRunner, logged));

        expect({
          asked: (yield* asked).length,
          names: yield* Ref.get(names),
        }).toStrictEqual({ asked: 0, names: ["context"] });
      }).pipe(Effect.provide(worldDrafting([])))
  );
});

/** A fake `ANSWER` binding: each instance made and restarted, every instance in `status`. */
const fakeWorkflow = (status: InstanceStatus["status"]) => {
  const made: string[] = [];
  const restarted: string[] = [];

  const workflow: DraftWorkflow = {
    create: ({ id }) => {
      if (made.includes(id)) {
        return Promise.reject(new Error(`instance ${id} already exists`));
      }

      made.push(id);

      return Promise.resolve({ id });
    },
    get: (id) =>
      Promise.resolve({
        id,
        restart: () => {
          restarted.push(id);

          return Promise.resolve();
        },
        status: () => Promise.resolve({ status }),
      }),
  };

  return { made, restarted, workflow };
};

describe("the Workflow's draft runs", () => {
  it.effect(
    "starts one instance per round: a second start finds it, and a run still going is left alone",
    () =>
      Effect.gen(function* () {
        const fake = fakeWorkflow("running");

        const starting = DraftRuns.pipe(
          Effect.flatMap((runs) =>
            runs.start({ note: "keep it small", project, proposal, round: 1 })
          ),
          Effect.provide(DraftRunsWorkflow(fake.workflow))
        );

        yield* starting;
        yield* starting;

        expect({
          made: fake.made,
          restarted: fake.restarted,
        }).toStrictEqual({
          made: [`draft-${project}-${proposal}-r1`],
          restarted: [],
        });

        expect(draftId(params)).toBe(`draft-${project}-${proposal}-r1`);
      })
  );

  it.effect(
    "starts an errored round's instance again, and never a complete one, which would ask the model again",
    () =>
      Effect.gen(function* () {
        const errored = fakeWorkflow("errored");
        const complete = fakeWorkflow("complete");

        const twice = (workflow: DraftWorkflow) =>
          DraftRuns.pipe(
            Effect.flatMap((runs) =>
              Effect.andThen(
                runs.start({ project, proposal, round: 1 }),
                runs.start({ project, proposal, round: 1 })
              )
            ),
            Effect.provide(DraftRunsWorkflow(workflow))
          );

        yield* twice(errored.workflow);
        yield* twice(complete.workflow);

        expect({
          complete: complete.restarted,
          errored: errored.restarted,
        }).toStrictEqual({
          complete: [],
          errored: [`draft-${project}-${proposal}-r1`],
        });
      })
  );

  it.effect(
    "gives the engine a 10-minute timeout on each step, and the rate-limit retries on the model's",
    () =>
      Effect.gen(function* () {
        const { main } = yield* proposed;

        yield* scripted(main, red, "failed");

        const configs: (readonly [string, EngineConfig])[] = [];
        const kept = new Map<string, Schema.Json>();

        const engine: EngineSteps = {
          do: (name, config, body) => {
            configs.push([name, config]);

            const found = kept.get(name);

            return found === undefined
              ? body().then((value) => {
                  kept.set(name, value);

                  return value;
                })
              : Promise.resolve(found);
          },
        };

        const ports = yield* Effect.context<Projects | Drafter | RepoHost>();

        const payload = yield* Schema.encodeEffect(DraftParams)(params);

        yield* Effect.promise(() =>
          runDraftWorkflow(Layer.succeedContext(ports), payload, engine)
        );

        expect(configs.map(([name]) => name)).toStrictEqual([
          "context",
          "draft-1",
          "rehearse-1",
          "settle",
        ]);

        expect(new Map(configs).get("draft-1")).toStrictEqual({
          retries: { backoff: "exponential", delay: 15_000, limit: 4 },
          timeout: "10 minutes",
        });

        expect(
          configs.filter(([, config]) => config.timeout !== "10 minutes")
        ).toStrictEqual([]);
      }).pipe(Effect.provide(worldDrafting([red])))
  );

  it("takes the Worker's bindings as the generated Env types them", () => {
    expectTypeOf<Env["ANSWER"]>().toExtend<
      Parameters<typeof DraftRunsWorkflow>[0]
    >();
    expectTypeOf<PlatformConfig["AI"]>().toExtend<AiLike>();
  });
});

describe("proposing with a draft", () => {
  it.effect(
    "spends the person's draft limit first: past it, CapReached, while a proposal without a draft still goes through",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");
        yield* seeded(scenario);

        const asCarol = yield* as("carol");

        const drafted = yield* asCarol.proposeAsk({
          draft: true,
          project,
          want,
        });

        const past = yield* Effect.flip(
          asCarol.proposeAsk({ draft: true, project, want })
        );

        const plain = yield* asCarol.proposeAsk({ project, want });

        expect({
          drafted: drafted.proposal.draft?._tag,
          past,
          plain: plain.proposal.draft,
        }).toStrictEqual({
          drafted: "Drafting",
          past: new CapReached({ cap: 1 }),
          plain: undefined,
        });
      }).pipe(
        Effect.provide(
          Handlers.pipe(
            Layer.provideMerge(
              worldOf([scenario], {
                limits: { claim: 5, draft: 1, proposal: 5 },
              })
            )
          )
        )
      )
  );
});
