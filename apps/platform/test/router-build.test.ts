import { describe, expect, it } from "@effect/vitest";
import { untouchable } from "@repo/testkit/untouchable";
import { env } from "cloudflare:workers";
import { Effect, Layer, Scheduler, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { oauthProvider, signInServices } from "../src/auth/provider.ts";
import { decodeEnv, platformOf } from "../src/platform.ts";
import { buildHandler } from "../src/router-build.ts";
import { serve } from "../src/surfaces.ts";
import { callsTo, fakeEnv } from "./fake-env.ts";
import { origin } from "./harness.ts";

const context = untouchable<ExecutionContext>("ExecutionContext");

const ping = HttpRouter.use((router) =>
  router.add("GET", "/ping", Effect.succeed(HttpServerResponse.text("pong")))
);

const counted = () => {
  const builds: number[] = [];

  const layer = Layer.merge(
    ping,
    Layer.effectDiscard(Effect.sync(() => builds.push(builds.length + 1)))
  );

  return { builds, layer };
};

const awaiting = Layer.merge(
  ping,
  Layer.effectDiscard(Effect.promise(() => Promise.resolve()))
);

const capturing = Layer.unwrap(
  Effect.map(Effect.context(), (built) =>
    HttpRouter.use((router) =>
      router.add(
        "GET",
        "/scheduler",
        Scheduler.Scheduler.useSync(({ executionMode }) =>
          HttpServerResponse.text(executionMode)
        ).pipe(Effect.provideContext(built))
      )
    )
  )
);

const pinged = (handler: (request: Request) => Promise<Response>) =>
  Effect.promise(() => handler(new Request(`${origin}/ping`))).pipe(
    Effect.flatMap((response) => Effect.promise(() => response.text()))
  );

describe("the router's build", () => {
  it.effect(
    "is done when the handler is made, and no request builds it again",
    () =>
      Effect.gen(function* () {
        const { builds, layer } = counted();

        const { dispose, handler } = buildHandler(layer);

        expect(builds).toStrictEqual([1]);

        const answers = yield* Effect.all([
          pinged(handler),
          pinged(handler),
          pinged(handler),
        ]);

        expect(answers).toStrictEqual(["pong", "pong", "pong"]);
        expect(builds).toStrictEqual([1]);

        yield* Effect.promise(dispose);
      })
  );

  it("refuses a layer that awaits a promise while it is built, where the handler is made", () => {
    expect(() => buildHandler(awaiting)).toThrow(/awaited/u);
  });

  it.effect(
    "leaves a request that runs in a context captured at build on the default scheduler",
    () =>
      Effect.gen(function* () {
        const { dispose, handler } = buildHandler(capturing);

        const mode = yield* Effect.promise(() =>
          handler(new Request(`${origin}/scheduler`))
        ).pipe(
          Effect.flatMap((response) => Effect.promise(() => response.text()))
        );

        expect(mode).toBe("async");

        yield* Effect.promise(dispose);
      })
  );
});

const Health = Schema.fromJsonString(
  Schema.Struct({ ok: Schema.Boolean, stage: Schema.String })
);

describe("the Worker's two handlers", () => {
  it.effect(
    "are built when the Worker module has loaded, before any request",
    () =>
      Effect.gen(function* () {
        const before = callsTo(env.PROJECT).length;

        const worker = yield* Effect.promise(() => import("../src/worker.ts"));

        expect(Object.keys(worker.default)).toStrictEqual(["fetch"]);
        expect(callsTo(env.PROJECT)).toHaveLength(before);
      })
  );

  it.effect(
    "build at once from the decoded env, touching no binding, and answer the first request",
    () =>
      Effect.gen(function* () {
        const shim = fakeEnv();

        const config = yield* decodeEnv(shim).pipe(Effect.orDie);

        const platform = serve(platformOf(config));

        const { handler } = oauthProvider(signInServices(config), (request) =>
          platform.handler(request)
        );

        expect(callsTo(shim.PROJECT)).toStrictEqual([]);

        const health = yield* Effect.promise(() =>
          Promise.resolve(
            handler.fetch(new Request(`${origin}/health`), env, context)
          )
        );

        expect(health.status).toBe(200);
        expect(
          yield* Effect.promise(() => health.text()).pipe(
            Effect.flatMap(Schema.decodeEffect(Health)),
            Effect.orDie
          )
        ).toStrictEqual({ ok: true, stage: "local" });

        yield* Effect.promise(platform.dispose);
      })
  );
});
