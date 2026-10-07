/**
 * W2 214's `Projects` port over the Project Durable Object namespace: each
 * project name is one DO (`idFromName`), and the `ProjectApi` a project
 * gets encodes each call (`encodeCall`), sends it to the DO's `call`, and
 * decodes the reply (`decodeReply`), so a refusal arrives as the same typed
 * refusal it is in the DO.
 *
 * The DO answers `UnknownProject` itself before `initProject`, so `get`
 * asks it once whether the project was made (a `listAsks`) and `create`
 * refuses a name already made with `ProjectExists`; two creates that race
 * meet `ProjectExists` from `initProject` in the DO. A project made stays
 * made, so the layer remembers each one it found.
 */
import { envSchemaMethod } from "@repo/project/deciders";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
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

/** The part of a Project DO's stub the Worker calls. */
export interface ProjectStub {
  readonly call: (request: typeof CallRequest.Encoded) => Promise<ExitEncoded>;
}

/** The part of the `PROJECT` namespace binding the adapter uses. */
export interface ProjectNamespace {
  readonly idFromName: (name: string) => DurableObjectId;
  readonly get: (id: DurableObjectId) => ProjectStub;
}

const isUnknownProject = Schema.is(UnknownProject);

/**
 * A call on a project `get` found made: the DO's `UnknownProject` cannot
 * come back, so it is a defect if it does.
 */
const made = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catchIf<E, Extract<E, UnknownProject>, never, never, never>(
      (refused): refused is Extract<E, UnknownProject> =>
        isUnknownProject(refused),
      (refused) => Effect.die(refused)
    )
  );

/** One call on `project`'s DO, as the method's own types. */
const remote =
  (namespace: ProjectNamespace, project: ProjectName) =>
  <M extends ProjectMethod>(
    method: M,
    args: ArgsOf<M>
  ): Effect.Effect<SuccessOf<M>, ErrorOf<M>> =>
    Effect.gen(function* () {
      const stub = namespace.get(namespace.idFromName(project));
      const request = yield* encodeCall(method, args);

      // A DO that cannot answer (reset, storage gone) is a defect.
      const reply = yield* Effect.tryPromise(() => stub.call(request)).pipe(
        Effect.orDie
      );

      return yield* decodeReply(method, reply);
    });

/** A project's `ProjectApi`, every method a call on its DO. */
const apiOf = (
  namespace: ProjectNamespace,
  project: ProjectName
): ProjectApi => {
  const on = remote(namespace, project);

  return {
    [envSchemaMethod]: (caller) => on(envSchemaMethod, [caller]),
    advanceAnswer: (requestId, command, report) =>
      on("advanceAnswer", [requestId, command, report]),
    answer: (requestId) => on("answer", [requestId]),
    claim: (caller, ask) => made(on("claim", [caller, ask])),
    credits: (caller, handle) => on("credits", [caller, handle]),
    decide: (caller, input) => made(on("decide", [caller, input])),
    events: (since, limit) => on("events", [since, limit]),
    finish: (caller, input) => made(on("finish", [caller, input])),
    flagAsk: (caller, input) => made(on("flagAsk", [caller, input])),
    fork: (caller) => made(on("fork", [caller])),
    initProject: (caller, input) => on("initProject", [caller, input]),
    land: (caller, input) => made(on("land", [caller, input])),
    landing: (caller, sha) => made(on("landing", [caller, sha])),
    ledger: (caller) => made(on("ledger", [caller])),
    listAsks: (caller) => made(on("listAsks", [caller])),
    onAlarm: () => on("onAlarm", []),
    openAsk: (caller, input) => made(on("openAsk", [caller, input])),
    proposeAsk: (caller, input) => made(on("proposeAsk", [caller, input])),
    recordFirstPush: (caller, head) => on("recordFirstPush", [caller, head]),
    recordPush: (input) => on("recordPush", [input]),
    release: (caller, ask) => made(on("release", [caller, ask])),
    setEnv: (caller, input) => made(on("setEnv", [caller, input])),
    showAsk: (caller, ask) => made(on("showAsk", [caller, ask])),
    status: (caller) => made(on("status", [caller])),
    submitAnswer: (caller, input) => made(on("submitAnswer", [caller, input])),
    today: (caller) => made(on("today", [caller])),
    verdict: (caller, input) => made(on("verdict", [caller, input])),
    vouch: (caller, input) => made(on("vouch", [caller, input])),
  };
};

export const DoProjects = (
  namespace: ProjectNamespace
): Layer.Layer<Projects> =>
  Layer.effect(
    Projects,
    Effect.gen(function* () {
      const known = yield* Ref.make<ReadonlySet<ProjectName>>(new Set());

      /** Whether the project's DO holds a project: it answers a read, not `UnknownProject`. */
      const isMade = (project: ProjectName) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(known)).has(project)) {
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
