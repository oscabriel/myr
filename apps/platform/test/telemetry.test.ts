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
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { DoProjects } from "../src/adapters/do-projects.ts";
import { PlatformEnv } from "../src/platform.ts";
import { telemetryOf } from "../src/ports.ts";
import { buildHandler } from "../src/router-build.ts";
import { runWorkflow } from "../src/workflows/answer.ts";
import { instance, invocation } from "../src/workflows/instance.ts";
import { StepRunner, workflowSteps } from "../src/workflows/step.ts";
import { fakeEnv } from "./fake-env.ts";
import {
  alice,
  bob,
  namespaceOf,
  parseIso,
  project,
  unlisted,
  world,
} from "./project-do.fixtures.ts";

const telemetry = () => {
  const console = recordingConsole();
  const recording = recordingTracing();

  return {
    console,
    layer: Layer.merge(
      Telemetry({ secrets: [], tracing: recording.tracing }),
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

const platformConfig = (env: Readonly<Record<string, string>> = {}) =>
  Schema.decodeUnknownEffect(PlatformEnv)({ ...fakeEnv(), ...env }).pipe(
    Effect.orDie
  );

describe("the Worker's telemetry", () => {
  it.effect(
    "takes every secret the env holds out of each line it logs, each session token included",
    () =>
      Effect.gen(function* () {
        const session = "session-token-0123456789abcdef0123456789";

        const config = yield* platformConfig({
          SESSION_TOKENS: JSON.stringify({ [session]: "alice" }),
        });

        const secrets = [
          config.COOKIE_KEY,
          config.MASTER_KEY,
          config.OPERATOR_TOKEN,
          config.PASSWORD_PEPPER,
        ].map((secret) => Redacted.value(secret));

        const held = `held ${[...secrets, session].join(" ")}`;
        const console = recordingConsole();

        const { dispose, handler } = buildHandler(
          HttpRouter.use((router) =>
            router.add(
              "GET",
              "/dies",
              Effect.logWarning(held).pipe(
                Effect.andThen(Effect.die(new Error(held)))
              )
            )
          ),
          Layer.merge(telemetryOf(config), console.layer)
        );

        yield* Effect.promise(() => handler(new Request(`${origin}/dies`)));
        yield* Effect.promise(dispose);

        const logged = JSON.stringify(console.written());

        expect(console.errors()).toHaveLength(1);
        expect(
          [...secrets, session].filter((secret) => logged.includes(secret))
        ).toStrictEqual([]);
        expect(logged).toContain("held <redacted> <redacted>");
      })
  );

  it.effect(
    "keeps a defect by its name and frames alone, a route's and a Project DO's, since its text may name a layer's repo",
    () =>
      Effect.gen(function* () {
        const config = yield* platformConfig();
        const repo = "alice--datekit--private";
        const console = recordingConsole();
        const layer = Layer.merge(telemetryOf(config), console.layer);

        const { dispose, handler } = buildHandler(
          HttpRouter.use((router) =>
            router.add(
              "GET",
              "/dies",
              Effect.die(new Error(`the layer repo ${repo} has no commit`))
            )
          ),
          layer
        );

        yield* Effect.promise(() => handler(new Request(`${origin}/dies`)));
        yield* Effect.promise(dispose);

        const { namespace } = yield* namespaceOf.pipe(Effect.provide(layer));

        yield* Effect.gen(function* () {
          const made = yield* (yield* Projects).create(project);

          yield* made.initProject(alice, {});
          yield* Effect.exit(
            made.advanceAnswer(
              requestId,
              LandingCommand.Start({ main: LandedSha.make("a".repeat(40)) })
            )
          );
        }).pipe(
          Effect.provide(DoProjects(namespace).pipe(Layer.provide(unlisted)))
        );

        const logged = JSON.stringify(console.written());

        const withheld = /^Error: <withheld>\n\s+at /u;

        expect(console.errors()).toMatchObject([
          { message: "Error: <withheld>" },
          { message: "Error: <withheld>", project },
        ]);
        expect(console.errors()[0]).toHaveProperty(
          "cause",
          expect.stringMatching(withheld)
        );
        expect(console.errors()[1]).toHaveProperty(
          "cause",
          expect.stringMatching(withheld)
        );
        expect(
          [repo, requestId].filter((text) => logged.includes(text))
        ).toStrictEqual([]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "keeps a defect a warning carries by its name and frames alone too, since a caught cause is logged as well as reported",
    () =>
      Effect.gen(function* () {
        const config = yield* platformConfig();
        const repo = "alice--datekit--private";
        const console = recordingConsole();

        yield* Effect.logWarning(
          "a visibility effect did not settle",
          Cause.die(new Error(`the layer repo ${repo} lost a blob`))
        ).pipe(Effect.provide(Layer.merge(telemetryOf(config), console.layer)));

        expect(console.written()).toMatchObject([
          { line: { level: "warn" }, method: "warn" },
        ]);
        expect(console.written()[0]?.line).toHaveProperty(
          "cause",
          expect.stringMatching(/^Error: <withheld>\n\s+at /u)
        );
        expect(JSON.stringify(console.written())).not.toContain(repo);
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
          Effect.provide(
            Layer.merge(
              DoProjects(namespace).pipe(Layer.provide(unlisted)),
              caller.layer
            )
          )
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
    "reports a Project DO's defect, met inside a step, no more: the DO reported it",
    () =>
      Effect.gen(function* () {
        const durable = telemetry();
        const caller = telemetry();

        const { namespace } = yield* namespaceOf.pipe(
          Effect.provide(durable.layer)
        );

        // An engine whose step rejects as the body did, as a step past its retries does.
        const engine = workflowSteps({ do: (_name, _config, body) => body() });

        const exit = yield* Effect.gen(function* () {
          const made = yield* (yield* Projects).create(project);

          yield* made.initProject(alice, {});

          return yield* StepRunner.use(({ step }) =>
            step(
              "advance",
              Schema.Null,
              made
                .advanceAnswer(
                  requestId,
                  LandingCommand.Start({ main: LandedSha.make("a".repeat(40)) })
                )
                .pipe(Effect.as(null))
            )
          );
        }).pipe(
          invocation({ project, requestId }),
          instance("Answer.run"),
          Effect.provide(
            Layer.mergeAll(
              DoProjects(namespace).pipe(Layer.provide(unlisted)),
              engine,
              caller.layer
            )
          ),
          Effect.exit
        );

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect(caller.console.errors()).toStrictEqual([]);
        expect(durable.console.errors()).toMatchObject([
          { message: "Error: no answer request req-none0001", project },
        ]);
      }).pipe(Effect.provide(world))
  );

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
