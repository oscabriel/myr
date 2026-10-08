import { DateTime, Effect, Layer, Option, Predicate, Schema } from "effect";

import {
  Collected,
  askModules,
  fromCollected,
  projectModule,
  statedWithoutCode,
  visibilityModule,
} from "../config-folder.ts";
import { defaultPolicyInput } from "../defaults.ts";
import { Finishers, finishPolicy } from "../finish.ts";
import {
  mainModule,
  mainName,
  preludeModule,
  preludeName,
} from "../prelude.ts";
import type { FrozenFacts } from "../prelude.ts";
import { factsOf, RulesEvaluator, RulesFailed } from "../rules-evaluator.ts";
import type { ConfigBundle, RuleName } from "../rules-evaluator.ts";

/**
 * One module as the Worker Loader takes it: ES module source, JSON data, or
 * text. (`@cloudflare/workers-types`' `WorkerLoaderModule`, for the kinds
 * used.)
 */
export type LoaderModule =
  | { readonly js: string }
  | { readonly json: Schema.Json }
  | { readonly text: string };

/**
 * The code the adapter hands the Loader: `WorkerLoaderWorkerCode`'s fields
 * it uses. There is no `env` (no binding reaches config code), no outbound
 * (`fetch` and `connect` throw), and no subrequests.
 */
export interface LoaderCode {
  readonly compatibilityDate: string;
  readonly globalOutbound: null;
  readonly limits: { readonly cpuMs: number; readonly subRequests: number };
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, LoaderModule>>;
}

/** A loaded worker's default entrypoint, as `Fetcher#fetch` serves it. */
export interface LoaderEntrypoint {
  readonly fetch: (
    url: string,
    init: { readonly body: string; readonly method: "POST" }
  ) => Promise<{ readonly text: () => Promise<string> }>;
}

/** A loaded worker, as `WorkerStub#getEntrypoint` opens it. */
export interface LoadedWorker {
  readonly getEntrypoint: () => LoaderEntrypoint;
}

/**
 * The Worker Loader binding, typed by the fields the adapter uses, so
 * `rules` needs no Workers types: the platform's `env.LOADER` (a
 * `WorkerLoader`) is one. `get` keeps a worker warm under its id and calls
 * `getCode` only for an id it doesn't hold.
 */
export interface LoaderBinding {
  readonly get: (id: string, getCode: () => LoaderCode) => LoadedWorker;
}

/** How the `/worker` adapter loads config code. */
export interface WorkerOptions {
  /** The loaded worker's compatibility date; the platform's by default. */
  readonly compatibilityDate?: string;
  /** The CPU time one request may spend; 200 ms by default. */
  readonly cpuMs?: number;
  /** How long one request may take, waiting included; 5 s by default. */
  readonly timeoutMs?: number;
}

/** What the loaded worker answers: the same results `/bun`'s main prints. */
const Output = Schema.TaggedUnion({
  Called: { result: Schema.Json },
  Collected: Collected.fields,
  Failed: {
    detail: Schema.String,
    reason: Schema.Literals(["load", "threw"]),
  },
});

type Output = typeof Output.Type;

const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(Output));

/** A request to the loaded worker: collect the folder's exports, or call a rule. */
type Job =
  | Readonly<Record<string, never>>
  | { readonly facts: Schema.Json; readonly rule: RuleName };

// The address requests to a loaded worker carry; it has no network to
// reach, so any address serves.
const jobUrl = "https://rules.invalid/";

// The clock and seed a rule call runs under, as `/bun`'s: a rule gets time
// only through the facts it is called with.
const epoch: FrozenFacts = { now: 0, seed: 0 };

// `Symbol.dispose`, by which the runtime releases a stub. The lib this code
// compiles against (ES2023) doesn't type it, so it is read as a value.
const disposeKey: unknown = Object.getOwnPropertyDescriptor(
  Symbol,
  "dispose"
)?.value;

// What workerd says when a worker spends its CPU limit, or hangs with
// nothing left to wait for.
const RAN_OUT =
  /\b(?:cpu time|time limit|timed out|never generate a response)\b/iu;

// What workerd says when a module won't compile: it compiles every module
// before the worker starts, so a syntax error anywhere in the folder
// rejects the request instead of reaching the main.
const WONT_START = /^Failed to start Worker\b/u;

// A module the Loader imports as code.
const SCRIPT = /\.[cm]?[jt]s$/u;

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

const surprised = (output: Output) =>
  new RulesFailed({
    detail: `the evaluator answered ${output._tag} to a job it was not given`,
    reason: "decode",
  });

const fromFailed = ({ detail, reason }: Extract<Output, { _tag: "Failed" }>) =>
  new RulesFailed({ detail, reason });

const messageOf = (cause: unknown) =>
  Predicate.isError(cause) ? cause.message : String(cause);

/**
 * A rejection from the loaded worker: a module that won't compile, its CPU
 * limit spent, or its code threw.
 */
const thrownBy = (cause: unknown) => {
  const message = messageOf(cause);
  const detail = `the loaded worker: ${message}`;

  if (WONT_START.test(message)) {
    return new RulesFailed({ detail, reason: "load" });
  }

  return new RulesFailed({
    detail,
    reason: RAN_OUT.test(message) ? "timeout" : "threw",
  });
};

/** Releases a stub the runtime handed out; one with no way to be released is left. */
const released = (stub: LoadedWorker | LoaderEntrypoint) =>
  Effect.try(() => {
    const dispose =
      Predicate.isSymbol(disposeKey) && Predicate.hasProperty(stub, disposeKey)
        ? stub[disposeKey]
        : undefined;

    if (Predicate.isFunction(dispose)) {
      dispose.call(stub);
    }
  }).pipe(Effect.ignore);

/** Sends one job to a loaded worker's entrypoint, and decodes its answer. */
const requested = (entrypoint: LoaderEntrypoint, job: Job) =>
  Effect.tryPromise({
    catch: thrownBy,
    try: () =>
      entrypoint.fetch(jobUrl, {
        body: JSON.stringify(job),
        method: "POST",
      }),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({ catch: thrownBy, try: () => response.text() })
    ),
    Effect.flatMap((text) =>
      decodeOutput(text).pipe(
        Effect.mapError(
          (failure) =>
            new RulesFailed({
              detail: `the evaluator's result: ${failure.message}`,
              reason: "decode",
            })
        )
      )
    )
  );

/**
 * Whether a bundle path names a module inside the folder: relative, with
 * no empty, `.` or `..` segment, and not the main's or the prelude's name.
 */
const isModulePath = (path: string) =>
  path !== mainName &&
  path !== preludeName &&
  path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

/** Refuses a bundle with a path outside the folder, before any worker loads. */
const insideTheFolder = (bundle: ConfigBundle) => {
  const outside = Object.keys(bundle.modules).filter(
    (path) => !isModulePath(path)
  );

  return outside.length === 0
    ? Effect.void
    : Effect.fail(
        loadFailed(
          `${outside.join(", ")}: not a module path inside the config folder`
        )
      );
};

const parsedJson = Schema.decodeOption(Schema.fromJsonString(Schema.Json));

/**
 * A bundle file as a Loader module: a script as ES module source, JSON as
 * data (or as text when it won't parse, which fails only if config code
 * imports it), anything else as text.
 */
const moduleOf = (path: string, source: string): LoaderModule => {
  if (SCRIPT.test(path)) {
    return { js: source };
  }

  const json = path.endsWith(".json") ? parsedJson(source) : Option.none();

  return Option.match(json, {
    onNone: () => ({ text: source }),
    onSome: (data) => ({ json: data }),
  });
};

/**
 * The Loader's id for a bundle under a clock. The landed commit and the sdk
 * version name the bundle, and the clock names the prelude, so equal ids
 * hold equal code and a warm worker serves every later request at that
 * commit.
 */
const workerIdOf = (bundle: ConfigBundle, at: string, clock: FrozenFacts) =>
  `rules:${at}:${bundle.sdkVersion}:${clock.now}:${clock.seed}`;

/**
 * `RulesEvaluator` over the Worker Loader. Each request loads
 * the bundle's modules, a prelude that freezes the clock and randomness to
 * the injected facts, and a main that answers one JSON document, as a
 * Dynamic Worker with no bindings, no outbound and a CPU limit, kept warm
 * per landed commit; asks it to collect the folder's exports or call a
 * rule; and disposes it after, whatever it answered. A bundle with no
 * project module, no asks and no visibility module reads `policy.json`, or
 * gets the defaults, without a worker. Then `finishPolicy`, with the caller's `Finishers`. The
 * adapter reads no clock: an evaluation's clock is `facts.now`, the landed
 * commit's time.
 */
export const RulesEvaluatorWorker = (
  loader: LoaderBinding,
  options: WorkerOptions = {}
) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const finishers = yield* Finishers;
      const compatibilityDate = options.compatibilityDate ?? "2026-10-05";
      const cpuMs = options.cpuMs ?? 200;
      const timeoutMs = options.timeoutMs ?? 5000;

      /**
       * The code the Loader gets for a bundle under a clock. The Loader asks
       * for it only for an id it doesn't hold, so a warm request builds none.
       */
      const codeOf = (bundle: ConfigBundle, clock: FrozenFacts): LoaderCode => {
        const modules: Record<string, LoaderModule> = {};

        for (const [path, source] of Object.entries(bundle.modules)) {
          modules[path] = moduleOf(path, source);
        }

        modules[mainName] = {
          js: mainModule({
            asks: askModules(bundle),
            project: projectModule(bundle),
            visibility: visibilityModule(bundle),
          }),
        };

        modules[preludeName] = { js: preludeModule(clock) };

        return {
          compatibilityDate,
          globalOutbound: null,
          limits: { cpuMs, subRequests: 0 },
          mainModule: mainName,
          modules,
        };
      };

      /**
       * Loads the bundle under a clock, runs one job, and disposes the
       * worker and its entrypoint, within the time limit.
       */
      const run = (
        bundle: ConfigBundle,
        at: string,
        clock: FrozenFacts,
        job: Job
      ): Effect.Effect<Output, RulesFailed> =>
        Effect.andThen(
          insideTheFolder(bundle),
          Effect.acquireUseRelease(
            Effect.try({
              catch: (cause) =>
                loadFailed(`the Worker Loader: ${messageOf(cause)}`),
              try: () =>
                loader.get(workerIdOf(bundle, at, clock), () =>
                  codeOf(bundle, clock)
                ),
            }),
            (worker) =>
              Effect.acquireUseRelease(
                Effect.try({
                  catch: (cause) =>
                    loadFailed(`the loaded worker: ${messageOf(cause)}`),
                  try: () => worker.getEntrypoint(),
                }),
                (entrypoint) => requested(entrypoint, job),
                released
              ),
            released
          )
        ).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () =>
              Effect.fail(
                new RulesFailed({
                  detail: `the config folder ran past its ${timeoutMs} ms limit`,
                  reason: "timeout",
                })
              ),
          })
        );

      return RulesEvaluator.of({
        call: (input) => {
          const { at, modules, rule } = input;
          const project = projectModule(modules);

          if (project === undefined) {
            return Effect.succeed(false);
          }

          return factsOf(input).pipe(
            Effect.flatMap((facts) => run(modules, at, epoch, { facts, rule })),
            Effect.flatMap(
              Output.match({
                Called: ({ result }) =>
                  Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
                    Effect.mapError(
                      (failure) =>
                        new RulesFailed({
                          detail: `${project}: ${rule} gave ${failure.message}`,
                          reason: "decode",
                        })
                    )
                  ),
                Collected: (output) => Effect.fail(surprised(output)),
                Failed: (output) => Effect.fail(fromFailed(output)),
              })
            )
          );
        },
        evaluate: ({ at, facts, modules }) =>
          Effect.gen(function* () {
            const project = projectModule(modules);
            const asks = askModules(modules);
            const visibility = visibilityModule(modules);

            const clock: FrozenFacts = {
              now: DateTime.toEpochMillis(facts.now),
              seed: facts.seed,
            };

            // Without a project module, `policy.json` (or the defaults) is
            // the base the ask files join; with one, it is never read.
            const fallback =
              project === undefined
                ? yield* statedWithoutCode(modules)
                : defaultPolicyInput;

            const policy =
              project === undefined &&
              asks.length === 0 &&
              visibility === undefined
                ? fallback
                : yield* run(modules, at, clock, {}).pipe(
                    Effect.flatMap(
                      Output.match({
                        Called: (output) => Effect.fail(surprised(output)),
                        Collected: (collected) =>
                          fromCollected({
                            collected,
                            entry: project ?? modules.entry,
                            fallback,
                            initializer: facts.initializer,
                            visibility,
                          }),
                        Failed: (output) => Effect.fail(fromFailed(output)),
                      })
                    )
                  );

            return yield* finishPolicy({ at, facts, finishers, policy });
          }),
      });
    })
  );
