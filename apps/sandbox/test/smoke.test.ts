import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { ProjectName, RepoName, TreeSha } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Exit, Option, Redacted, Schema } from "effect";

import Sandbox from "../src/worker.ts";
import { fakeEnv } from "./fake-env.ts";

const repo = RepoName.make("datekit");

const tree = TreeSha.make("3".repeat(40));

const remote = (name: string) => ({
  token: Redacted.make(`token-for-${name}`),
  url: `https://artifacts.invalid/${name}.git`,
});

/** The sandbox's entrypoint as the platform's service binding reaches it. */
const sandbox = new Sandbox(untouchable("ctx"), fakeEnv());

/** A stub's outcome: a typed failure, not a defect. */
const failureOf = Exit.findErrorOption;

describe("the sandbox Worker's entrypoint", () => {
  it.effect(
    "blocks a check with a typed refusal until the Checker is built",
    () =>
      Effect.gen(function* () {
        const wire = yield* Schema.encodeEffect(CheckWire)({
          clone: remote("datekit"),
          job: {
            at: CheckAt.cases.Tree.make({ tree }),
            lanes: [],
            placeholders: [],
            project: ProjectName.make("datekit"),
            proxies: [],
            repo,
          },
        });

        const exit = yield* Schema.decodeEffect(CheckExit)(
          yield* Effect.promise(() => sandbox.check(wire))
        );

        expect(failureOf(exit)).toStrictEqual(
          Option.some(new VerifierBlocked({}))
        );
      })
  );
});
