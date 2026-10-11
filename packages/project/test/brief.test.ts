import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import {
  AskId,
  keyOf,
  LandedSha,
  LaneName,
  RepoName,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk } from "@repo/testkit/scenarios";
import { Array, Effect, Option } from "effect";

import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

/**
 * datekit with two asks: `parse-iso` in the module `parser`, and
 * `trim-input` over two paths alone, as `territory.paths(...)` makes it
 * (module `.`).
 */
const scenario = aProject().pipe(
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "." })
);

const byPaths = (ask: Ask): Ask =>
  ask.id === "trim-input"
    ? {
        ...ask,
        territory: {
          module: ".",
          paths: [Glob.make("src/trim.ts"), Glob.make("test/trim.test.ts")],
        },
      }
    : ask;

const policy = {
  ...scenario.policy,
  asks: scenario.policy.asks.map(byPaths),
};

const repo = RepoName.make(keyOf(scenario.project));

const mainRef = RefName.make("refs/heads/main");

const alice = Person.make({ handle: scenario.initializer });

const anyone = Anonymous.make({});

const askOf = (id: string): Ask =>
  Option.getOrThrow(Array.findFirst(policy.asks, (ask) => ask.id === id));

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["src/trim.ts", "export const trim = (s) => s;\n"],
];

/** alice opens `id`: its file and its check, scripted red twice on main. */
const openRed = (api: ProjectApi, id: string) =>
  Effect.gen(function* () {
    const { check, file } = askOf(id);

    if (!CheckSpec.guards.RedThenGreen(check)) {
      return yield* Effect.die(`${id}'s check is not red-then-green`);
    }

    const files = Array.make(
      { content: `export default "${id}";\n`, path: file },
      { content: `it("${id}", () => {});\n`, path: check.path }
    );

    const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

    const tip = LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );

    yield* CheckScript.use(
      Effect.fnUntraced(function* (checker) {
        yield* checker.script(
          yield* composedAt(repo, tip, files),
          LaneName.make("redThenGreen"),
          ["failed", "failed"]
        );
      })
    );

    return yield* api.openAsk(alice, { ask: AskId.make(id), files });
  });

/** The brief's Territory section, its one line. */
const territoryLine = (brief: string) =>
  brief.split("## Territory\n\n")[1]?.split("\n")[0];

describe("an ask's brief", () => {
  it.effect(
    "reads a paths territory as its paths, and a module's as the module",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const api = yield* projectService(scenario.project);

        yield* api.initProject(alice, {});

        const first = yield* Pusher.use((pusher) =>
          pusher.push(repo, Option.none(), start, "Start")
        );

        yield* api.recordFirstPush(alice, first);
        yield* openRed(api, "parse-iso");
        yield* openRed(api, "trim-input");

        const paths = yield* api.showAsk(anyone, AskId.make("trim-input"));
        const module = yield* api.showAsk(anyone, AskId.make("parse-iso"));

        expect(territoryLine(paths.brief)).toBe(
          "The paths `src/trim.ts`, `test/trim.test.ts`."
        );
        expect(paths.brief).not.toContain("module");
        expect(territoryLine(module.brief)).toBe(
          "The module `parser`: `packages/parser/**`."
        );
      }).pipe(Effect.provide(worldOf({ policy }, "memory")))
  );
});
