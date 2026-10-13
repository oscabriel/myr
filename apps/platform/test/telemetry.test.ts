import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner } from "@repo/checks/check-runner";
import { EvidenceStore } from "@repo/checks/evidence-store";
import { Lander } from "@repo/project/lander";
import { LandingCommand } from "@repo/project/landing";
import { Projects } from "@repo/project/projects";
import { LandedSha, RequestId } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { recordingConsole } from "@repo/telemetry/logger/memory";
import { recordingTracing, ROOT } from "@repo/telemetry/spans/memory";
import { Telemetry } from "@repo/telemetry/telemetry";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer } from "effect";
import type { Redacted } from "effect";
import { HttpRouter } from "effect/http";

import { DoProjects } from "../src/adapters/do-projects.ts";
import { buildHandler } from "../src/router-build.ts";
import { runWorkflow } from "../src/workflows/answer.ts";
import {
  alice,
  bob,
  namespaceOf,
  parseIso,
  project,
  world,
} from "./project-do.fixtures.ts";

const telemetry = (secrets: readonly Redacted.Redacted[] = []) => {
  const console = recordingConsole();
  const recording = recordingTracing();

  return {
    console,
    layer: Layer.merge(
      Telemetry({ secrets, tracing: recording.tracing }),
      console.layer
    ),
    recording,
  };
};

const origin = "https://platform.test";

const requestId = RequestId.make("req-none0001");

const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add(
      "GET",
      "/dies",
      Effect.die(new Error("the store is gone"))
    );
    yield* router.add("GET", "/refuses", Effect.fail(new VerifierBlocked({})));
  })
);

describe("a platform router", () => {
  it.effect(
    "reports a route's defect once, at Error, and never a route's typed failure",
    () =>
      Effect.gen(function* () {
        const { console, layer } = telemetry();
        const { dispose, handler } = buildHandler(routes, layer);

        const statuses = yield* Effect.forEach(["dies", "refuses"], (path) =>
          Effect.promise(() => handler(new Request(`${origin}/${path}`))).pipe(
            Effect.map(({ status }) => status)
          )
        );

        yield* Effect.promise(dispose);

        expect(statuses).toStrictEqual([500, 500]);
        expect(console.errors()).toHaveLength(1);
        expect(console.errors()[0]).toHaveProperty(
          "cause",
          expect.stringMatching(/^Error: the store is gone\n\s+at /u)
        );
      })
  );
});

describe("a Project DO call", () => {
  it.effect(
    "reports its defect once, in the DO, by its project, and its caller reports it no more",
    () =>
      Effect.gen(function* () {
        const durable = telemetry();
        const caller = telemetry();

        const { namespace } = yield* namespaceOf.pipe(
          Effect.provide(durable.layer)
        );

        const refused = yield* Effect.gen(function* () {
          const projects = yield* Projects;
          const made = yield* projects.create(project);

          yield* made.initProject(alice, {});
          yield* Effect.exit(
            made
              .advanceAnswer(
                requestId,
                LandingCommand.Start({ main: LandedSha.make("a".repeat(40)) })
              )
              .pipe(Effect.withErrorReporting)
          );

          return yield* Effect.flip(
            made.claim(bob, parseIso).pipe(Effect.withErrorReporting)
          );
        }).pipe(
          Effect.provide(Layer.merge(DoProjects(namespace), caller.layer))
        );

        expect(refused._tag).toBe("UnknownAsk");
        expect(caller.console.errors()).toStrictEqual([]);
        expect(durable.console.errors()).toHaveLength(1);
        expect(durable.console.errors()[0]).toMatchObject({
          message: "Error: no answer request req-none0001",
          project,
        });
        expect(
          durable.recording
            .spans()
            .flatMap(({ name }) => (name.startsWith("Project.") ? [name] : []))
        ).toStrictEqual([
          "Project.listAsks",
          "Project.initProject",
          "Project.advanceAnswer",
          "Project.claim",
        ]);
      }).pipe(Effect.provide(world))
  );
});

describe("a Workflow instance", () => {
  it.effect(
    "reports its defect once, by its project and request, and still rejects",
    () =>
      Effect.gen(function* () {
        const { console, layer, recording } = telemetry();

        const ports = Layer.mergeAll(
          Layer.succeed(
            CheckRunner,
            untouchable<CheckRunner["Service"]>("CheckRunner")
          ),
          Layer.succeed(
            EvidenceStore,
            untouchable<EvidenceStore["Service"]>("EvidenceStore")
          ),
          Layer.succeed(Lander, untouchable<Lander["Service"]>("Lander")),
          Layer.succeed(Projects, untouchable<Projects["Service"]>("Projects")),
          Layer.succeed(RepoHost, untouchable<RepoHost["Service"]>("RepoHost")),
          layer
        );

        const rejected = yield* Effect.flip(
          Effect.tryPromise(() =>
            runWorkflow(
              ports,
              { project, requestId },
              { do: (_name, _config, body) => body() }
            )
          )
        );

        expect(rejected.cause).toHaveProperty("name", "TouchedError");
        expect(console.errors()).toHaveLength(1);
        expect(console.errors()[0]).toMatchObject({
          message: "TouchedError: a test touched Projects.get",
          project,
          requestId,
        });
        expect(
          Object.fromEntries(recording.spans()[0]?.attributes ?? [])
        ).toStrictEqual({
          project,
          requestId,
        });
        expect(recording.spans().map(({ name }) => name)).toStrictEqual([
          ROOT,
          "Answer.run",
          "Workflow.load",
        ]);
      })
  );
});
