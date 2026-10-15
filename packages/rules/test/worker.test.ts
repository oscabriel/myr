import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import { Policy, PolicyInput } from "@repo/protocol/domain/policy";
import { LandedSha } from "@repo/protocol/ids";
import { ClaimantFacts } from "@repo/sdk";
import { Effect, Layer, Path, Result, Schema } from "effect";
import type { FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { defaultPolicyInput } from "../src/defaults.ts";
import { Finishers } from "../src/finish.ts";
import { mainModule, preludeModule } from "../src/prelude.ts";
import { RulesEvaluator } from "../src/rules-evaluator.ts";
import type { ConfigBundle, RuleCall } from "../src/rules-evaluator.ts";
import { RulesEvaluatorJson } from "../src/rules-evaluator/json.ts";
import { RulesEvaluatorWorker } from "../src/rules-evaluator/worker.ts";
import type {
  LoaderBinding,
  LoaderCode,
  WorkerOptions,
} from "../src/rules-evaluator/worker.ts";
import { bunLoader, fakeLoader } from "./fake-loader.ts";
import type { Answer } from "./fake-loader.ts";
import {
  at,
  bundleOf,
  bunEvaluator,
  facts,
  finishers,
  folder,
  now,
  nowMs,
} from "./world.ts";

const workerEvaluator = (loader: LoaderBinding, options?: WorkerOptions) =>
  RulesEvaluatorWorker(loader, options).pipe(
    Layer.provide(Layer.succeed(Finishers, finishers))
  );

const encoded = (policy: Policy) =>
  Effect.orDie(Schema.encodeEffect(Policy)(policy));

const evaluated = (modules: ConfigBundle, landed = at) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    return yield* Effect.result(
      evaluator
        .evaluate({ at: landed, facts, modules })
        .pipe(Effect.flatMap(encoded))
    );
  });

const called = (modules: ConfigBundle, call: RuleCall) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    return yield* Effect.result(evaluator.call({ ...call, at, modules }));
  });

const reasonOf = <A>(
  result: Result.Result<A, { readonly reason: string }>
): string => {
  assert(Result.isFailure(result), "expected the evaluation to fail");

  return result.failure.reason;
};

const decodeClaimant = Schema.decodeUnknownSync(ClaimantFacts);

const claimant = (record: number): RuleCall => ({
  facts: decodeClaimant({
    handle: "bram",
    kind: "fixBug",
    record,
    territory: "@datekit/parse",
    vouched: true,
  }),
  rule: "admit",
});

const baseEncoded = Schema.encodeSync(PolicyInput)({
  ...defaultPolicyInput,
  source: "config",
});

const bundle = bundleOf({
  "asks/a.ask.ts": "export default {};\n",
  "project.ts": "export default {};\n",
});

const collectedBase = `{"_tag":"Collected","asks":[],"project":${JSON.stringify(baseEncoded)}}`;

const importsOf = (source: string) =>
  [
    ...source.matchAll(
      /\bimport\s*(?:\(\s*|[^"'()]*?from\s*)(?<quote>["'])(?<specifier>[^"']+)\k<quote>/gu
    ),
  ].map((match) => match.groups?.specifier);

const scriptOf = (modules: LoaderCode["modules"], name: string): string => {
  const module = modules[name];

  assert(module !== undefined && "js" in module, `${name} is no script`);

  return module.js;
};

const firstLoaded = (loads: readonly { readonly code: LoaderCode }[]) => {
  const [load] = loads;

  assert(load !== undefined, "the adapter loaded no worker");

  return load.code;
};

const outcome = (answer: Answer) =>
  Effect.gen(function* () {
    const loader = fakeLoader(answer);

    const result = yield* evaluated(bundle).pipe(
      Effect.provide(workerEvaluator(loader.binding, { timeoutMs: 20 }))
    );

    return {
      handles: loader.handles(),
      reason: Result.isFailure(result) ? result.failure.reason : "ok",
    };
  });

const reasonFor = (answer: Answer) =>
  evaluated(bundle).pipe(
    Effect.provide(workerEvaluator(fakeLoader(answer).binding)),
    Effect.map(reasonOf)
  );

describe("the /worker adapter", () => {
  it.effect(
    "hands the Loader the folder with no network, no bindings and a CPU limit",
    () =>
      Effect.gen(function* () {
        const loader = fakeLoader({ responds: collectedBase });

        yield* evaluated(bundle).pipe(
          Effect.provide(workerEvaluator(loader.binding))
        );

        const { modules, ...options } = firstLoaded(loader.loads);

        expect(options).toStrictEqual({
          compatibilityDate: "2026-10-05",
          globalOutbound: null,
          limits: { cpuMs: 200, subRequests: 0 },
          mainModule: "main.js",
        });

        expect(Object.keys(modules).toSorted()).toStrictEqual([
          ".cfg/asks/a.ask.ts",
          ".cfg/project.ts",
          "main.js",
          "prelude.js",
        ]);

        expect(importsOf(scriptOf(modules, "main.js"))[0]).toBe("./prelude.js");

        expect(scriptOf(modules, "main.js")).toBe(
          mainModule({
            asks: [".cfg/asks/a.ask.ts"],
            project: ".cfg/project.ts",
          })
        );

        expect(modules[".cfg/project.ts"]).toStrictEqual({
          js: "export default {};\n",
        });
      })
  );

  it.effect("gives the prelude the landing's clock and seed", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ responds: collectedBase });

      yield* evaluated(bundle).pipe(
        Effect.provide(workerEvaluator(loader.binding))
      );

      expect(scriptOf(firstLoaded(loader.loads).modules, "prelude.js")).toBe(
        preludeModule({ now: Number(nowMs), seed: facts.seed })
      );
    })
  );

  it.effect("hands over every module of the bundle by its kind", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ responds: collectedBase });

      yield* evaluated(
        bundleOf({
          "data.json": '{"weeks": 53}',
          "notes.md": "# Notes\n",
          "project.ts": "export default {};\n",
          "torn.json": "{",
        })
      ).pipe(Effect.provide(workerEvaluator(loader.binding)));

      const { modules } = firstLoaded(loader.loads);

      expect({
        data: modules[".cfg/data.json"],
        notes: modules[".cfg/notes.md"],
        torn: modules[".cfg/torn.json"],
      }).toStrictEqual({
        data: { json: { weeks: 53 } },
        notes: { text: "# Notes\n" },
        // JSON that won't parse fails only if config code imports it.
        torn: { text: "{" },
      });
    })
  );

  it.effect("refuses a module named outside the folder or over its own", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ responds: collectedBase });
      const evaluator = workerEvaluator(loader.binding);

      const named = (path: string) =>
        evaluated({
          entry: "project.ts",
          modules: { [path]: "export default {};\n", "project.ts": "" },
          sdkVersion: "0.0.0",
        }).pipe(Effect.provide(evaluator), Effect.map(reasonOf));

      expect([
        yield* named("../escape.js"),
        yield* named("asks/./a.ask.ts"),
        yield* named("/abs.js"),
        yield* named("main.js"),
        yield* named("prelude.js"),
      ]).toStrictEqual(["load", "load", "load", "load", "load"]);
      expect(loader.loads).toStrictEqual([]);
    })
  );

  it.effect("keeps one warm worker per landed commit and sdk version", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ responds: collectedBase });
      const other = LandedSha.make("b".repeat(40));

      yield* Effect.gen(function* () {
        yield* evaluated(bundle);
        yield* evaluated(bundle);
        yield* evaluated(bundle, other);
        yield* evaluated({ ...bundle, sdkVersion: "0.0.1" });
      }).pipe(Effect.provide(workerEvaluator(loader.binding)));

      const named = loader.loads.map(({ id }) => ({
        at: [at, other].find((sha) => id.includes(sha)),
        sdk: ["0.0.0", "0.0.1"].find((version) => id.includes(version)),
      }));

      expect(named).toStrictEqual([
        { at, sdk: "0.0.0" },
        { at: other, sdk: "0.0.0" },
        { at, sdk: "0.0.1" },
      ]);
      expect(loader.requests).toHaveLength(4);
    })
  );

  it.effect(
    "runs a rule call at a commit in a worker of its own, on the epoch's clock",
    () =>
      Effect.gen(function* () {
        const loader = fakeLoader({ responds: collectedBase });

        yield* Effect.gen(function* () {
          yield* evaluated(bundle);
          yield* called(bundle, claimant(3));
        }).pipe(Effect.provide(workerEvaluator(loader.binding)));

        // The warm evaluation worker froze the landing's clock, so the call
        // must not reuse it.
        expect(
          loader.loads.map(({ code }) => scriptOf(code.modules, "prelude.js"))
        ).toStrictEqual([
          preludeModule({ now: Number(nowMs), seed: facts.seed }),
          preludeModule({ now: 0, seed: 0 }),
        ]);
      })
  );

  it.effect("decodes what the folder exported into the policy", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ responds: collectedBase });

      const viaWorker = yield* evaluated(bundle).pipe(
        Effect.provide(workerEvaluator(loader.binding))
      );

      const viaJson = yield* evaluated(
        bundleOf({ "policy.json": JSON.stringify(baseEncoded) })
      ).pipe(
        Effect.provide(
          RulesEvaluatorJson.pipe(
            Layer.provide(Layer.succeed(Finishers, finishers))
          )
        )
      );

      assert(Result.isSuccess(viaWorker), "the worker gave no policy");
      expect(viaWorker).toStrictEqual(viaJson);
      expect(loader.requests).toStrictEqual(["{}"]);
    })
  );

  it.live(
    "fails for a reason, and disposes the worker whatever it answers",
    () =>
      Effect.gen(function* () {
        const disposed = { disposed: 2, out: 2 };

        expect([
          yield* outcome({ responds: collectedBase }),
          yield* outcome({ responds: "<html>not the evaluator</html>" }),
          yield* outcome({ rejects: new Error("the worker threw") }),
          yield* outcome({ hangs: true }),
        ]).toStrictEqual([
          { handles: disposed, reason: "ok" },
          { handles: disposed, reason: "decode" },
          { handles: disposed, reason: "threw" },
          { handles: disposed, reason: "timeout" },
        ]);
      })
  );

  it.effect("tells each failure the main reports, and a CPU limit, apart", () =>
    Effect.gen(function* () {
      expect([
        yield* reasonFor({
          rejects: new Error("Worker exceeded CPU time limit."),
        }),
        // workerd compiles every module before the worker starts, so a
        // syntax error rejects the request (seen under `wrangler dev`).
        yield* reasonFor({
          rejects: new Error(
            "Failed to start Worker:\nUncaught SyntaxError: Unexpected end of input\n  at .cfg/project.ts:2"
          ),
        }),
        yield* reasonFor({
          responds:
            '{"_tag":"Failed","detail":".cfg/project.ts: SyntaxError: Unexpected end of input","reason":"load"}',
        }),
        yield* reasonFor({
          responds:
            '{"_tag":"Failed","detail":".cfg/project.ts: Error: no policy today","reason":"threw"}',
        }),
        yield* reasonFor({
          responds:
            '{"_tag":"Collected","asks":[],"project":{"budget":"plenty"}}',
        }),
        yield* reasonFor({ responds: '{"_tag":"Called","result":true}' }),
      ]).toStrictEqual([
        "timeout",
        "load",
        "load",
        "threw",
        "decode",
        "decode",
      ]);
    })
  );

  it.effect("calls a function-valued rule through the same Loader", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({
        responds: '{"_tag":"Called","result":true}',
      });

      const result = yield* called(bundle, claimant(3)).pipe(
        Effect.provide(workerEvaluator(loader.binding))
      );

      const code = firstLoaded(loader.loads);

      expect(result).toStrictEqual(Result.succeed(true));
      expect(JSON.parse(loader.requests[0] ?? "")).toStrictEqual({
        facts: {
          handle: "bram",
          kind: "fixBug",
          record: 3,
          territory: "@datekit/parse",
          vouched: true,
        },
        rule: "admit",
      });

      // A rule gets time only through its facts: the clock is the epoch.
      expect(scriptOf(code.modules, "prelude.js")).toBe(
        preludeModule({ now: 0, seed: 0 })
      );
      expect(code).toMatchObject({
        globalOutbound: null,
        limits: { cpuMs: 200, subRequests: 0 },
      });
      expect(loader.handles()).toStrictEqual({ disposed: 2, out: 2 });
    })
  );

  it.effect("calls no worker for a folder with no project module", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({ rejects: new Error("not called") });

      const result = yield* called(
        bundleOf({ "asks/a.ask.ts": "export default {};\n" }),
        claimant(3)
      ).pipe(Effect.provide(workerEvaluator(loader.binding)));

      expect(result).toStrictEqual(Result.succeed(false));
      expect(loader.loads).toStrictEqual([]);
    })
  );

  it.effect("refuses a rule that answers anything but a boolean", () =>
    Effect.gen(function* () {
      const loader = fakeLoader({
        responds: '{"_tag":"Called","result":"yes"}',
      });

      const result = yield* called(bundle, claimant(3)).pipe(
        Effect.provide(workerEvaluator(loader.binding))
      );

      expect(reasonOf(result)).toBe("decode");
    })
  );
});

const running = Effect.gen(function* () {
  const services = yield* Effect.context<
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >();

  const path = yield* Path.Path;

  const sdk = yield* path.fromFileUrl(
    new URL(import.meta.resolve("@repo/sdk"))
  );

  return workerEvaluator(bunLoader(services, sdk));
});

const readsTheClock = bundleOf({
  "asks/stamp.ask.ts": [
    'import { stamp } from "../project.ts";',
    "export default {",
    "  blockedBy: [],",
    '  brief: { context: stamp, want: "Show the clock config code sees" },',
    '  check: { _tag: "RedThenGreen", path: "test/stamp.repro.test.ts" },',
    '  kind: "fix",',
    '  territory: { module: ".", paths: ["**"] },',
    "};",
  ].join("\n"),
  "project.ts": [
    "export const stamp = [",
    "  String(Date.now()),",
    "  new Date().toISOString(),",
    "  String(new Date().constructor.now()),",
    "  String(Date() === new Date().toString()),",
    "  String(structuredClone(new Date(0)).constructor.now()),",
    "  String(Object.getPrototypeOf(Date).now?.()),",
    "  String(Math.random()),",
    '  crypto.getRandomValues(new Uint32Array(2)).join(","),',
    "  crypto.randomUUID(),",
    "];",
    `export default ${JSON.stringify(baseEncoded)};`,
  ].join("\n"),
});

const withVisibility = bundleOf({
  "project.ts": `export default ${JSON.stringify(baseEncoded)};\n`,
  "visibility.ts": `export default ${JSON.stringify({
    env: { setters: "deciders" },
    flows: { noWriteDown: true, release: "deciders" },
    layers: [
      {
        audience: "maintainers",
        disclose: "sealed",
        holds: ["checks", "notes"],
        name: "maintainers",
        readers: "deciders",
        reason: "Held-back checks",
        writers: "deciders",
      },
    ],
    notice: { narrowingDays: 7 },
  })};\n`,
});

describe("the /worker adapter's modules, run", () => {
  it.live("read visibility.ts into the policy, as /bun reads it", () =>
    Effect.gen(function* () {
      const viaWorker = yield* evaluated(withVisibility).pipe(
        Effect.provide(yield* running)
      );

      const viaBun = yield* evaluated(withVisibility).pipe(
        Effect.provide(bunEvaluator())
      );

      assert(Result.isSuccess(viaWorker), "the worker gave no policy");
      expect(
        viaWorker.success.visibility?.layers.map(({ name }) => name)
      ).toStrictEqual(["maintainers"]);
      expect(viaWorker).toStrictEqual(viaBun);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("evaluate a folder to the policy /bun gives", () =>
    Effect.gen(function* () {
      const worker = yield* running;

      for (const modules of [yield* folder("cm"), readsTheClock]) {
        const viaWorker = yield* evaluated(modules).pipe(
          Effect.provide(worker)
        );

        const viaBun = yield* evaluated(modules).pipe(
          Effect.provide(bunEvaluator())
        );

        assert(Result.isSuccess(viaWorker), "the worker gave no policy");
        expect(viaWorker).toStrictEqual(viaBun);
      }
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("give config code the facts' clock, not the wall clock", () =>
    Effect.gen(function* () {
      const result = yield* evaluated(readsTheClock).pipe(
        Effect.provide(yield* running)
      );

      assert(Result.isSuccess(result), "the worker gave no policy");

      expect(result.success.asks[0]?.brief.context?.slice(0, 6)).toStrictEqual([
        nowMs,
        now,
        nowMs,
        "true",
        nowMs,
        // Above the frozen `Date` there is no other clock.
        "undefined",
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("call the example's rule with the facts they are given", () =>
    Effect.gen(function* () {
      const modules = yield* folder("cm");
      const worker = yield* running;

      const answers = yield* Effect.all(
        [called(modules, claimant(3)), called(modules, claimant(2))],
        { concurrency: "unbounded" }
      ).pipe(Effect.provide(worker));

      expect(answers).toStrictEqual([
        Result.succeed(true),
        Result.succeed(false),
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("fail as /bun does on a syntax error and on code that throws", () =>
    Effect.gen(function* () {
      const worker = yield* running;

      const reasons = (project: string) =>
        Effect.gen(function* () {
          const modules = bundleOf({ "project.ts": project });

          return [
            reasonOf(yield* evaluated(modules).pipe(Effect.provide(worker))),
            reasonOf(
              yield* evaluated(modules).pipe(Effect.provide(bunEvaluator()))
            ),
          ];
        });

      expect([
        yield* reasons("export default {\n"),
        yield* reasons('throw new Error("no policy today");\n'),
      ]).toStrictEqual([
        ["load", "load"],
        ["threw", "threw"],
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
