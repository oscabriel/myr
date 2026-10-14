import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { LogRef } from "@repo/checks/evidence-store";
import { envSchemaMethod } from "@repo/project/deciders";
import { DraftResult } from "@repo/project/draft-runs";
import { LandingCommand } from "@repo/project/landing";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import {
  CommitSha,
  DecisionId,
  DiscussionId,
  EnvKey,
  keyOf,
  LandedSha,
  LayerName,
  ProjectName,
  ProposalId,
  RequestId,
} from "@repo/protocol/ids";
import {
  NotRedFirst,
  ProjectExists,
  UnknownProject,
} from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { DoProjects } from "../src/adapters/do-projects.ts";
import type { ProjectNamespace } from "../src/adapters/do-projects.ts";
import {
  decodeReply,
  ProjectCalls,
  projectMethods,
} from "../src/project-calls.ts";
import type { ProjectMethod } from "../src/project-calls.ts";
import {
  alice,
  anyone,
  askFiles,
  bob,
  carol,
  forkOf,
  namespaceOf,
  outcomeOf,
  parseIso,
  project,
  world,
} from "./project-do.fixtures.ts";

const other = ProjectName.make("alice/other");

const sha = CommitSha.make("a".repeat(40));

const requestId = RequestId.make("req-none0001");

const layer = LayerName.make("maintainers");

const settled = <A, E, R>(
  method: ProjectMethod,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.exit(effect).pipe(
    Effect.flatMap((exit) =>
      Schema.encodeUnknownEffect(ProjectCalls[method].exit)(exit)
    ),
    Effect.orDie
  );

const everyMethod = (api: ProjectApi) =>
  Effect.all({
    admissionPlan: settled(
      "admissionPlan",
      api.admissionPlan({ head: sha, layer })
    ),
    advanceAnswer: settled(
      "advanceAnswer",
      api.advanceAnswer(
        requestId,
        LandingCommand.Start({ main: LandedSha.make(sha) })
      )
    ),
    answer: settled("answer", api.answer(requestId)),
    claim: settled("claim", api.claim(bob, parseIso)),
    credits: settled("credits", api.credits(anyone, bob.handle)),
    decide: settled(
      "decide",
      api.decide(alice, {
        choice: "accept",
        decision: DecisionId.make("dec-none0001"),
      })
    ),
    draftAsk: settled(
      "draftAsk",
      api.draftAsk(carol, { proposal: ProposalId.make("prop-000001") })
    ),
    draftContext: settled(
      "draftContext",
      api.draftContext(ProposalId.make("prop-000001"), 1)
    ),
    draftSettled: settled(
      "draftSettled",
      api.draftSettled(
        ProposalId.make("prop-000001"),
        1,
        DraftResult.cases.Failed.make({
          attempts: 1,
          model: "test-model",
          refusal: new NotRedFirst({}),
        })
      )
    ),
    [envSchemaMethod]: settled(envSchemaMethod, api[envSchemaMethod](anyone)),
    events: settled("events", api.events(0, 100)),
    evidence: settled(
      "evidence",
      api.evidence(alice, LogRef.make(`${project}/${requestId}/unit#1`))
    ),
    finish: settled(
      "finish",
      api.finish(bob, { ask: parseIso, base: sha, head: sha, requestId })
    ),
    firstPusher: settled("firstPusher", api.firstPusher()),
    flagAsk: settled(
      "flagAsk",
      api.flagAsk(bob, { ask: parseIso, reason: "It names no format." })
    ),
    fork: settled("fork", api.fork(carol)),
    forks: settled("forks", api.forks()),
    head: settled("head", api.head()),
    heldBackJob: settled("heldBackJob", api.heldBackJob(requestId)),
    initProject: settled("initProject", api.initProject(alice, {})),
    land: settled(
      "land",
      api.land(bob, { base: sha, head: sha, message: "Tidy", requestId })
    ),
    landing: settled("landing", api.landing(anyone, sha)),
    landingCount: settled("landingCount", api.landingCount()),
    landings: settled("landings", api.landings([sha])),
    layerAccess: settled("layerAccess", api.layerAccess(alice, layer)),
    layerFacts: settled("layerFacts", api.layerFacts(bob)),
    ledger: settled("ledger", api.ledger(anyone)),
    listAsks: settled("listAsks", api.listAsks(anyone)),
    listDiscussions: settled("listDiscussions", api.listDiscussions(anyone)),
    onAlarm: settled("onAlarm", api.onAlarm()),
    openAsk: settled(
      "openAsk",
      api.openAsk(bob, { ask: parseIso, files: askFiles() })
    ),
    policy: settled("policy", api.policy()),
    postDiscussion: settled(
      "postDiscussion",
      api.postDiscussion(carol, { title: "Which day starts a week?" })
    ),
    proposeAsk: settled(
      "proposeAsk",
      api.proposeAsk(carol, { want: "Parse ISO week dates." })
    ),
    recordAdmission: settled(
      "recordAdmission",
      api.recordAdmission({ head: sha, layer, results: [] })
    ),
    recordFirstPush: settled("recordFirstPush", api.recordFirstPush(bob, sha)),
    recordHeldBack: settled(
      "recordHeldBack",
      api.recordHeldBack(requestId, [])
    ),
    recordLayerPush: settled(
      "recordLayerPush",
      api.recordLayerPush(alice, { head: sha, layer })
    ),
    recordLayerRead: settled(
      "recordLayerRead",
      api.recordLayerRead(alice, { layer, sha })
    ),
    recordPush: settled(
      "recordPush",
      api.recordPush({
        after: sha,
        before: Option.none(),
        eventId: "push-none",
        pusher: bob,
        ref: "refs/heads/main",
        repo: forkOf(bob),
      })
    ),
    rehearseOpen: settled("rehearseOpen", api.rehearseOpen(askFiles())),
    release: settled("release", api.release(bob, parseIso)),
    scanForValues: settled(
      "scanForValues",
      api.scanForValues({ text: "a-value-long-enough-0123" })
    ),
    setEnv: settled(
      "setEnv",
      api.setEnv(bob, {
        key: EnvKey.make("API_KEY"),
        value: Redacted.make("a-value-long-enough-0123"),
      })
    ),
    showAsk: settled("showAsk", api.showAsk(anyone, parseIso)),
    showDiscussion: settled(
      "showDiscussion",
      api.showDiscussion(anyone, DiscussionId.make("disc-000001"))
    ),
    showProposal: settled(
      "showProposal",
      api.showProposal(anyone, ProposalId.make("prop-000001"))
    ),
    standing: settled("standing", api.standing()),
    status: settled("status", api.status(bob)),
    submitAnswer: settled(
      "submitAnswer",
      api.submitAnswer(bob, { ask: parseIso, base: sha, head: sha, requestId })
    ),
    today: settled("today", api.today(alice)),
    verdict: settled("verdict", api.verdict(anyone, { ask: parseIso })),
    vouch: settled(
      "vouch",
      api.vouch(bob, { handle: carol.handle, verdict: "vouch" })
    ),
  });

const script = Effect.gen(function* () {
  const projects = yield* Projects;
  const before = yield* outcomeOf(projects.get(project));
  const made = yield* projects.create(project);

  yield* made.initProject(alice, {});

  return {
    again: yield* outcomeOf(projects.create(project)),
    before,
    each: yield* Effect.flatMap(projects.get(project), everyMethod),
    other: yield* outcomeOf(projects.get(other)),
  };
});

describe("Projects over the Project DO namespace", () => {
  it("takes the Worker's PROJECT binding", () => {
    expectTypeOf<Env["PROJECT"]>().toExtend<ProjectNamespace>();
  });

  it.effect("routes each project name to a DO of its own", () =>
    Effect.gen(function* () {
      const { names, namespace } = yield* namespaceOf;

      const outcome = yield* script.pipe(Effect.provide(DoProjects(namespace)));

      expect(outcome.before).toStrictEqual({
        refused: new UnknownProject({ project }),
      });
      expect(outcome.again).toStrictEqual({
        refused: new ProjectExists({ project }),
      });
      expect(outcome.other).toStrictEqual({
        refused: new UnknownProject({ project: other }),
      });
      expect(yield* names).toStrictEqual([keyOf(project), keyOf(other)]);
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "answers every ProjectApi method as the project's service does in process",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const inProcess = yield* script.pipe(
          Effect.provide(Layer.provideMerge(ProjectsMemory, world))
        );

        const throughDo = yield* Effect.gen(function* () {
          const { namespace } = yield* namespaceOf;

          return yield* script.pipe(Effect.provide(DoProjects(namespace)));
        }).pipe(Effect.provide(world));

        const died = yield* Effect.filter(projectMethods, (method) =>
          Effect.map(
            outcomeOf(decodeReply(method, throughDo.each[method])),
            (outcome) => outcome === "died"
          )
        );

        expect(Object.keys(throughDo.each).toSorted()).toStrictEqual(
          projectMethods.toSorted()
        );
        expect(throughDo).toStrictEqual(inProcess);
        expect(died).toStrictEqual(["advanceAnswer"]);
      })
  );
});
