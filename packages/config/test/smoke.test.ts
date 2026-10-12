import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import {
  FetchHttpClient,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { AGENT_BUDGET_MS, agentProbes } from "../../../infra/smoke.ts";
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

interface Reply {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly delayMs?: number;
}

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorized: boolean;
  readonly body: string;
}

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
 * The bytes of another project's reply were captured from `apps/platform`'s
 * `serve` before any project existed, the refusal's `next` aside.
 */
const rpcReply = (body: string, held: readonly string[]): Reply =>
  Option.match(Schema.decodeOption(ListAsksCall)(body), {
    onNone: () => ({ status: 400 }),
    onSome: ([{ id, payload }]) => ({
      body: held.includes(payload.project)
        ? `[{"_tag":"Exit","requestId":${JSON.stringify(id)},"exit":{"_tag":"Success","value":{"asks":[]}}}]`
        : `[{"_tag":"Exit","requestId":${JSON.stringify(id)},"exit":{"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"UnknownProject","next":"asks","retryable":false,"project":${JSON.stringify(payload.project)}}}]}}]`,
      status: 200,
    }),
  });

const holding =
  (held: readonly string[]) =>
  ({ authorized, body, method, path }: Seen): Reply => {
    if (method === "GET" && path === "/") {
      return {
        body: "<!doctype html><p><code>http://127.0.0.1/mcp</code></p><pre>curl -fsSL http://127.0.0.1/install.sh | sh</pre>",
        contentType: "text/html; charset=utf-8",
        status: 200,
      };
    }

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
      return rpcReply(body, held);
    }

    return { status: 404 };
  };

const healthy = holding(["oscabriel/datekit"]);

const broken = (seen: Seen): Reply => {
  if (seen.path === "/") {
    return { status: 404 };
  }

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

      if (reply.delayMs !== undefined) {
        yield* Effect.sleep(`${reply.delayMs} millis`);
      }

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
      expect(platformProbes).toStrictEqual([
        "health",
        "oauth-metadata",
        "mcp-needs-credential",
        "anonymous-unknown-project",
        "missing-repo-404",
        "platform-root",
      ]);
      expect(
        report.probes.every(({ elapsedMs }) => elapsedMs >= 0)
      ).toBeTruthy();
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  // Seen live: the first smoke after a first deploy got a 500 from /health and
  // a defect from the first Project DO call; a run seconds later passed.
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

  it.live(
    "asks / again while the version before a deploy still answers it with 404, and passes once it settles",
    () =>
      Effect.gen(function* () {
        // A deploy that added `/`: smoke ran as the upload finished, and the
        // version before, which has no `/`, answered it once more with 404.
        const asked = { root: 0 };

        const origin = yield* fakePlatform((seen) => {
          if (seen.path === "/") {
            asked.root += 1;

            if (asked.root <= 2) {
              return { status: 404 };
            }
          }

          return healthy(seen);
        });

        const report = yield* smoke(origin, { settling: "10 seconds" });

        expect({
          asked,
          probes: report.probes.map(({ probe }) => probe),
        }).toStrictEqual({ asked: { root: 3 }, probes: [...platformProbes] });
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
          reason:
            "GET /oscabriel/no-such-project.git/info/refs answered 200, not 404",
        },
        { probe: "platform-root", reason: "GET / answered 404, not 200" },
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

  if (
    method === "GET" &&
    (path === "/oscabriel/datekit/llms.txt" ||
      path === "/oscabriel/datekit/asks/format-ordinal.md")
  ) {
    return {
      body: "# oscabriel/datekit\n",
      contentType: "text/markdown; charset=utf-8",
      status: 200,
    };
  }

  if (method === "GET" && path === "/.well-known/agent-skills/index.json") {
    return {
      body: '{"skills":[]}',
      contentType: "application/json",
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
        expect(webProbes).toStrictEqual([
          "web-front-page",
          "web-llms-txt",
          "web-project-llms-txt",
          "web-ask-md",
          "web-agent-skills",
        ]);
        expect(report.warnings).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it("probes each agent surface by its path and content type, against a 500 ms budget", () => {
    expect({ agentProbes, budget: AGENT_BUDGET_MS }).toStrictEqual({
      agentProbes: [
        {
          contentType: "text/markdown",
          path: "/llms.txt",
          probe: "web-llms-txt",
        },
        {
          contentType: "text/markdown",
          path: "/oscabriel/datekit/llms.txt",
          probe: "web-project-llms-txt",
        },
        {
          contentType: "text/markdown",
          path: "/oscabriel/datekit/asks/format-ordinal.md",
          probe: "web-ask-md",
        },
        {
          contentType: "application/json",
          path: "/.well-known/agent-skills/index.json",
          probe: "web-agent-skills",
        },
      ],
      budget: 500,
    });
  });

  it.live(
    "skips the seeded example's two probes, with a warning, on a stage that does not hold it",
    () =>
      Effect.gen(function* () {
        // A stage deployed before its examples are seeded: smoke runs after
        // every deploy, the seed only after the first.
        const origin = yield* fakePlatform(holding([]));
        const asked: string[] = [];

        const web = yield* fakePlatform((seen) => {
          asked.push(seen.path);

          return healthyWeb(seen);
        });

        const report = yield* smoke(origin, { web });

        expect({
          asked,
          probes: report.probes.map(({ probe }) => probe),
          warnings: report.warnings,
        }).toStrictEqual({
          asked: ["/", "/llms.txt", "/.well-known/agent-skills/index.json"],
          probes: probes.filter(
            (probe) =>
              probe !== "web-project-llms-txt" && probe !== "web-ask-md"
          ),
          warnings: [
            "web-project-llms-txt was skipped: oscabriel/datekit is not on this stage (bun run seed puts it there)",
            "web-ask-md was skipped: oscabriel/datekit is not on this stage (bun run seed puts it there)",
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live(
    "warns, and still passes, when an agent surface answers past its budget",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform(healthy);

        const web = yield* fakePlatform((seen) =>
          seen.path === "/.well-known/agent-skills/index.json"
            ? { ...healthyWeb(seen), delayMs: AGENT_BUDGET_MS + 100 }
            : healthyWeb(seen)
        );

        const report = yield* smoke(origin, { web });

        expect({
          budgets: report.probes.flatMap(({ budgetMs, probe }) =>
            budgetMs === undefined ? [] : [[probe, budgetMs]]
          ),
          probes: report.probes.map(({ probe }) => probe),
          warnings: report.warnings.map((line) =>
            line.replace(/\d+ ms,/u, "N ms,")
          ),
        }).toStrictEqual({
          budgets: [
            ["web-llms-txt", 500],
            ["web-project-llms-txt", 500],
            ["web-ask-md", 500],
            ["web-agent-skills", 500],
          ],
          probes: [...probes],
          warnings: [
            "web-agent-skills answered in N ms, over its 500 ms budget",
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  // Seen live: smoke ran 4 s after the web Worker's first deploy, and its new
  // workers.dev hostname answered 404; a run seconds later passed.
  it.live(
    "asks the web again while a first deploy's hostname answers 404, and passes once it settles",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform(healthy);
        const asked = new Map<string, number>();

        const web = yield* fakePlatform((seen) => {
          const count = (asked.get(seen.path) ?? 0) + 1;

          asked.set(seen.path, count);

          return count <= 2 ? { status: 404 } : healthyWeb(seen);
        });

        const report = yield* smoke(origin, { settling: "10 seconds", web });

        expect({
          asked: Object.fromEntries(asked),
          probes: report.probes.map(({ probe }) => probe),
        }).toStrictEqual({
          asked: {
            "/": 3,
            "/.well-known/agent-skills/index.json": 3,
            "/llms.txt": 3,
            "/oscabriel/datekit/asks/format-ordinal.md": 3,
            "/oscabriel/datekit/llms.txt": 3,
          },
          probes: [...probes],
        });
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
    30_000
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
          {
            probe: "web-project-llms-txt",
            reason:
              "GET /oscabriel/datekit/llms.txt on the web answered application/json, not text/markdown",
          },
          {
            probe: "web-ask-md",
            reason:
              "GET /oscabriel/datekit/asks/format-ordinal.md on the web answered application/json, not text/markdown",
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
              "POST /rpc listAsks for oscabriel/no-such-project answered 200 without an UnknownProject refusal",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  it.live(
    "fails the platform's / when it names neither MCP nor the installer",
    () =>
      Effect.gen(function* () {
        const origin = yield* fakePlatform((seen) =>
          seen.path === "/"
            ? {
                body: "<!doctype html><p>Hello</p>",
                contentType: "text/html; charset=utf-8",
                status: 200,
              }
            : healthy(seen)
        );

        const result = yield* Effect.result(smoke(origin));

        expect(
          Result.isFailure(result) ? result.failure.failures : []
        ).toStrictEqual([
          {
            probe: "platform-root",
            reason: "GET / answered 200 without naming /mcp and install.sh",
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
      expect(failed.message).toBe(`health failed at ${origin}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("probes the web at --web-url, and only there, beside --url", () =>
    Effect.gen(function* () {
      const origin = yield* fakePlatform(healthy);
      const web = yield* fakePlatform(() => ({ body: "{}", status: 200 }));

      yield* main(["--stage", "dev-oscabriel", "--url", origin]);

      const failed = yield* Effect.flip(
        main(["--stage", "dev-oscabriel", "--url", origin, "--web-url", web])
      );

      expect(
        Schema.is(SmokeFailed)(failed)
          ? failed.failures.map(({ probe }) => probe)
          : []
      ).toStrictEqual(
        webProbes.filter((probe) => probe !== "web-agent-skills")
      );
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
