/**
 * Usage:
 *   bun scripts/smoke.ts --stage <stage> [--url <origin>] [--web-url <origin>]
 *     [--since <instant>]
 *   bun scripts/smoke.ts --stage <stage> --loop [--as <handle>]
 *
 * `--since` then reads the stage's Workers Logs since that instant, and fails
 * on any exception or error-level line: it needs infra's credentials, so the
 * deploy runs it through `varlock run --path infra/`. `--loop` reads
 * `OPERATOR_TOKEN` and `SESSION_TOKENS` (token to handle) from the env, never
 * from an argument.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Handle, sameHandle } from "@repo/protocol/ids";
import {
  Config,
  Console,
  DateTime,
  Effect,
  Option,
  Redacted,
  Schema,
  Stdio,
} from "effect";

import { main as probeMain } from "../infra/smoke.ts";
import {
  flagValue,
  platformOrigin,
  publicStages,
  recordedSubdomain,
  stageOf,
  subdomainFile,
} from "../infra/stages.ts";
import { PublicStageRefused, LoopFailed, smokeLoop } from "./lib/smoke/loop.ts";

export {
  BadSince,
  logProbes,
  NoLogCredentials,
  NoOrigin,
  platformProbes,
  probes,
  smoke,
  SmokeFailed,
  webProbes,
} from "../infra/smoke.ts";

export type { LogsCheck, SmokeReport } from "../infra/smoke.ts";

export { PublicStageRefused, LoopFailed, smokeLoop } from "./lib/smoke/loop.ts";

export type { SmokeLoopReport } from "./lib/smoke/loop.ts";

const ANSWERER = "bram";

const failed = (reason: string) => new LoopFailed({ reason, step: "people" });

const runName = Effect.map(DateTime.now, (now) =>
  DateTime.formatIso(now)
    .slice(0, 19)
    .replaceAll(/[-:]/gu, "")
    .replace("T", "-")
);

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Handle))
);

const tokensFrom = (answerer: string) =>
  Effect.gen(function* () {
    const decider = yield* Config.Redacted("OPERATOR_TOKEN").pipe(
      Effect.mapError(() =>
        failed(
          "no OPERATOR_TOKEN in the environment: run with the stage's secrets in the env"
        )
      )
    );

    const sessions = yield* Config.String("SESSION_TOKENS").pipe(
      Effect.mapError(() =>
        failed(
          "no SESSION_TOKENS in the environment: run with the stage's secrets in the env"
        )
      ),
      Effect.flatMap((raw) =>
        decodeSessions(raw).pipe(
          Effect.mapError(() =>
            failed("SESSION_TOKENS is not a JSON object from token to handle")
          )
        )
      )
    );

    const token = Object.entries(sessions).find(([, handle]) =>
      sameHandle(handle, Handle.make(answerer))
    )?.[0];

    return token === undefined
      ? yield* failed(
          `SESSION_TOKENS has no session for ${answerer}: name another with --as`
        )
      : { answerer: Redacted.make(token), decider };
  });

const originOf = (
  argv: readonly string[],
  stage: Parameters<typeof platformOrigin>[0]
) =>
  Option.match(flagValue(argv, "--url"), {
    onNone: () =>
      recordedSubdomain.pipe(
        Effect.flatMap(Effect.fromOption),
        Effect.mapError(() =>
          failed(
            `no --url, and ${subdomainFile} doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage ${stage} first`
          )
        ),
        Effect.map((subdomain) => platformOrigin(stage, subdomain))
      ),
    onSome: (url) => Effect.succeed(url.replace(/\/+$/u, "")),
  });

const loopMain = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);

    yield* publicStages.has(stage)
      ? Effect.fail(new PublicStageRefused({ stage }))
      : Effect.void;

    const answerer = Option.getOrElse(flagValue(argv, "--as"), () => ANSWERER);
    const tokens = yield* tokensFrom(answerer);
    const origin = yield* originOf(argv, stage);

    yield* probeMain(argv.filter((arg) => arg !== "--loop"));

    const run = yield* runName;

    yield* Console.log(`smoke ${stage}: loop smoke-${run} at ${origin}`);

    const report = yield* smokeLoop({
      ...tokens,
      origin,
      run,
      stage,
    });

    const total = report.timings.reduce((sum, { ms }) => sum + ms, 0);

    yield* Console.log(
      `smoke ${stage}: loop passed in ${total} ms: ${report.project} landed ${report.landed.slice(0, 12)} by ${report.author}, refused first with ${report.refusedWith.join(", ")}; trailers ${report.trailers.join("; ")}`
    );
  });

export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    if (argv.includes("--loop")) {
      return yield* loopMain(argv);
    }

    return yield* probeMain(argv);
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
