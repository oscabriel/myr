import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import {
  BundleExit,
  BundleWire,
  ComposeExit,
  ComposeWire,
  LandExit,
  LandWire,
  MergeExit,
  MergeWire,
  Rebuild,
} from "@repo/project/lander/wire";
import {
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Exit, Option, Redacted, Schema } from "effect";

import Sandbox from "../src/worker.ts";
import { fakeEnv } from "./fake-env.ts";

const repo = RepoName.make("datekit");

const fork = RepoName.make("datekit--parse-iso--bob");

const main = LandedSha.make("1".repeat(40));

const head = CommitSha.make("2".repeat(40));

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

  it.effect(
    "blocks every Lander job with a typed refusal until the Lander is built",
    () =>
      Effect.gen(function* () {
        const merge = yield* Schema.encodeEffect(MergeWire)({
          fork: remote("fork"),
          job: { base: head, fork, head, main, repo },
          main: remote("main"),
        });

        const land = yield* Schema.encodeEffect(LandWire)({
          job: {
            author: Handle.make("bob"),
            main,
            message: "Parse ISO weeks",
            rebuild: Rebuild.cases.Existing.make({ commit: head }),
            repo,
            requestId: RequestId.make("push-0123456789"),
            tree,
            verdict: Option.none(),
          },
          main: remote("main"),
        });

        const compose = yield* Schema.encodeEffect(ComposeWire)({
          job: {
            files: [{ content: "export {}", path: RepoPath.make("a.ts") }],
            main,
            repo,
          },
          main: remote("main"),
        });

        const bundle = yield* Schema.encodeEffect(BundleWire)({
          job: { at: main, repo },
          main: remote("main"),
        });

        const outcomes = [
          failureOf(
            yield* Schema.decodeEffect(MergeExit)(
              yield* Effect.promise(() => sandbox.merge(merge))
            )
          ),
          failureOf(
            yield* Schema.decodeEffect(LandExit)(
              yield* Effect.promise(() => sandbox.land(land))
            )
          ),
          failureOf(
            yield* Schema.decodeEffect(ComposeExit)(
              yield* Effect.promise(() => sandbox.compose(compose))
            )
          ),
          failureOf(
            yield* Schema.decodeEffect(BundleExit)(
              yield* Effect.promise(() => sandbox.bundleRules(bundle))
            )
          ),
        ];

        expect(outcomes).toStrictEqual(
          Array.from({ length: 4 }, () => Option.some(new VerifierBlocked({})))
        );
      })
  );
});
