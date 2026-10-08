import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import {
  FetchHttpClient,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { NoStage, UnknownStage } from "../../../infra/stages.ts";
import {
  main,
  NoOrigin,
  platformProbes,
  probes,
  smoke,
  SmokeFailed,
  webProbes,
} from "../../../scripts/smoke.ts";

/** What the fake platform answers one request with. */
interface Reply {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}

/** A request as the fake platform sees it. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorized: boolean;
  readonly body: string;
}

/** A call as effect/rpc's HTTP protocol sends one, with JSON serialization. */
const ListAsksCall = Schema.fromJsonString(
  Schema.Tuple([
    Schema.TaggedStruct("Request", {
      headers: Schema.Array(Schema.Unknown),
      id: Schema.String,
      payload: Schema.Struct({ project: Schema.String }),
      tag: Schema.Literal("listAsks"),
    }),
  ])
);

/**
 * The platform's `/rpc` reply to `body`: the bytes its server sent for an
 * anonymous `listAsks` of a project it doesn't hold (captured from
 * `apps/platform`'s `serve` before any project existed, the refusal's
 * `next` aside), or a 400 for anything else.
 */
const rpcReply = (body: string): Reply =>
  Option.match(Schema.decodeOption(ListAsksCall)(body), {
    onNone: () => ({ status: 400 }),
    onSome: ([{ id, payload }]) => ({
      body: `[{"_tag":"Exit","requestId":${JSON.stringify(id)},"exit":{"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"UnknownProject","next":"asks","retryable":false,"project":${JSON.stringify(payload.project)}}}]}}]`,
      status: 200,
    }),
  });

/**
 * The platform as smoke expects to find it: healthy, OAuth's resource
 * metadata published, MCP closed to anyone without a credential, anonymous
 * reads open, and no repo it doesn't hold.
 */
const healthy = ({ authorized, body, method, path }: Seen): Reply => {
  if (method === "GET" && path === "/health") {
    return { body: '{"ok":true,"stage":"dev-oscabriel"}', status: 200 };
  }

  if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return {
      body: '{"resource":"https://platform-dev-oscabriel.example.workers.dev","authorization_servers":["https://platform-dev-oscabriel.example.workers.dev"]}',
      status: 200,
    };
  }

  if (method === "POST" && path === "/mcp") {
    return authorized ? { body: "{}", status: 200 } : { status: 401 };
  }

  if (method === "POST" && path === "/rpc" && !authorized) {
    return rpcReply(body);
  }

  return { status: 404 };
};

/**
 * A platform whose 401 gate is gone and whose stage is down: `/health` and
 * `/rpc` break, MCP opens to anyone, and git's paths answer 200.
 */
const broken = (seen: Seen): Reply => {
  if (seen.path === "/health") {
    return { body: "upstream connect error", status: 503 };
  }

  if (seen.path === "/mcp") {
    return { body: "{}", status: 200 };
  }

  if (seen.path === "/rpc") {
    return { status: 401 };
  }

  if (seen.path.endsWith("/info/refs")) {
    return { body: "001e# service=git-upload-pack\n0000", status: 200 };
  }

  return healthy(seen);
};

/** `answer` served on an ephemeral local port, for the test's scope: its origin. */
const fakePlatform = (answer: (seen: Seen) => Reply) =>
  Effect.gen(function* () {
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://localhost");

      const reply = answer({
        authorized: request.headers.authorization !== undefined,
        body: yield* Effect.orDie(request.text),
        method: request.method,
        path: url.pathname,
      });

      return reply.body === undefined
        ? HttpServerResponse.empty({ status: reply.status })
        : HttpServerResponse.text(reply.body, {
            contentType: reply.contentType ?? "application/json",
            status: reply.status,
          });
    });

    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    return "port" in address
      ? `http://127.0.0.1:${address.port}`
      : yield* Effect.die("the fake platform listens on a socket, not a port");
  });

describe("smoke against a live stage", () => {
  it.live("passes every probe against a healthy platform, and times each", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(healthy);
      const report = yield* smoke(origin);

      expect(report.origin).toBe(origin);
      expect(report.stage).toBe("dev-oscabriel");
      expect(report.probes.map(({ probe }) => probe)).toStrictEqual([
        ...platformProbes,
      ]);
      expect(
        report.probes.every(({ elapsedMs }) => elapsedMs >= 0)
      ).toBeTruthy();
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  // Live on dev-oscabriel (311): the first smoke after the first deploy got
  // a 500 from /health and a defect from the first Project DO call, and a
  // second run seconds later passed every probe.
  it.live(
    "asks again while a fresh deploy answers with a server error or a defect, and passes once it settles",
    () =>
      Effect.gen(function* () {
        const asked = { health: 0, rpc: 0 };

        const origin = yield* fakePlatform((seen) => {
          if (seen.path === "/health") {
            asked.health += 1;

            if (asked.health <= 2) {
              return { body: "internal error", status: 500 };
            }
          }

          if (seen.path === "/rpc") {
            asked.rpc += 1;

            if (asked.rpc === 1) {
              return {
                body: '[{"_tag":"Defect","defect":{"name":"UnknownError","message":"An error occurred in Effect.tryPromise"}}]',
                status: 200,
              };
            }
          }

          return healthy(seen);
        });

        const report = yield* smoke(origin, { settling: "10 seconds" });

        expect({
          asked,
          probes: report.probes.map(({ probe }) => probe),
        }).toStrictEqual({
          asked: { health: 3, rpc: 2 },
          probes: [...platformProbes],
        });
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live("names each probe that fails, and why", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(broken);

      const result = yield* Effect.result(
        smoke(origin, { settling: "1 second" })
      );

      expect(Result.isFailure(result)).toBeTruthy();

      const failed = Result.isFailure(result) ? result.failure : undefined;

      expect(failed).toBeInstanceOf(SmokeFailed);
      expect(failed?.failures).toStrictEqual([
        { probe: "health", reason: "GET /health answered 503, not 200" },
        {
          probe: "mcp-needs-credential",
          reason: "POST /mcp without a credential answered 200, not 401",
        },
        {
          probe: "anonymous-unknown-project",
          reason: "POST /rpc listAsks answered 401, not 200",
        },
        {
          probe: "missing-repo-404",
          reason: "GET /no-such-project.git/info/refs answered 200, not 404",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live("fails every probe when nothing listens at the origin", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(smoke("http://127.0.0.1:9"));

      expect(
        Result.isFailure(result)
          ? result.failure.failures.map(({ probe }) => probe)
          : []
      ).toStrictEqual([...platformProbes]);
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );
});

/**
 * The web as smoke expects to find it (W5 599): its front page renders, and
 * its `/llms.txt` answers with the Markdown it builds from the platform's
 * project list, which only a web that reaches the platform can.
 */
const healthyWeb = ({ method, path }: Seen): Reply => {
  if (method === "GET" && path === "/") {
    return {
      body: '<!DOCTYPE html><html lang="en"><head></head><body></body></html>',
      contentType: "text/html; charset=utf-8",
      status: 200,
    };
  }

  if (method === "GET" && path === "/llms.txt") {
    return {
      body: "# Platform\n\n> A Git platform.\n",
      contentType: "text/markdown; charset=utf-8",
      status: 200,
    };
  }

  return { status: 404 };
};

describe("smoke against a stage's web", () => {
  it.live(
    "passes the front page and /llms.txt from the web, after every platform probe",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform(healthy);
        const web = yield* fakePlatform(healthyWeb);
        const report = yield* smoke(origin, { web });

        expect(report.probes.map(({ probe }) => probe)).toStrictEqual([
          ...probes,
        ]);
        expect(webProbes).toStrictEqual(["web-front-page", "web-llms-txt"]);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live(
    "fails the web's probes when its front page is not HTML and its /llms.txt cannot reach the platform",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform(healthy);

        const web = yield* fakePlatform((seen) =>
          seen.path === "/llms.txt"
            ? {
                body: "# Unavailable\n\nThe platform did not answer.\n",
                contentType: "text/markdown; charset=utf-8",
                status: 503,
              }
            : { body: "{}", contentType: "application/json", status: 200 }
        );

        const result = yield* Effect.result(
          smoke(origin, { settling: "1 second", web })
        );

        expect(
          Result.isFailure(result) ? result.failure.failures : []
        ).toStrictEqual([
          {
            probe: "web-front-page",
            reason: "GET / on the web answered application/json, not HTML",
          },
          {
            probe: "web-llms-txt",
            reason: "GET /llms.txt on the web answered 503, not 200",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );
});

describe("smoke's own checks", () => {
  it.live("fails health when the platform serves another stage", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(healthy);
      const result = yield* Effect.result(smoke(origin, { stage: "demo" }));

      expect(result).toStrictEqual(
        Result.fail(
          new SmokeFailed({
            failures: [
              {
                probe: "health",
                reason: "GET /health named stage dev-oscabriel, not demo",
              },
            ],
            origin,
          })
        )
      );
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live(
    "fails the anonymous read when /rpc answers it with anything but UnknownProject",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform((seen) =>
          seen.path === "/rpc"
            ? {
                body: '[{"_tag":"Exit","requestId":"1","exit":{"_tag":"Success","value":{"asks":[]}}}]',
                status: 200,
              }
            : healthy(seen)
        );

        const result = yield* Effect.result(smoke(origin));

        expect(
          Result.isFailure(result) ? result.failure.failures : []
        ).toStrictEqual([
          {
            probe: "anonymous-unknown-project",
            reason:
              "POST /rpc listAsks for no-such-project answered 200 without an UnknownProject refusal",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );
});

describe("the smoke command", () => {
  it.live("refuses without a stage it knows, before it probes anything", () =>
    Effect.gen(function* () {
      const seen: string[] = [];

      const origin = yield* fakePlatform((request) => {
        seen.push(request.path);

        return healthy(request);
      });

      expect(yield* Effect.flip(main(["--url", origin]))).toStrictEqual(
        new NoStage()
      );
      expect(
        yield* Effect.flip(main(["--stage", "prod", "--url", origin]))
      ).toStrictEqual(new UnknownStage({ stage: "prod" }));
      expect(seen).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("smoke-tests the stage at --url, and names a stage mismatch", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(healthy);

      yield* main(["--stage", "dev-oscabriel", "--url", `${origin}/`]);

      const failed = yield* Effect.flip(
        main(["--stage", "demo", "--url", origin])
      );

      expect(
        Schema.is(SmokeFailed)(failed)
          ? failed.failures.map(({ probe }) => probe)
          : []
      ).toStrictEqual(["health"]);
      // `runMain` prints a failure as its tag and its message, and nothing else.
      expect(failed.message).toBe(`health failed at ${origin}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("probes the web at --web-url, and only there, beside --url", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(healthy);
      const web = yield* fakePlatform(() => ({ status: 404 }));

      yield* main(["--stage", "dev-oscabriel", "--url", origin]);

      const failed = yield* Effect.flip(
        main(["--stage", "dev-oscabriel", "--url", origin, "--web-url", web])
      );

      expect(
        Schema.is(SmokeFailed)(failed)
          ? failed.failures.map(({ probe }) => probe)
          : []
      ).toStrictEqual([...webProbes]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("says to bootstrap first when neither --url nor bootstrap's record names the origin", () => {
    const failed = new NoOrigin({
      file: "infra/workers-dev.json",
      stage: "demo",
    });

    expect(failed.message).toBe(
      "no --url, and infra/workers-dev.json doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage demo first"
    );
  });
});
