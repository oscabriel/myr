/**
 * smoke's probes: read-only requests to a live stage's platform, each of which
 * a misbehaving public surface fails. Every probe runs, whatever the others
 * did, so one run names every surface that broke; each one is timed, for the
 * benches (311).
 *
 * 1. `health`: `GET /health` answers `200 {ok: true, stage}`, and names the
 *    stage smoke was pointed at, when it was told one;
 * 2. `oauth-metadata`: `GET /.well-known/oauth-protected-resource` answers
 *    200 with RFC 9728's metadata, which names its `resource`;
 * 3. `mcp-needs-credential`: `POST /mcp` without a credential answers 401;
 * 4. `anonymous-unknown-project`: an anonymous `/rpc` `listAsks` for a project
 *    that doesn't exist answers 200 with a typed `UnknownProject` refusal;
 * 5. `missing-repo-404`: git's `info/refs` for a repo that doesn't exist
 *    answers 404.
 *
 * `scripts/smoke.ts` is the command; this module holds the probes, since
 * `infra/` may use `effect/http` (tsconfig.base.json's overrides).
 */
import { UnknownProject } from "@repo/protocol/refusal";
import {
  Console,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Result,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import {
  flagValue,
  platformOrigin,
  repoRoot,
  stageOf,
  subdomainFile,
  WorkersDev,
} from "./stages.ts";
import type { Stage } from "./stages.ts";

/** Every probe, in the order smoke runs them. */
export const probes = [
  "health",
  "oauth-metadata",
  "mcp-needs-credential",
  "anonymous-unknown-project",
  "missing-repo-404",
] as const;

export const Probe = Schema.Literals(probes);

export type Probe = typeof Probe.Type;

/** A project no stage holds: smoke asks for it and expects to be refused. */
const MISSING = "no-such-project";

/** How long one probe waits for an answer: a cold Worker included. */
const PATIENCE = Duration.seconds(30);

/** One or more probes failed: each, and why. */
export class SmokeFailed extends Schema.TaggedError<SmokeFailed>()(
  "SmokeFailed",
  {
    failures: Schema.Array(
      Schema.Struct({ probe: Probe, reason: Schema.String })
    ),
    origin: Schema.String,
  }
) {}

/** A passing run: the stage `/health` named, and how long each probe took. */
export interface SmokeReport {
  readonly origin: string;
  readonly stage: string;
  readonly probes: readonly {
    readonly probe: Probe;
    readonly elapsedMs: number;
  }[];
}

/** Why one probe failed, in a line a person reads. */
class Missed extends Schema.TaggedError<Missed>()("Missed", {
  reason: Schema.String,
}) {}

/** The parts of a response a probe judges. */
interface Answer {
  readonly status: number;
  readonly text: string;
}

/** `request` sent to `origin`, as a probe sees its answer. */
const send = (
  label: string,
  request: HttpClientRequest.HttpClientRequest
): Effect.Effect<Answer, Missed, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request);
    const text = yield* response.text;

    return { status: response.status, text };
  }).pipe(
    Effect.catchTag("HttpClientError", ({ reason }) =>
      Effect.fail(
        new Missed({ reason: `${label} got no answer (${reason._tag})` })
      )
    ),
    Effect.timeoutOrElse({
      duration: PATIENCE,
      orElse: () =>
        Effect.fail(
          new Missed({
            reason: `${label} got no answer within ${Duration.format(PATIENCE)}`,
          })
        ),
    })
  );

/** `answer`, when its status is `expected`. */
const statusIs = (label: string, expected: number) => (answer: Answer) =>
  answer.status === expected
    ? Effect.succeed(answer)
    : Effect.fail(
        new Missed({
          reason: `${label} answered ${answer.status}, not ${expected}`,
        })
      );

/** A failure of any kind, as the miss `reason` names. */
const missing =
  (reason: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.mapError(self, () => new Missed({ reason }));

const decodeHealth = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ ok: Schema.Literal(true), stage: Schema.NonEmptyString })
  )
);

/** `/health`: the Worker is up, and serves the stage it was told to. */
const health = (origin: string, expected: Option.Option<Stage>) =>
  Effect.gen(function* () {
    const label = "GET /health";

    const { text } = yield* send(
      label,
      HttpClientRequest.get(`${origin}/health`)
    ).pipe(Effect.flatMap(statusIs(label, 200)));

    const { stage } = yield* decodeHealth(text).pipe(
      missing(`${label} answered 200 without {"ok":true,"stage":…}`)
    );

    return yield* Option.match(expected, {
      onNone: () => Effect.succeed(stage),
      onSome: (wanted) =>
        stage === wanted
          ? Effect.succeed(stage)
          : Effect.fail(
              new Missed({
                reason: `${label} named stage ${stage}, not ${wanted}`,
              })
            ),
    });
  });

/** RFC 9728: the protected resource's metadata names the resource. */
const decodeResourceMetadata = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ resource: Schema.NonEmptyString }))
);

const oauthMetadata = (origin: string) =>
  Effect.gen(function* () {
    const route = "/.well-known/oauth-protected-resource";
    const label = `GET ${route}`;

    const { text } = yield* send(
      label,
      HttpClientRequest.get(`${origin}${route}`)
    ).pipe(Effect.flatMap(statusIs(label, 200)));

    yield* decodeResourceMetadata(text).pipe(
      missing(`${label} answered 200 without a "resource"`)
    );
  });

/** MCP stays closed to anyone without a credential (spec §8 D10). */
const mcpNeedsCredential = (origin: string) => {
  const label = "POST /mcp without a credential";

  return send(
    label,
    HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(`${origin}/mcp`), {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    })
  ).pipe(Effect.flatMap(statusIs(label, 401)), Effect.asVoid);
};

/** One call as effect/rpc's HTTP protocol with JSON serialization sends it. */
const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({ project: Schema.String }),
  tag: Schema.Literal("listAsks"),
});

/** The one reply smoke accepts: the call failed with `UnknownProject`. */
const decodeRefused = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.TaggedStruct("Exit", {
        exit: Schema.TaggedStruct("Failure", {
          cause: Schema.Tuple([
            Schema.TaggedStruct("Fail", { error: UnknownProject }),
          ]),
        }),
      }),
    ])
  )
);

/** A read anyone may make, refused for a project that doesn't exist. */
const anonymousUnknownProject = (origin: string) =>
  Effect.gen(function* () {
    const label = "POST /rpc listAsks";

    const call = RpcRequest.make({
      headers: [],
      id: "1",
      payload: { project: MISSING },
      tag: "listAsks",
    });

    const { text } = yield* send(
      label,
      HttpClientRequest.bodyJsonUnsafe(
        HttpClientRequest.post(`${origin}/rpc`),
        [call]
      )
    ).pipe(Effect.flatMap(statusIs(label, 200)));

    const [reply] = yield* decodeRefused(text).pipe(
      missing(
        `${label} for ${MISSING} answered 200 without an UnknownProject refusal`
      )
    );

    const [cause] = reply.exit.cause;

    return yield* cause.error.project === MISSING
      ? Effect.void
      : Effect.fail(
          new Missed({
            reason: `${label} for ${MISSING} refused another project, ${cause.error.project}`,
          })
        );
  });

/** git's discovery for a repo that doesn't exist. */
const missingRepo = (origin: string) => {
  const route = `/${MISSING}.git/info/refs`;
  const label = `GET ${route}`;

  return send(
    label,
    HttpClientRequest.get(`${origin}${route}?service=git-upload-pack`)
  ).pipe(Effect.flatMap(statusIs(label, 404)), Effect.asVoid);
};

/** One probe's run: how long it took, and whether it held. */
const timed = <A>(
  probe: Probe,
  run: Effect.Effect<A, Missed, HttpClient.HttpClient>
) =>
  Effect.timed(Effect.result(run)).pipe(
    Effect.map(([elapsed, outcome]) => ({
      elapsedMs: Math.round(Duration.toMillis(elapsed)),
      outcome,
      probe,
    }))
  );

/**
 * Runs every probe against the platform at `origin`; with `stage`, `/health`
 * must name it.
 */
export const smoke = (
  origin: string,
  options: { readonly stage?: Stage } = {}
): Effect.Effect<SmokeReport, SmokeFailed, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const first = yield* timed(
      "health",
      health(origin, Option.fromUndefinedOr(options.stage))
    );

    const rest = yield* Effect.forEach(
      [
        ["oauth-metadata", oauthMetadata(origin)],
        ["mcp-needs-credential", mcpNeedsCredential(origin)],
        ["anonymous-unknown-project", anonymousUnknownProject(origin)],
        ["missing-repo-404", missingRepo(origin)],
      ] as const,
      ([probe, run]) => timed(probe, run)
    );

    const runs: readonly {
      readonly probe: Probe;
      readonly elapsedMs: number;
      readonly outcome: Result.Result<unknown, Missed>;
    }[] = [first, ...rest];

    const failures = runs.flatMap(({ outcome, probe }) =>
      Result.isFailure(outcome)
        ? [{ probe, reason: outcome.failure.reason }]
        : []
    );

    // `first`'s own check, too, so its stage below is known to be there.
    if (Result.isFailure(first.outcome) || failures.length > 0) {
      return yield* new SmokeFailed({ failures, origin });
    }

    return {
      origin,
      probes: runs.map(({ elapsedMs, probe }) => ({ elapsedMs, probe })),
      stage: first.outcome.success,
    };
  });

const decodeWorkersDev = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WorkersDev)
);

/** Neither `--url` nor bootstrap's record says where the stage lives. */
export class NoOrigin extends Schema.TaggedError<NoOrigin>()("NoOrigin", {
  file: Schema.String,
  stage: Schema.String,
}) {}

/** Where `stage`'s platform lives: `--url`, or bootstrap's workers.dev record. */
const originOf = (argv: readonly string[], stage: Stage) =>
  Effect.gen(function* () {
    const given = flagValue(argv, "--url");

    if (Option.isSome(given)) {
      return given.value.replace(/\/+$/u, "");
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const unknown = new NoOrigin({ file: subdomainFile, stage });

    const { subdomain } = yield* fs
      .readFileString(path.join(yield* repoRoot, subdomainFile))
      .pipe(
        Effect.flatMap(decodeWorkersDev),
        Effect.mapError(() => unknown)
      );

    return platformOrigin(stage, subdomain);
  });

/**
 * `bun scripts/smoke.ts --stage <s> [--url <origin>]`: smoke-tests the
 * stage, printing each probe's time, or each failure and why.
 */
export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);
    const origin = yield* originOf(argv, stage);

    yield* Console.log(`smoke ${stage}: ${origin}`);

    const report = yield* smoke(origin, { stage }).pipe(
      Effect.tapError(({ failures }) =>
        Effect.forEach(
          failures,
          ({ probe, reason }) =>
            Console.error(`smoke ${stage}: ${probe} failed: ${reason}`),
          { discard: true }
        )
      )
    );

    yield* Effect.forEach(
      report.probes,
      ({ elapsedMs, probe }) =>
        Console.log(`smoke ${stage}: ${probe} passed in ${elapsedMs} ms`),
      { discard: true }
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
