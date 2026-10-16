import { envSchemaMethod } from "@repo/project/deciders";
import { FrontPage } from "@repo/project/front-page";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { keyOf } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import { ProjectExists, UnknownProject } from "@repo/protocol/refusal";
import { Effect, Layer, Ref, Schema } from "effect";

import { decodeReply, encodeCall } from "../project-calls.ts";
import type {
  ArgsOf,
  CallRequest,
  ErrorOf,
  ExitEncoded,
  ProjectMethod,
  SuccessOf,
} from "../project-calls.ts";
import { disposed } from "./rpc-result.ts";

export interface ProjectStub {
  readonly call: (request: typeof CallRequest.Encoded) => Promise<ExitEncoded>;
}

export interface ProjectNamespace {
  readonly idFromName: (name: string) => DurableObjectId;
  readonly get: (id: DurableObjectId) => ProjectStub;
}

const isUnknownProject = Schema.is(UnknownProject);

// `ProjectApi` has no room for the DO's `UnknownProject`, so one that comes back is a defect.
const assumingMade = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catchIf<E, Extract<E, UnknownProject>, never, never, never>(
      (refused): refused is Extract<E, UnknownProject> =>
        isUnknownProject(refused),
      (refused) => Effect.die(refused)
    )
  );

const remote =
  (namespace: ProjectNamespace, project: ProjectName) =>
  <M extends ProjectMethod>(
    method: M,
    args: ArgsOf<M>
  ): Effect.Effect<SuccessOf<M>, ErrorOf<M>> =>
    Effect.gen(function* () {
      const stub = namespace.get(namespace.idFromName(keyOf(project)));
      const request = yield* encodeCall(method, args);

      // A DO that cannot answer (reset, storage gone) is a defect.
      const reply = yield* Effect.tryPromise(() => stub.call(request)).pipe(
        Effect.flatMap(disposed),
        Effect.orDie
      );

      return yield* decodeReply(method, reply);
    });

const apiOf = (
  namespace: ProjectNamespace,
  project: ProjectName
): ProjectApi => {
  const on = remote(namespace, project);

  return {
    [envSchemaMethod]: (caller) => on(envSchemaMethod, [caller]),
    admissionPlan: (input) => on("admissionPlan", [input]),
    advanceAnswer: (requestId, command, report) =>
      on("advanceAnswer", [requestId, command, report]),
    answer: (requestId) => on("answer", [requestId]),
    claim: (caller, ask) => assumingMade(on("claim", [caller, ask])),
    credits: (caller, handle) => on("credits", [caller, handle]),
    decide: (caller, input) => assumingMade(on("decide", [caller, input])),
    events: (since, limit) => on("events", [since, limit]),
    // A name pointing at another project is the service's own
    // `UnknownProject`, so it crosses as the refusal it is.
    evidence: (caller, ref) => on("evidence", [caller, ref]),
    finish: (caller, input) => assumingMade(on("finish", [caller, input])),
    firstPusher: () => on("firstPusher", []),
    fork: (caller) => assumingMade(on("fork", [caller])),
    forks: () => on("forks", []),
    head: () => on("head", []),
    heldBackJob: (requestId) => on("heldBackJob", [requestId]),
    initProject: (caller, input) => on("initProject", [caller, input]),
    land: (caller, input) => assumingMade(on("land", [caller, input])),
    landing: (caller, sha) => assumingMade(on("landing", [caller, sha])),
    landingCount: () => on("landingCount", []),
    landings: (shas) => on("landings", [shas]),
    layerAccess: (caller, layer) => on("layerAccess", [caller, layer]),
    layerFacts: (caller) => on("layerFacts", [caller]),
    ledger: (caller) => assumingMade(on("ledger", [caller])),
    listAsks: (caller) => assumingMade(on("listAsks", [caller])),
    listDiscussions: (caller) => assumingMade(on("listDiscussions", [caller])),
    onAlarm: () => on("onAlarm", []),
    openAsk: (caller, input) => assumingMade(on("openAsk", [caller, input])),
    policy: () => on("policy", []),
    postDiscussion: (caller, input) =>
      assumingMade(on("postDiscussion", [caller, input])),
    recordAdmission: (input) => on("recordAdmission", [input]),
    recordFirstPush: (caller, head) => on("recordFirstPush", [caller, head]),
    recordHeldBack: (requestId, results) =>
      on("recordHeldBack", [requestId, results]),
    recordLayerPush: (caller, input) => on("recordLayerPush", [caller, input]),
    recordLayerRead: (caller, input) => on("recordLayerRead", [caller, input]),
    recordPush: (input) => on("recordPush", [input]),
    release: (caller, ask) => assumingMade(on("release", [caller, ask])),
    scanForValues: (input) => on("scanForValues", [input]),
    setEnv: (caller, input) => assumingMade(on("setEnv", [caller, input])),
    showAsk: (caller, ask) => assumingMade(on("showAsk", [caller, ask])),
    showDiscussion: (caller, discussion) =>
      assumingMade(on("showDiscussion", [caller, discussion])),
    standing: () => on("standing", []),
    status: (caller) => assumingMade(on("status", [caller])),
    submitAnswer: (caller, input) =>
      assumingMade(on("submitAnswer", [caller, input])),
    today: (caller) => assumingMade(on("today", [caller])),
    verdict: (caller, input) => assumingMade(on("verdict", [caller, input])),
    vouch: (caller, input) => assumingMade(on("vouch", [caller, input])),
  };
};

export const DoProjects = (
  namespace: ProjectNamespace
): Layer.Layer<Projects, never, FrontPage> =>
  Layer.effect(
    Projects,
    Effect.gen(function* () {
      const frontPage = yield* FrontPage;
      const known = yield* Ref.make<ReadonlySet<ProjectName>>(new Set());
      const seeded = yield* Ref.make(false);

      // Every project the front page lists was made, so its listing, kept once
      // per isolate when a name is not yet known, stands in for a probe of each:
      // a fan-out over every listed project then wakes each DO once, for its own
      // call alone. A name the listing lacks is probed, as before. Each request
      // reads the listing itself until one has kept it, and never joins another
      // request's read: the runtime takes a request that awaits another's I/O
      // for hung and cancels it, and a request whose client leaves is cancelled
      // where it stands, so a read it started may never end.
      const listed = Effect.gen(function* () {
        if (yield* Ref.get(seeded)) {
          return yield* Ref.get(known);
        }

        const listing = yield* frontPage.projects();

        yield* Ref.set(seeded, true);

        return yield* Ref.updateAndGet(
          known,
          (all) => new Set([...all, ...listing.map(({ project }) => project)])
        );
      });

      const isMade = (project: ProjectName) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(known)).has(project)) {
            return true;
          }

          const names = yield* listed;

          if (names.has(project)) {
            return true;
          }

          const found = yield* remote(namespace, project)("listAsks", [
            Anonymous.make({}),
          ]).pipe(
            Effect.as(true),
            Effect.catchTag("UnknownProject", () => Effect.succeed(false))
          );

          if (found) {
            yield* Ref.update(known, (all) => new Set(all).add(project));
          }

          return found;
        });

      return Projects.of({
        create: (project) =>
          Effect.flatMap(isMade(project), (found) =>
            found
              ? Effect.fail(new ProjectExists({ project }))
              : Effect.succeed(apiOf(namespace, project))
          ),
        get: (project) =>
          Effect.flatMap(isMade(project), (found) =>
            found
              ? Effect.succeed(apiOf(namespace, project))
              : Effect.fail(new UnknownProject({ project }))
          ),
      });
    })
  );
