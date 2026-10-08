/**
 * The Checker's env (W6 611; VL §8.4–8.5): every `@sensitive` item reaches
 * the container as its placeholder, and a `@proxy` host's requests go
 * through the env gateway, which swaps the placeholder for the value only in
 * a run of landed code. Over the fake `Box` (`fake-box.ts`), and the gateway
 * itself with a fake upstream.
 */
import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { Command } from "@repo/protocol/domain/common";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AreaName,
  CommitSha,
  EnvKey,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  SuiteRoot,
} from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Exit, Redacted, Schema } from "effect";
import { vi } from "vitest";

import { Checker } from "../src/checker.ts";
import { CLONE_HOST, REGISTRIES } from "../src/checker/network.ts";
import { check } from "../src/checker/run.ts";
import { EnvGateway } from "../src/env-gateway.ts";
import type { EnvGatewayProps } from "../src/env-gateway.ts";
import { fakeChecker, fakeContainer } from "./fake-box.ts";
import type { Call } from "./fake-box.ts";
import { fakeEnv } from "./fake-env.ts";

const SETUP = "bun install --frozen-lockfile";

const UNIT = "bun test";

const run = RunBlock.make({
  checks: { [LaneName.make("unit")]: Command.make(UNIT) },
  setup: Command.make(SETUP),
  test: Command.make("bun test {path}"),
});

const SENTRY = EnvKey.make("SENTRY_AUTH_TOKEN");

const PLACEHOLDER = "__SENTRY_AUTH_TOKEN_PLACEHOLDER__";

/** The write-only value a landed run's gateway swaps in: never in the container. */
const VALUE = "sntrys_5f0c1d2e3b4a69788796a5b4c3d2e1f0";

const sentryRule = {
  block: false,
  host: "sentry.io",
  key: SENTRY,
  path: "/api/**",
  placeholder: PLACEHOLDER,
};

const jobWith = (env: Partial<CheckJob> = {}): CheckWire => ({
  clone: {
    token: Redacted.make("art_v1_read-only"),
    url: "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git",
  },
  job: {
    at: CheckAt.cases.Commit.make({ commit: CommitSha.make("a".repeat(40)) }),
    lanes: [{ command: UNIT, lane: LaneName.make("unit") }],
    placeholders: [{ key: SENTRY, placeholder: PLACEHOLDER }],
    project: ProjectName.make("datekit"),
    proxies: [sentryRule],
    repo: RepoName.make("datekit"),
    run,
    ...env,
  },
});

/** The env `sh -c <command>` ran with, for each run of `command`. */
const envsOf = (calls: readonly Call[], command: string) =>
  calls.flatMap((call) =>
    call.kind === "exec" && call.argv[0] === "sh" && call.argv[2] === command
      ? [call.options.env ?? {}]
      : []
  );

/** One job through the Checker over the fakes: what they saw. */
const checked = (wire: CheckWire) =>
  Effect.gen(function* () {
    const fake = fakeChecker();

    const outcome = yield* Effect.exit(
      check(wire).pipe(Effect.provide(fake.layer))
    );

    return { calls: fake.calls, outcome };
  });

/** A job of landed code, carrying the value its gateway swaps in. */
const landedJob = () =>
  jobWith({
    landed: true,
    values: [{ key: SENTRY, value: Redacted.make(VALUE) }],
  });

describe("the Checker's env", () => {
  it.effect(
    "sets each placeholder in the env of setup and of every lane, and no value, even in a landed job",
    () =>
      Effect.gen(function* () {
        for (const wire of [jobWith(), landedJob()]) {
          const { calls } = yield* checked(wire);

          const envs = [...envsOf(calls, SETUP), ...envsOf(calls, UNIT)];

          expect(envs).toHaveLength(2);

          for (const env of envs) {
            expect(env[SENTRY]).toBe(PLACEHOLDER);
            expect(Object.values(env)).not.toContain(VALUE);
          }
        }
      })
  );

  it.effect(
    "registers one intercept per proxied host, once egress is off and before any lane runs",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* checked(jobWith());

        const egressOff = calls.findIndex(
          (call) => call.kind === "allow" && call.hosts.length === 0
        );

        const firstLane = calls.findIndex(
          (call) =>
            call.kind === "exec" &&
            call.argv[0] === "sh" &&
            call.argv[2] === UNIT
        );

        const intercepts = calls.flatMap((call, at) =>
          call.kind === "intercept" ? [{ at, host: call.host }] : []
        );

        expect(intercepts.map(({ host }) => host)).toStrictEqual(["sentry.io"]);
        expect(egressOff).toBeGreaterThan(-1);
        expect(intercepts[0]?.at).toBeGreaterThan(egressOff);
        expect(intercepts[0]?.at).toBeLessThan(firstLane);
      })
  );

  it.effect(
    "intercepts HTTPS hosts only: an http:// host is left out, with the reason logged",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* checked(
          jobWith({
            proxies: [
              sentryRule,
              { ...sentryRule, host: "http://plain.example.com" },
              { ...sentryRule, host: "https://api.example.com" },
            ],
          })
        );

        expect(
          calls.flatMap((call) =>
            call.kind === "intercept" ? [call.host] : []
          )
        ).toStrictEqual(["sentry.io", "api.example.com"]);

        const reasons = calls.flatMap((call) =>
          call.kind === "log" &&
          call.annotations.host === "http://plain.example.com"
            ? [call.annotations.reason ?? ""]
            : []
        );

        expect(reasons).toHaveLength(1);
        expect(reasons[0]).toContain("HTTPS only");
      })
  );

  it.effect(
    "opens no env route beside a sealed suite: its checks run with the network off, seeing the placeholders",
    () =>
      Effect.gen(function* () {
        const sealedCheck = "bun test checks/held-back/parser/week-54.test.ts";

        const { calls } = yield* checked(
          jobWith({
            heldBack: {
              areas: [AreaName.make("parser")],
              at: CommitSha.make("b".repeat(40)),
              files: [
                {
                  area: AreaName.make("parser"),
                  content: new TextEncoder().encode("test('x', () => {});\n"),
                  path: RepoPath.make(
                    "checks/held-back/parser/week-54.test.ts"
                  ),
                },
              ],
              runs: [
                {
                  area: AreaName.make("parser"),
                  command: sealedCheck,
                  path: RepoPath.make(
                    "checks/held-back/parser/week-54.test.ts"
                  ),
                },
              ],
              suite: SuiteRoot.make(`sha256:${"5e".repeat(32)}`),
            },
            lanes: [],
          })
        );

        expect(calls.filter((call) => call.kind === "intercept")).toStrictEqual(
          []
        );
        expect(
          calls.flatMap((call) =>
            call.kind === "exec" && call.argv[2] === sealedCheck
              ? [{ network: call.network, token: call.options.env?.[SENTRY] }]
              : []
          )
        ).toStrictEqual([{ network: [], token: PLACEHOLDER }]);
        expect(
          calls.flatMap((call) =>
            call.kind === "log" && call.annotations.host === "sentry.io"
              ? [call.annotations.reason]
              : []
          )
        ).toStrictEqual(["a sealed suite runs with the network off"]);
      })
  );
});

/**
 * What the gateway sends on, in place of the network, until the scope
 * ends: each request, read, and the response `answer` gives for it.
 */
const upstream = (answer: (request: Request) => Response) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const sent: Request[] = [];

      vi.stubGlobal("fetch", (request: Request) => {
        sent.push(request);

        return Promise.resolve(answer(request));
      });

      return sent;
    }),
    () => Effect.sync(() => vi.unstubAllGlobals())
  );

/** A gateway for one job: its rules, and the values only a landed job's carries. */
const gatewayFor = (props: Partial<EnvGatewayProps> = {}) =>
  new EnvGateway(
    untouchable<ExecutionContext<EnvGatewayProps>>("ctx", {
      props: { rules: [sentryRule], values: [], ...props },
    }),
    fakeEnv()
  );

const landedValues = [{ key: SENTRY, placeholder: PLACEHOLDER, value: VALUE }];

const releaseRequest = () =>
  new Request("https://sentry.io/api/0/releases/", {
    body: JSON.stringify({ version: "1.4.0" }),
    headers: {
      authorization: `Bearer ${PLACEHOLDER}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

/** What reached the upstream: method, URL, every header, and the body. */
const readSent = (request: Request) =>
  Effect.promise(() => request.text()).pipe(
    Effect.map((body) => ({
      body,
      headers: Object.fromEntries(request.headers),
      method: request.method,
      url: request.url,
    }))
  );

const fetched = (gateway: EnvGateway, request: Request) =>
  Effect.promise(() => gateway.fetch(request)).pipe(
    Effect.flatMap((response) =>
      Effect.map(
        Effect.promise(() => response.text()),
        (text) => ({
          status: response.status,
          text,
        })
      )
    )
  );

describe("the env gateway", () => {
  it.effect(
    "for an unlanded job, sends a request its rules allow on with the placeholder unchanged, adding no header",
    () =>
      Effect.gen(function* () {
        const sent = yield* upstream(() => new Response("{}"));

        const answered = yield* fetched(gatewayFor(), releaseRequest());

        expect(answered.status).toBe(200);
        expect(yield* Effect.forEach(sent, readSent)).toStrictEqual([
          {
            body: '{"version":"1.4.0"}',
            headers: {
              authorization: `Bearer ${PLACEHOLDER}`,
              "content-type": "application/json",
            },
            method: "POST",
            url: "https://sentry.io/api/0/releases/",
          },
        ]);
      })
  );

  it.effect(
    "answers 403 outside the rules' path or method, to a block rule, and to plain HTTP, sending nothing on",
    () =>
      Effect.gen(function* () {
        const sent = yield* upstream(() => new Response("{}"));

        const statuses = yield* Effect.forEach(
          [
            [gatewayFor(), new Request("https://sentry.io/other")],
            [
              gatewayFor({ rules: [{ ...sentryRule, method: "GET" }] }),
              releaseRequest(),
            ],
            [
              gatewayFor({ rules: [{ ...sentryRule, block: true }] }),
              releaseRequest(),
            ],
            [
              gatewayFor({
                rules: [sentryRule, { ...sentryRule, block: true }],
                values: landedValues,
              }),
              releaseRequest(),
            ],
            [gatewayFor(), new Request("http://sentry.io/api/0/releases/")],
            [gatewayFor(), new Request("https://other.example.com/api/x")],
          ] as const,
          ([gateway, request]) =>
            Effect.map(fetched(gateway, request), ({ status }) => status)
        );

        expect(statuses).toStrictEqual([403, 403, 403, 403, 403, 403]);
        expect(sent).toStrictEqual([]);
      })
  );

  it.effect(
    "for a landed job, swaps the placeholder in the headers for the value, and scrubs the value from a small JSON answer",
    () =>
      Effect.gen(function* () {
        const sent = yield* upstream((request) =>
          Response.json({ echoed: request.headers.get("authorization") })
        );

        const answered = yield* fetched(
          gatewayFor({ values: landedValues }),
          releaseRequest()
        );

        expect(
          (yield* Effect.forEach(sent, readSent)).map(({ headers }) => headers)
        ).toStrictEqual([
          {
            authorization: `Bearer ${VALUE}`,
            "content-type": "application/json",
          },
        ]);
        expect(answered).toStrictEqual({
          status: 200,
          text: JSON.stringify({ echoed: `Bearer ${PLACEHOLDER}` }),
        });
      })
  );

  it.effect(
    "scrubs a value that a streamed text answer splits across chunks, and leaves a binary answer as it is",
    () =>
      Effect.gen(function* () {
        const cut = 12;
        const bytes = new Uint8Array([0, 1, 2, 255]);

        yield* upstream((request) =>
          request.method === "GET"
            ? new Response(bytes, {
                headers: { "content-type": "application/octet-stream" },
              })
            : new Response(
                new ReadableStream({
                  start: (controller) => {
                    const encoder = new TextEncoder();

                    controller.enqueue(
                      encoder.encode(`{"token":"${VALUE.slice(0, cut)}`)
                    );
                    controller.enqueue(
                      encoder.encode(`${VALUE.slice(cut)}","ok":true}`)
                    );
                    controller.close();
                  },
                }),
                { headers: { "content-type": "application/json" } }
              )
        );

        const gateway = gatewayFor({
          rules: [{ ...sentryRule, method: "GET, POST" }],
          values: landedValues,
        });

        const streamed = yield* fetched(gateway, releaseRequest());

        const binary = yield* Effect.flatMap(
          Effect.promise(() =>
            gateway.fetch(new Request("https://sentry.io/api/0/blob"))
          ),
          (response) => Effect.promise(() => response.arrayBuffer())
        );

        expect(streamed).toStrictEqual({
          status: 200,
          text: `{"token":"${PLACEHOLDER}","ok":true}`,
        });
        expect(new Uint8Array(binary)).toStrictEqual(bytes);
      })
  );

  it.effect(
    "refuses a request two rules match with one placeholder for two keys",
    () =>
      Effect.gen(function* () {
        const sent = yield* upstream(() => new Response("{}"));

        const answered = yield* fetched(
          gatewayFor({
            rules: [
              sentryRule,
              { ...sentryRule, key: EnvKey.make("SENTRY_ORG_TOKEN") },
            ],
            values: landedValues,
          }),
          releaseRequest()
        );

        expect(answered.status).toBe(403);
        expect(sent).toStrictEqual([]);
      })
  );

  it.effect(
    "scrubs a value that holds another whole, leaving no part of it in the response",
    () =>
      Effect.gen(function* () {
        const password = "hunter2-0123456789abcdef";
        const url = `postgres://ci:${password}@db.example.com/app`;

        yield* upstream(() => Response.json({ connected: url }));

        const answered = yield* fetched(
          gatewayFor({
            values: [
              {
                key: EnvKey.make("DB_PASSWORD"),
                placeholder: "__DB_PASSWORD_PLACEHOLDER__",
                value: password,
              },
              {
                key: EnvKey.make("DATABASE_URL"),
                placeholder: "__DATABASE_URL_PLACEHOLDER__",
                value: url,
              },
            ],
          }),
          releaseRequest()
        );

        expect(answered).toStrictEqual({
          status: 200,
          text: JSON.stringify({ connected: "__DATABASE_URL_PLACEHOLDER__" }),
        });
      })
  );
});

/**
 * One job through a Checker Durable Object over a fake container (the
 * Container API as `fake-box.ts` records it): the calls it made.
 */
const inContainer = (wire: CheckWire) =>
  Effect.gen(function* () {
    const box = fakeContainer();

    const index = untouchable<DurableObjectStub<Checker>>("index", {
      forgetSnapshot: () => Promise.resolve(),
      keepSnapshot: () => Promise.resolve(),
      snapshotOf: () => Promise.resolve(null),
    });

    const checker = new Checker(
      untouchable<DurableObjectState>("ctx", {
        container: box.container,
        exports: {
          ...untouchable<Cloudflare.Exports>("exports"),
          ...box.exports,
        },
      }),
      {
        CHECKER: untouchable<Env["CHECKER"]>("CHECKER", {
          getByName: () => index,
        }),
        LANDER: untouchable("LANDER"),
      }
    );

    const encoded = yield* Schema.encodeEffect(CheckWire)(wire).pipe(
      Effect.orDie
    );

    const outcome = yield* Effect.flatMap(
      Effect.promise(() => checker.check(encoded)),
      Schema.decodeEffect(CheckExit)
    );

    return { calls: box.calls, outcome };
  });

describe("the Checker's container", () => {
  it.effect(
    "intercepts each proxied host ahead of the catch-all, with the egress gateway until egress is off and the env gateway after",
    () =>
      Effect.gen(function* () {
        const { calls, outcome } = yield* inContainer(landedJob());
        const registries = `egress [${REGISTRIES.join(" ")}]`;

        expect(Exit.isSuccess(outcome)).toBeTruthy();
        expect(
          calls.flatMap((call) =>
            call.kind === "intercept" && call.target !== CLONE_HOST
              ? [`${call.target} → ${call.to}`]
              : []
          )
        ).toStrictEqual([
          "sentry.io → egress []",
          "* → egress []",
          "http:* → egress []",
          `sentry.io → ${registries}`,
          `* → ${registries}`,
          `http:* → ${registries}`,
          "sentry.io → egress []",
          "* → egress []",
          "http:* → egress []",
          "sentry.io → env [sentry.io] 1 values",
          "* → egress []",
          "http:* → egress []",
        ]);
      })
  );

  it.effect(
    "for a landed job, puts no value in the container: not in a command, its env, or a gateway's description of its props",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* inContainer(landedJob());

        const lanes = calls.flatMap((call) =>
          call.kind === "exec" && call.argv[2] === UNIT ? [call.env] : []
        );

        expect(lanes.map((env) => env[SENTRY])).toStrictEqual([PLACEHOLDER]);
        expect(JSON.stringify(calls)).not.toContain(VALUE);
      })
  );
});

describe("a check job's env part", () => {
  it.effect(
    "carries values only for landed code: an unlanded job with one neither encodes nor decodes, and the error holds no value",
    () =>
      Effect.gen(function* () {
        const unlanded = jobWith({
          values: [{ key: SENTRY, value: Redacted.make(VALUE) }],
        });

        const encoded = yield* Schema.encodeEffect(CheckWire)(landedJob()).pipe(
          Effect.orDie
        );

        const encoding = yield* Effect.flip(
          Schema.encodeEffect(CheckWire)(unlanded)
        );

        const decoding = yield* Effect.flip(
          Schema.decodeEffect(CheckWire)({
            ...encoded,
            job: { ...encoded.job, landed: false },
          })
        );

        for (const failure of [encoding, decoding]) {
          expect(failure.message).toContain(
            "only a job of landed code carries values"
          );
          expect(failure.message).not.toContain(VALUE);
        }
      })
  );

  it.effect(
    "hands the env gateway a landed job's values for its proxied keys alone",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* checked(
          jobWith({
            landed: true,
            values: [
              { key: SENTRY, value: Redacted.make(VALUE) },
              {
                key: EnvKey.make("DATEKIT_SIGNING_KEY"),
                value: Redacted.make("unproxied-signing-key-0123456789"),
              },
            ],
          })
        );

        expect(calls.filter((call) => call.kind === "intercept")).toStrictEqual(
          [{ host: "sentry.io", kind: "intercept", values: 1 }]
        );
        expect(JSON.stringify(calls)).not.toContain(VALUE);
      })
  );

  it.effect(
    "hands the env gateway no value for a job that is not landed, even one that reached the Checker carrying values",
    () =>
      Effect.gen(function* () {
        // Past the codec, which refuses such a job: the Checker's own
        // filter still keeps the value from the gateway.
        const { calls } = yield* checked(
          jobWith({ values: [{ key: SENTRY, value: Redacted.make(VALUE) }] })
        );

        expect(calls.filter((call) => call.kind === "intercept")).toStrictEqual(
          [{ host: "sentry.io", kind: "intercept", values: 0 }]
        );
      })
  );
});
