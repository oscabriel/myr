/**
 * smoke: `bun scripts/smoke.ts --stage dev-<user>|demo [--url <origin>]
 * [--web-url <origin>]`. Read-only probes against a live stage's platform and
 * web; it fails loudly, naming
 * every probe that broke, and prints how long each took.
 * `infra/deploy.ts` runs it last (AGENTS.md principle 11).
 *
 * The stage's origins are `https://platform-<s>.<subdomain>.workers.dev` and
 * `https://web-<s>.<subdomain>.workers.dev`, with the subdomain `bun run
 * bootstrap` records in `infra/workers-dev.json`; `--url` points it at another
 * platform (the web's probes then run only with `--web-url`). The probes live
 * in `infra/smoke.ts`.
 *
 * `--loop` runs the whole core loop after the probes, through the
 * CLI and git (`lib/smoke/loop.ts`): a throwaway project `smoke-<run>`, an
 * ask opened red first, a claim, an out-of-territory push git refuses with
 * `OutOfScope`, the fixed answer landed with its credit, and its verdict
 * note. It needs two people's tokens in the env, never in an argument: the
 * operator's (`OPERATOR_TOKEN`), who makes the project and opens the ask,
 * and the answerer's, from `SESSION_TOKENS` (a JSON object from token to
 * handle, as the platform's own) by the handle `--as` names (`bram` unless
 * given). For example, with the stage's generated secrets file (outside the
 * repo, `infra/stages.md` says where) loaded into the env:
 *
 *   set -a; . <the stage's secrets file>; set +a
 *   bun scripts/smoke.ts --stage dev-oscabriel --loop
 *
 * `--loop` refuses `--stage demo` before anything else: the throwaway would
 * show on the front page the user records.
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
  recordedSubdomain,
  stageOf,
  subdomainFile,
} from "../infra/stages.ts";
import { DemoStageRefused, LoopFailed, smokeLoop } from "./lib/smoke/loop.ts";

export {
  NoOrigin,
  platformProbes,
  probes,
  smoke,
  SmokeFailed,
  webProbes,
} from "../infra/smoke.ts";

export type { SmokeReport } from "../infra/smoke.ts";

export { DemoStageRefused, LoopFailed, smokeLoop } from "./lib/smoke/loop.ts";

export type { SmokeLoopReport } from "./lib/smoke/loop.ts";

/** The loop's answerer when `--as` names none: a person every stage's sessions hold. */
const ANSWERER = "bram";

const failed = (reason: string) => new LoopFailed({ reason, step: "people" });

/** A run's name: when it started, to the second, in UTC (`20261013-091500`). */
const runName = Effect.map(DateTime.now, (now) =>
  DateTime.formatIso(now)
    .slice(0, 19)
    .replaceAll(/[-:]/gu, "")
    .replace("T", "-")
);

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Handle))
);

/**
 * The loop's two people's tokens, from the env: the operator's, and the
 * answerer's by handle from `SESSION_TOKENS`. A missing one fails naming
 * it, and never a token.
 */
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

/** Where the stage's platform lives: `--url`, or bootstrap's workers.dev record. */
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

/**
 * `bun scripts/smoke.ts --stage <s> --loop [--as <handle>] [--url <origin>]`:
 * refuses demo first, then runs the probes, then the core loop, printing
 * each step's time as it passes and a summary at the end.
 */
const loopMain = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);

    yield* stage === "demo"
      ? Effect.fail(new DemoStageRefused({ stage }))
      : Effect.void;

    const answerer = Option.getOrElse(flagValue(argv, "--as"), () => ANSWERER);
    const tokens = yield* tokensFrom(answerer);
    const origin = yield* originOf(argv, stage);

    yield* probeMain(argv.filter((arg) => arg !== "--loop"));

    const run = yield* runName;

    yield* Console.log(`smoke ${stage}: loop smoke-${run} at ${origin}`);

    const report = yield* smokeLoop({ ...tokens, origin, run, stage });
    const total = report.timings.reduce((sum, { ms }) => sum + ms, 0);

    yield* Console.log(
      `smoke ${stage}: loop passed in ${total} ms: ${report.project} landed ${report.landed.slice(0, 12)} by ${report.author}, refused first with ${report.refusedWith.join(", ")}; trailers ${report.trailers.join("; ")}`
    );
  });

/**
 * `bun scripts/smoke.ts --stage <s> [--loop] …`: the probes, and with
 * `--loop` the core loop after them.
 */
export const main = (argv: readonly string[]) =>
  argv.includes("--loop") ? loopMain(argv) : probeMain(argv);

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
