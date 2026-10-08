/**
 * `seed --as` (issue 806): a fresh copy of an example under another project
 * name, so a live run (the swarm's rehearsal) can take a family nobody has
 * touched while the original stays fresh for the recording. A name some
 * project already has is refused, and a copy on a stage is written to the
 * throwaway ledger for teardown.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Console, DateTime, Effect, FileSystem, Layer, Path } from "effect";

import { LedgerFile, readLedger } from "../../../infra/created.ts";
import {
  planSeed,
  renameSeedPlan,
  runSeed,
  SeedTarget,
  worldTarget,
} from "../../../scripts/lib/seed.ts";
import { main, optionsOf, recordCopy } from "../../../scripts/seed.ts";
import { Client } from "../../protocol/src/contracts.ts";
import { ProjectName } from "../../protocol/src/ids.ts";
import { ProjectExists } from "../../protocol/src/refusal.ts";

const swarmCopy = ProjectName.make("burrow-swarm-2");

describe(renameSeedPlan, () => {
  it.effect(
    "renames burrow's project and keeps everything else: its decider, main's first files, its ratchet and every ask",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/burrow");
        const copy = renameSeedPlan(plan, swarmCopy);

        expect({
          asks: copy.asks,
          copyOf: copy.copyOf,
          decider: copy.decider,
          initFiles: copy.initFiles,
          layers: copy.layers,
          project: copy.project,
          ratchets: copy.ratchets,
        }).toStrictEqual({
          asks: plan.asks,
          copyOf: "burrow",
          decider: "okafor",
          initFiles: plan.initFiles,
          layers: [],
          project: "burrow-swarm-2",
          ratchets: ["no-module-level-mutable-state"],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "names each layer's repo for the copy, keeping the layer's files and known-bad commits",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/datekit");

        const copy = renameSeedPlan(
          renameSeedPlan(plan, ProjectName.make("datekit-copy")),
          ProjectName.make("datekit-copy-2")
        );

        expect(
          copy.layers.map(({ files, knownBad, layer, repo }) => ({
            files: files.length,
            knownBad: knownBad.map(({ commit }) => commit),
            layer,
            repo,
          }))
        ).toStrictEqual(
          plan.layers.map(({ files, knownBad, layer }) => ({
            files: files.length,
            knownBad: knownBad.map(({ commit }) => commit),
            layer,
            repo: `datekit-copy-2--${layer}`,
          }))
        );

        // A copy of a copy is still a copy of the example.
        expect(copy.copyOf).toBe("datekit");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("runSeed, for a copy", () => {
  it.live(
    "refuses a name some project already has, with ProjectExists, and pushes nothing to it",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/burrow");
        const taken = ProjectName.make("burrow-taken");

        const { failure, refs } = yield* Effect.gen(function* () {
          const target = yield* SeedTarget;

          yield* Client.use((client) =>
            client.initProject({ project: taken })
          ).pipe(Effect.provide(target.clientFor(target.operator)));

          const stopped = yield* Effect.flip(
            runSeed(renameSeedPlan(plan, taken))
          );

          return { failure: stopped, refs: yield* target.refsOf(taken) };
        }).pipe(
          Effect.provide(
            worldTarget([plan.decider]).pipe(Layer.provide(NodeServices.layer))
          )
        );

        expect({
          reason: failure.reason,
          refs: refs.size,
          refusals: failure.refusals,
        }).toStrictEqual({
          reason:
            "burrow-taken is taken: --as makes a fresh copy of burrow, so name a project nobody has",
          refs: 0,
          refusals: [new ProjectExists({ project: taken })],
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});

/** What `main` prints, line by line. */
const printedBy = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    yield* main(argv).pipe(Effect.provideService(Console.Console, captured));

    return printed;
  }).pipe(Effect.provide(NodeServices.layer));

describe("bun scripts/seed.ts --as", () => {
  it.live(
    "seeds datekit as datekit-copy on the Node world, its asks red first and its layer in the copy's own repo",
    () =>
      Effect.gen(function* () {
        const printed = yield* printedBy([
          "--world",
          "node",
          "--only",
          "datekit",
          "--as",
          "datekit-copy",
        ]);

        expect(printed.slice(0, 7)).toStrictEqual([
          "seed: datekit-copy (a copy of datekit) on the Node world",
          "Init datekit-copy: done",
          "Push datekit-copy: done",
          "OpenAsk datekit-copy/add-months-clamp: done",
          "OpenAsk datekit-copy/format-ordinal: done",
          "OpenAsk datekit-copy/parse-iso-week: done",
          "Layer datekit-copy--maintainers: done",
        ]);
      }),
    120_000
  );
});

describe("optionsOf, with --as", () => {
  it.effect("reads the copy's name beside the one example it copies", () =>
    Effect.map(
      optionsOf([
        "--world",
        "node",
        "--only",
        "burrow",
        "--as",
        "burrow-swarm-2",
      ]),
      (options) => {
        expect({ as: options.as, only: options.only }).toStrictEqual({
          as: "burrow-swarm-2",
          only: "burrow",
        });
      }
    )
  );

  it.effect.each([
    [["--world", "node", "--as", "burrow-swarm-2"], "--only"],
    [["--world", "node", "--only", "burrow", "--as", "Burrow 2"], "Burrow 2"],
    [["--world", "node", "--only", "burrow", "--as", "burrow"], "burrow"],
  ] as const)("refuses %j, saying %s", ([argv, said]) =>
    Effect.map(Effect.flip(optionsOf(argv)), (failure) => {
      expect(failure.reason).toContain(said);
    })
  );
});

describe(recordCopy, () => {
  it.live(
    "writes the copy's project, its repo and each layer's repo to the ledger, by the seed",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "seed-as-" });
        const ledger = path.join(dir, "created.jsonl");
        const plan = yield* planSeed("examples/datekit");
        const at = DateTime.makeUnsafe("2026-10-13T09:00:00Z");

        const written = yield* Effect.gen(function* () {
          yield* recordCopy(
            "dev-oscabriel",
            renameSeedPlan(plan, ProjectName.make("datekit-copy")),
            at
          );

          return yield* readLedger;
        }).pipe(Effect.provideService(LedgerFile, ledger));

        expect(written).toStrictEqual([
          {
            at,
            by: "seed",
            kind: "project",
            name: "datekit-copy",
            stage: "dev-oscabriel",
          },
          {
            at,
            by: "seed",
            kind: "repo",
            name: "datekit-copy",
            namespace: "projects-dev-oscabriel",
            stage: "dev-oscabriel",
          },
          {
            at,
            by: "seed",
            kind: "repo",
            name: "datekit-copy--maintainers",
            namespace: "layers-dev-oscabriel",
            stage: "dev-oscabriel",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
