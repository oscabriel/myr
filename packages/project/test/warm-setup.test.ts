import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { Command } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { keyOf, RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { Effect, Option } from "effect";

import { projectService } from "../src/project.ts";
import { CheckScript, Pusher, worldOf } from "./world.ts";

const scenario = aProject();

const repo = RepoName.make(keyOf(scenario.project));

const alice = Person.make({ handle: scenario.initializer });

const start: Files = [
  ["package.json", '{ "name": "alice/datekit", "private": true }\n'],
  ["bun.lock", "{}\n"],
  ["src/trim.ts", "export const trim = (s) => s;\n"],
];

const installing: Policy = {
  ...scenario.policy,
  run: {
    ...scenario.policy.run,
    setup: Command.make("bun install --frozen-lockfile"),
  },
};

const summary = ({ at, lanes, project, repo: on, run }: CheckJob) => ({
  at,
  lanes,
  project,
  repo: on,
  setup: run.setup,
});

const firstLanding = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(scenario.project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);

  return { api, first };
});

const jobs = CheckScript.use((script) => script.jobs);

describe("a landing's setup snapshot", () => {
  it.effect(
    "is warmed by one Checker job with no lanes on the landed commit, once however often the outbox runs",
    () =>
      Effect.gen(function* () {
        const { api, first } = yield* firstLanding;

        const afterLanding = (yield* jobs).map(summary);

        yield* api.onAlarm();
        yield* api.onAlarm();

        const afterAlarms = (yield* jobs).map(summary);

        expect({ afterAlarms, afterLanding }).toStrictEqual({
          afterAlarms: afterLanding,
          afterLanding: [
            {
              at: CheckAt.cases.Commit.make({ commit: first }),
              lanes: [],
              project: scenario.project,
              repo,
              setup: "bun install --frozen-lockfile",
            },
          ],
        });
      }).pipe(Effect.provide(worldOf({ policy: installing }, "memory")))
  );

  it.effect("is not warmed when the policy runs no setup", () =>
    Effect.gen(function* () {
      yield* firstLanding;

      expect(yield* jobs).toStrictEqual([]);
    }).pipe(Effect.provide(worldOf({ policy: scenario.policy }, "memory")))
  );
});
