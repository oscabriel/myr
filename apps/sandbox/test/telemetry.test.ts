import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckWire } from "@repo/checks/check-runner/wire";
import { BundleExit, BundleWire } from "@repo/project/lander/wire";
import type { ConfigBundle } from "@repo/project/lander/wire";
import { Command, Hostname } from "@repo/protocol/domain/common";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  CommitSha,
  LaneName,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { recordingConsole } from "@repo/telemetry/logger/memory";
import { recordingTracing, ROOT } from "@repo/telemetry/spans/memory";
import { Telemetry } from "@repo/telemetry/telemetry";
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";

import { checkJob } from "../src/checker.ts";
import { answered } from "../src/job.ts";
import type { Job } from "../src/job.ts";

const token = "art_v1_0123456789abcdef0123456789abcdef";

const sealedPath = "checks/held-back/parser/week-54.test.ts";

const sha = CommitSha.make("a".repeat(40));

const project = ProjectName.make("oscabriel/datekit");

const checkWire: CheckWire = {
  clone: {
    token: Redacted.make(token),
    url: "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git",
  },
  job: {
    at: CheckAt.cases.Commit.make({ commit: sha }),
    lanes: [{ command: "bun test", lane: LaneName.make("unit") }],
    placeholders: [],
    project,
    proxies: [],
    repo: RepoName.make("datekit"),
    run: RunBlock.make({
      checks: { [LaneName.make("unit")]: Command.make("bun test") },
      setup: Command.make("bun install"),
      setupEgress: [Hostname.make("npm.pkg.github.com")],
      test: Command.make("bun test {path}"),
    }),
  },
};

const observed = <W, WI, A, E, X>(
  job: Job<W, WI, A, E, X>,
  wire: W,
  run: (decoded: W) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const console = recordingConsole();
    const recording = recordingTracing();
    const encoded = yield* Schema.encodeEffect(job.wire)(wire);

    const exit = yield* answered(job, run, (tokens, defects) =>
      Layer.merge(
        Telemetry({ defects, secrets: tokens, tracing: recording.tracing }),
        console.layer
      )
    )(encoded).pipe(Effect.flatMap(Schema.decodeEffect(job.exit)));

    return { console, exit, spans: recording.spans() };
  });

describe("a sandbox job", () => {
  it.effect(
    "hands its defect to the platform in its Exit and reports none itself",
    () =>
      Effect.gen(function* () {
        const { console, exit } = yield* observed(checkJob, checkWire, () =>
          Effect.die(new Error("the container is gone"))
        );

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBeTruthy();
        expect(console.errors()).toStrictEqual([]);
      })
  );

  it.effect(
    "names its project and SHA on the invocation's root span, and its own span by the job",
    () =>
      Effect.gen(function* () {
        const { spans } = yield* observed(checkJob, checkWire, () =>
          Effect.fail(new VerifierBlocked({}))
        );

        expect([
          spans.map(({ name }) => name),
          Object.fromEntries(spans[0]?.attributes ?? []),
          spans[1]?.exceptions,
        ]).toStrictEqual([
          [ROOT, "Checker.check"],
          { project, sha },
          [{ name: "VerifierBlocked" }],
        ]);
      })
  );

  it.effect(
    "keeps a Checker's defect off its spans but by name: its text may quote a sealed path",
    () =>
      Effect.gen(function* () {
        const { spans } = yield* observed(checkJob, checkWire, () =>
          Effect.die(new TypeError(`no file at ${sealedPath}`))
        );

        expect(spans[1]?.exceptions).toStrictEqual([{ name: "TypeError" }]);
      })
  );

  it.effect("carries none of its tokens in a line it logs", () =>
    Effect.gen(function* () {
      const bundle: Job<
        typeof BundleWire.Type,
        typeof BundleWire.Encoded,
        typeof ConfigBundle.Type,
        VerifierBlocked,
        typeof BundleExit.Encoded
      > = {
        defects: "whole",
        exit: BundleExit,
        ids: ({ job }) => ({ sha: job.at }),
        name: "Lander.bundleRules",
        tokens: ({ main }) => [main.token],
        wire: BundleWire,
      };

      const { console } = yield* observed(
        bundle,
        {
          job: { at: LandedSha.make(sha), repo: RepoName.make("datekit") },
          main: checkWire.clone,
        },
        () =>
          Effect.logWarning(`git said: bad credentials ${token}`).pipe(
            Effect.andThen(Effect.fail(new VerifierBlocked({})))
          )
      );

      expect(console.written()).toStrictEqual([
        {
          line: {
            level: "WARN",
            message: "git said: bad credentials <redacted>",
            sha,
          },
          method: "warn",
        },
      ]);
    })
  );
});
