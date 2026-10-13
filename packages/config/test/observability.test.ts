import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { blankJsonc } from "../../../infra/jsonc.ts";
import { stages } from "../../../infra/stages.ts";
import { repoRoot } from "./root.ts";

const WORKERS = ["platform", "sandbox", "web"] as const;

type Worker = (typeof WORKERS)[number];

const Container = Schema.Struct({
  class_name: Schema.String,
  observability: Schema.optionalKey(Schema.Unknown),
});

const Block = Schema.Struct({
  containers: Schema.optionalKey(Schema.Array(Container)),
  observability: Schema.optionalKey(Schema.Unknown),
  upload_source_maps: Schema.optionalKey(Schema.Boolean),
});

type Block = typeof Block.Type;

const Wrangler = Schema.fromJsonString(
  Schema.Struct({
    ...Block.fields,
    env: Schema.Record(Schema.String, Block),
  })
);

// What a Worker keeps of each invocation: its logs, its own line among them,
// and its Issues, none sampled away and none left unkept.
const Recorded = Schema.Struct({
  enabled: Schema.Literal(true),
  issues: Schema.Struct({ enabled: Schema.Literal(true) }),
  logs: Schema.Struct({
    enabled: Schema.Literal(true),
    head_sampling_rate: Schema.Literal(1),
    invocation_logs: Schema.Literal(true),
    persist: Schema.optionalKey(Schema.Literal(true)),
  }),
});

const isRecorded = Schema.is(Recorded);

// Its trace: every invocation's, kept in the account.
const unsampled = {
  enabled: Schema.Literal(true),
  head_sampling_rate: Schema.Literal(1),
  persist: Schema.optionalKey(Schema.Literal(true)),
};

const Traces = {
  // Sent nowhere: a destination would take it out of the account.
  kept: Schema.Struct({
    traces: Schema.Struct({
      ...unsampled,
      destinations: Schema.optionalKey(Schema.Never),
    }),
  }),
  unsampled: Schema.Struct({ traces: Schema.Struct(unsampled) }),
};

// The runtime's own spans record each Durable Object SQL statement's bound
// values and each fetch's full URL, so the platform's traces hold layer
// names and repos and sealed values. The maintainer keeps them, in the
// account's own trace store alone (principle 7).
const TRACING: Readonly<Record<Worker, keyof typeof Traces>> = {
  platform: "kept",
  sandbox: "unsampled",
  web: "unsampled",
};

const LOCAL = "local";

/** The top level is stage `local`, never deployed; each deployed stage is an `env` block. */
const named = [LOCAL, ...stages] as const;

interface Staged {
  readonly worker: Worker;
  readonly stage: (typeof named)[number];
  readonly top: Block;
  readonly block: Block | undefined;
}

const wranglerOf = (worker: Worker) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(yield* repoRoot, `apps/${worker}/wrangler.jsonc`);
    const text = yield* fs.readFileString(file);

    return yield* Schema.decodeEffect(Wrangler)(blankJsonc(text));
  });

const everyStage = Effect.map(
  Effect.forEach(WORKERS, (worker) =>
    Effect.map(wranglerOf(worker), (top) =>
      named.map((stage): Staged => ({
        block: stage === LOCAL ? top : top.env[stage],
        stage,
        top,
        worker,
      }))
    )
  ),
  (all) => all.flat()
).pipe(Effect.provide(NodeServices.layer));

// Wrangler gives a stage the top level's `observability` and
// `upload_source_maps` unless the stage sets its own, but never its
// `containers`: a stage without them declares none.
const inherited = <K extends "observability" | "upload_source_maps">(
  { block, top }: Staged,
  key: K
) => block?.[key] ?? top[key];

const each = <A>(all: readonly Staged[], read: (staged: Staged) => A) =>
  Object.fromEntries(
    all.map((staged) => [`${staged.worker} ${staged.stage}`, read(staged)])
  );

describe("every Worker, in every stage", () => {
  it.effect("logs each invocation and reports its Issues, unsampled", () =>
    Effect.gen(function* () {
      const all = yield* everyStage;

      expect(
        each(all, (staged) => isRecorded(inherited(staged, "observability")))
      ).toStrictEqual(each(all, () => true));
    })
  );

  it.effect(
    "traces each invocation, unsampled, and sends the platform's nowhere",
    () =>
      Effect.gen(function* () {
        const all = yield* everyStage;

        expect(
          each(all, (staged) =>
            Schema.is(Traces[TRACING[staged.worker]])(
              inherited(staged, "observability")
            )
          )
        ).toStrictEqual(each(all, () => true));
      })
  );

  it.effect(
    "uploads its source maps, so an uncaught exception's stack names the source",
    () =>
      Effect.gen(function* () {
        const all = yield* everyStage;

        expect(
          each(all, (staged) => inherited(staged, "upload_source_maps"))
        ).toStrictEqual(each(all, () => true));
      })
  );
});

// A held-back check's sealed files and output are in a Checker's container,
// so its own logs stay off (principle 7). Every container says what it keeps:
// one that leaves `observability` out keeps what its application last had.
describe("every container, in every stage", () => {
  it.effect(
    "is a Checker with its logs off or a Lander with them on, set in the stage itself",
    () =>
      Effect.gen(function* () {
        const all = yield* everyStage;

        const declared = Object.fromEntries(
          all.flatMap(({ block, stage, worker }) =>
            (block?.containers ?? []).map(
              ({ class_name, observability }) =>
                [`${worker} ${stage} ${class_name}`, observability] as const
            )
          )
        );

        expect(declared).toStrictEqual(
          Object.fromEntries(
            named.flatMap((stage) => [
              [`sandbox ${stage} Checker`, { enabled: false }],
              [`sandbox ${stage} Lander`, { enabled: true }],
            ])
          )
        );
      })
  );
});
