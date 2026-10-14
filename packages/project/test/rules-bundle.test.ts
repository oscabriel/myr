import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import {
  AskId,
  CommitSha,
  keyOf,
  LandedSha,
  LaneName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import type { ConfigBundle } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk } from "@repo/testkit/scenarios";
import { Array, Context, Effect, Layer, Option, Ref, Schema } from "effect";

import { CodeStore } from "../src/code-store.ts";
import { CodeStoreMemory } from "../src/code-store/memory.ts";
import { Lander } from "../src/lander.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import {
  bundleKeyAt,
  bundleThrough,
  rulesBundleKept,
} from "../src/rules-bundle.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject().pipe(
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "." })
);

const { policy } = scenario;

const repo = RepoName.make(keyOf(scenario.project));

const mainRef = RefName.make("refs/heads/main");

const alice = Person.make({ handle: scenario.initializer });

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["src/trim.ts", "export const trim = (s) => s;\n"],
];

class BundleCount extends Context.Service<
  BundleCount,
  { readonly count: Effect.Effect<number> }
>()("test/BundleCount") {}

/** The world's Lander, each bundle it makes counted. */
const counted = Layer.effectContext(
  Effect.gen(function* () {
    const inner = yield* Lander;
    const count = yield* Ref.make(0);

    const lander = Lander.of({
      ...inner,
      bundleRules: (job) =>
        Effect.andThen(
          Ref.update(count, (n) => n + 1),
          inner.bundleRules(job)
        ),
    });

    return Context.make(Lander, lander).pipe(
      Context.add(BundleCount, { count: Ref.get(count) })
    );
  })
).pipe(Layer.provideMerge(worldOf({ policy }, "memory")));

const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

const openAsk = (api: ProjectApi, id: string) =>
  Effect.gen(function* () {
    const ask = Option.getOrThrow(
      Array.findFirst(policy.asks, (each) => each.id === id)
    );

    if (!CheckSpec.guards.RedThenGreen(ask.check)) {
      return yield* Effect.die(`${id}'s check is not red-then-green`);
    }

    const files = Array.make(
      { content: `export default "${id}";\n`, path: ask.file },
      { content: `it("${id}", () => {});\n`, path: ask.check.path }
    );

    const landed = yield* mainTip;

    yield* CheckScript.use(
      Effect.fnUntraced(function* (checker) {
        yield* checker.script(
          yield* composedAt(repo, landed, files),
          LaneName.make("redThenGreen"),
          ["failed", "failed"]
        );
      })
    );

    return yield* api.openAsk(alice, { ask: AskId.make(id), files });
  });

const bundle: ConfigBundle = {
  entry: `${Brand.configDir}/project.ts`,
  modules: { [`${Brand.configDir}/policy.json`]: "{}" },
  sdkVersion: "0.0.0",
};

describe("a commit's rules bundle", () => {
  it.effect(
    "is keyed by its config folder's tree, so a commit that keeps the folder shares the key",
    () =>
      Effect.gen(function* () {
        const push = (parent: Option.Option<CommitSha>, files: Files) =>
          Pusher.use((pusher) => pusher.push(repo, parent, files));

        yield* advanceTo("2026-10-07T12:00:00Z");
        yield* (yield* projectService(scenario.project)).initProject(alice, {});

        const bare = yield* push(Option.none(), start);

        const configured = yield* push(Option.some(bare), [
          ...start,
          [`${Brand.configDir}/policy.json`, "{}\n"],
        ]);

        const sameFolder = yield* push(Option.some(configured), [
          ...start,
          ["src/trim.ts", "export const trim = (s) => s.trim();\n"],
          [`${Brand.configDir}/policy.json`, "{}\n"],
        ]);

        const changedFolder = yield* push(Option.some(sameFolder), [
          ...start,
          [`${Brand.configDir}/policy.json`, '{ "kinds": [] }\n'],
        ]);

        const keys = yield* Effect.all([
          bundleKeyAt(repo, bare),
          bundleKeyAt(repo, configured),
          bundleKeyAt(repo, sameFolder),
          bundleKeyAt(repo, changedFolder),
        ]);

        const unknown = yield* bundleKeyAt(
          repo,
          CommitSha.make("0000000000000000000000000000000000000000")
        );

        expect({
          bareIsNone: keys[0],
          changedDiffers:
            Option.getOrThrow(keys[3]) !== Option.getOrThrow(keys[1]),
          configuredDiffers:
            Option.getOrThrow(keys[1]) !== Option.getOrThrow(keys[0]),
          prefixed: Option.getOrThrow(keys[1]).startsWith(
            `${repo}/rules-bundle/v`
          ),
          sameShares: keys[2],
          unknown,
        }).toStrictEqual({
          bareIsNone: Option.map(keys[0], (key) =>
            key.replace(/[^/]+$/u, "none")
          ),
          changedDiffers: true,
          configuredDiffers: true,
          prefixed: true,
          sameShares: keys[1],
          unknown: Option.none(),
        });
      }).pipe(Effect.provide(worldOf({ policy }, "memory")))
  );

  it.effect(
    "is kept once made, and a kept one that no longer decodes is made again",
    () =>
      Effect.gen(function* () {
        const store = yield* CodeStore;
        const made = yield* Ref.make(0);
        const key = Option.some(`${repo}/rules-bundle/test`);

        const make = Effect.andThen(
          Ref.update(made, (n) => n + 1),
          Effect.succeed(bundle)
        );

        const first = yield* bundleThrough(key, make);
        const second = yield* bundleThrough(key, make);
        const madeOnce = yield* Ref.get(made);

        yield* store.put(Option.getOrThrow(key), '{"entry":"no modules"}');

        const replaced = yield* bundleThrough(key, make);
        const madeAgain = yield* Ref.get(made);

        const kept = Option.flatMap(
          yield* store.get(Option.getOrThrow(key)),
          Schema.decodeUnknownOption(
            Schema.fromJsonString(rulesBundleKept.schema)
          )
        );

        // Without a key (the commit could not be read) every call bundles.
        const unkeyed = yield* bundleThrough(Option.none(), make);
        const madeUnkeyed = yield* Ref.get(made);

        expect({
          first,
          kept,
          madeAgain,
          madeOnce,
          madeUnkeyed,
          replaced,
          second,
          unkeyed,
        }).toStrictEqual({
          first: bundle,
          kept: Option.some(bundle),
          madeAgain: 2,
          madeOnce: 1,
          madeUnkeyed: 3,
          replaced: bundle,
          second: bundle,
          unkeyed: bundle,
        });
      }).pipe(Effect.provide(CodeStoreMemory))
  );

  it.effect(
    "is made once per change to the folder across a project's landings: an ask's composed commit and its landing share one",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const { count } = yield* BundleCount;
        const api = yield* projectService(scenario.project);

        yield* api.initProject(alice, {});

        const first = yield* Pusher.use((pusher) =>
          pusher.push(repo, Option.none(), start, "Start")
        );

        yield* api.recordFirstPush(alice, first);

        const afterFirst = yield* count;

        yield* openAsk(api, "parse-iso");

        const afterOne = yield* count;

        yield* openAsk(api, "trim-input");

        const afterTwo = yield* count;

        // One bundle for the first push's tree, and one per opening: the
        // ask's composed commit is bundled and its landing, the same
        // folder, reads it back.
        expect([afterFirst, afterOne, afterTwo]).toStrictEqual([1, 2, 3]);
      }).pipe(Effect.provide(Layer.merge(counted, CodeStoreMemory)))
  );
});
