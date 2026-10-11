/**
 * smoke's probes: read-only requests to a live stage's platform and web, each
 * of which a misbehaving public surface fails. Every probe runs, whatever the
 * others did, so one run names every surface that broke; each one is timed.
 *
 * 1. `health`: `GET /health` answers `200 {ok: true, stage}`, and names the
 *    stage smoke was pointed at, when it was told one;
 * 2. `oauth-metadata`: `GET /.well-known/oauth-protected-resource` answers
 *    200 with RFC 9728's metadata, which names its `resource`;
 * 3. `mcp-needs-credential`: `POST /mcp` without a credential answers 401;
 * 4. `anonymous-unknown-project`: an anonymous `/rpc` `listAsks` for a project
 *    that doesn't exist answers 200 with a typed `UnknownProject` refusal;
 * 5. `missing-repo-404`: git's `info/refs` for a repo that doesn't exist
 *    answers 404;
 * 6. `platform-root`: the platform's `GET /` answers 200 with a page that
 *    names its MCP endpoint (`/mcp`) and the CLI's `install.sh`;
 * 7. `web-front-page`: the web's `GET /` answers 200 with HTML;
 * 8. `web-llms-txt`: the web's `GET /llms.txt` answers 200 with Markdown,
 *    which it builds from the platform's project list, so only a web that
 *    reaches the platform through its service binding passes;
 * 9. `web-project-llms-txt`: a seeded example's `llms.txt` on the web
 *    answers 200 with Markdown;
 * 10. `web-ask-md`: one of the seeded example's asks as Markdown answers 200;
 * 11. `web-agent-skills`: the web's `/.well-known/agent-skills/index.json`
 *    answers 200 with JSON.
 *
 * The web's probes run when smoke knows where the web lives: bootstrap's
 * workers.dev record, or `--web-url`. 9 and 10 need the seeded example,
 * which a stage holds only once it is seeded, after its first deploy (and
 * that deploy's smoke): when the platform refuses the example as unknown,
 * each is skipped with a warning line. The agent surfaces among them
 * (`agentProbes`, 8 to 11) are what an agent reads first, so each is timed
 * against `AGENT_BUDGET_MS`: one over it is a warning line, never a failure,
 * since a cold isolate's first answer is slower than the rest.
 *
 * A probe the platform answers with its own failure (a server error, or an
 * RPC defect) asks again for up to `settling`, as a fresh deploy gives
 * those for its first seconds; any other wrong answer fails it at once.
 *
 * `scripts/smoke.ts` is the command; this module holds the probes, since
 * `infra/` may use `effect/http` (tsconfig.base.json's overrides).
 */
import { UnknownProject } from "@repo/protocol/refusal";
import {
  Console,
  Duration,
  Effect,
  Option,
  Result,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import {
  flagValue,
  platformOrigin,
  recordedSubdomain,
  stageOf,
  subdomainFile,
  webOrigin,
} from "./stages.ts";
import type { Stage } from "./stages.ts";

/** The platform's probes, in the order smoke runs them. */
export const platformProbes = [
  "health",
  "oauth-metadata",
  "mcp-needs-credential",
  "anonymous-unknown-project",
  "missing-repo-404",
  "platform-root",
] as const;

/** The web's probes, run after the platform's when smoke has the web's origin. */
export const webProbes = [
  "web-front-page",
  "web-llms-txt",
  "web-project-llms-txt",
  "web-ask-md",
  "web-agent-skills",
] as const;

/** How long an agent surface may take to answer before smoke warns: 500 ms. */
export const AGENT_BUDGET_MS = 500;

/** An example every seeded stage holds, by its name, and one of its asks. */
const SEEDED = { ask: "format-ordinal", project: "oscabriel/datekit" } as const;

/** The probes that read the seeded example, skipped on a stage that does not hold it. */
export const seededProbes: ReadonlySet<Probe> = new Set([
  "web-project-llms-txt",
  "web-ask-md",
]);

/** The agent surfaces on the web smoke reads, each by its path and the media type it answers with. */
export const agentProbes = [
  { contentType: "text/markdown", path: "/llms.txt", probe: "web-llms-txt" },
  {
    contentType: "text/markdown",
    path: `/${SEEDED.project}/llms.txt`,
    probe: "web-project-llms-txt",
  },
  {
    contentType: "text/markdown",
    path: `/${SEEDED.project}/asks/${SEEDED.ask}.md`,
    probe: "web-ask-md",
  },
  {
    contentType: "application/json",
    path: "/.well-known/agent-skills/index.json",
    probe: "web-agent-skills",
  },
] as const satisfies readonly {
  readonly contentType: string;
  readonly path: string;
  readonly probe: (typeof webProbes)[number];
}[];

/** Every probe, in the order smoke runs them. */
export const probes = [...platformProbes, ...webProbes] as const;

export const Probe = Schema.Literals(probes);

export type Probe = typeof Probe.Type;

/** A project no stage holds, by a name one could have: smoke asks for it and expects to be refused. */
const MISSING = "oscabriel/no-such-project";

/** How long one probe waits for an answer: a cold Worker included. */
const PATIENCE = Duration.seconds(30);

/**
 * How long a probe keeps asking a platform that answers with a server error
 * or a defect, as a fresh deploy does for its first seconds (the first
 * smoke after the first deploy got a 500 from `/health` and a defect from
 * the first Project DO call; a run seconds later passed).
 */
const SETTLING = Duration.seconds(30);

/** How long a probe waits between two asks while the platform settles. */
const ASK_AGAIN = Duration.seconds(1);

/** One or more probes failed: each, and why. */
export class SmokeFailed extends Schema.TaggedError<SmokeFailed>()(
  "SmokeFailed",
  {
    failures: Schema.Array(
      Schema.Struct({ probe: Probe, reason: Schema.String })
    ),
    origin: Schema.String,
  }
) {
  override get message() {
    const failed = this.failures.map(({ probe }) => probe).join(", ");

    return `${failed} failed at ${this.origin}`;
  }
}

/**
 * A passing run: the stage `/health` named, how long each probe took
 * (against its budget, when it has one), and a line for each probe over it.
 */
export interface SmokeReport {
  readonly origin: string;
  readonly stage: string;
  readonly probes: readonly {
    readonly probe: Probe;
    readonly elapsedMs: number;
    readonly budgetMs?: number;
  }[];
  readonly warnings: readonly string[];
}

/**
 * Why one probe failed, in a line a person reads. A transient miss is the
 * platform's own failure (a server error, a defect), which a fresh deploy
 * may give for its first seconds, so the probe asks again; any other answer
 * is the platform's word, and fails the probe at once.
 */
class Missed extends Schema.TaggedError<Missed>()("Missed", {
  reason: Schema.String,
  transient: Schema.optionalKey(Schema.Boolean),
}) {}

/** The parts of a response a probe judges. */
interface Answer {
  readonly contentType: string;
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

    return {
      contentType: response.headers["content-type"] ?? "",
      status: response.status,
      text,
    };
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

/** A server error: the Worker's own failure, which a fresh deploy gives for its first seconds. */
const serverError = (status: number) => status >= 500;

/**
 * A server error, or a 404 from a hostname that is not serving yet: a
 * Worker's first deploy to workers.dev answers 404 for its first seconds
 * (once, smoke ran 4 s after the web's first deploy and got 404 twice), and
 * a deploy that adds a route can still be answered by the version before it
 * (a demo deploy that added `/`: it answered 404 once as the upload finished). The
 * web's probes and `platform-root` read a 404 so; the platform's
 * `missing-repo-404` expects one.
 */
const notServingYet = (status: number) => status >= 500 || status === 404;

/** `answer`, when its status is `expected`; `transient` says which others to ask again. */
const statusIs =
  (label: string, expected: number, transient = serverError) =>
  (answer: Answer) =>
    answer.status === expected
      ? Effect.succeed(answer)
      : Effect.fail(
          new Missed({
            reason: `${label} answered ${answer.status}, not ${expected}`,
            transient: transient(answer.status),
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

/** MCP stays closed to anyone without a credential. */
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

/** A reply whose call died in the platform: its own failure, not an answer. */
const decodeDefect = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Tuple([Schema.TaggedStruct("Defect", { defect: Schema.Unknown })])
  )
);

/** An anonymous `/rpc` `listAsks` of `project`, as the platform answers it. */
const listAsks = (origin: string, project: string, label: string) =>
  send(
    label,
    HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(`${origin}/rpc`), [
      RpcRequest.make({
        headers: [],
        id: "1",
        payload: { project },
        tag: "listAsks",
      }),
    ])
  );

/** A read anyone may make, refused for a project that doesn't exist. */
const anonymousUnknownProject = (origin: string) =>
  Effect.gen(function* () {
    const label = "POST /rpc listAsks";

    const { text } = yield* listAsks(origin, MISSING, label).pipe(
      Effect.flatMap(statusIs(label, 200))
    );

    const [reply] = yield* decodeRefused(text).pipe(
      Effect.mapError(() =>
        Option.isSome(decodeDefect(text))
          ? new Missed({
              reason: `${label} for ${MISSING} died in the platform (a defect)`,
              transient: true,
            })
          : new Missed({
              reason: `${label} for ${MISSING} answered 200 without an UnknownProject refusal`,
            })
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

/**
 * Whether the platform at `origin` holds the seeded example: false only
 * when it refuses the example as an unknown project; any other answer
 * leaves the example's probes to say what is wrong.
 */
const holdsSeeded = (origin: string) =>
  listAsks(origin, SEEDED.project, `POST /rpc listAsks ${SEEDED.project}`).pipe(
    Effect.flatMap(({ text }) => Effect.option(decodeRefused(text))),
    Effect.map(
      Option.match({
        onNone: () => true,
        onSome: ([{ exit }]) => exit.cause[0].error.project !== SEEDED.project,
      })
    ),
    Effect.orElseSucceed(() => true)
  );

/** git's discovery for a repo that doesn't exist. */
const missingRepo = (origin: string) => {
  const route = `/${MISSING}.git/info/refs`;
  const label = `GET ${route}`;

  return send(
    label,
    HttpClientRequest.get(`${origin}${route}?service=git-upload-pack`)
  ).pipe(Effect.flatMap(statusIs(label, 404)), Effect.asVoid);
};

/** The platform's own `/`: a page naming its MCP endpoint and the CLI's installer. */
const platformRoot = (origin: string) => {
  const label = "GET /";

  return send(label, HttpClientRequest.get(`${origin}/`)).pipe(
    Effect.flatMap(statusIs(label, 200, notServingYet)),
    Effect.flatMap(({ text }) =>
      text.includes("/mcp") && text.includes("install.sh")
        ? Effect.void
        : Effect.fail(
            new Missed({
              reason: `${label} answered 200 without naming /mcp and install.sh`,
            })
          )
    )
  );
};

/** `answer`, when its content type is `wanted` (by its media type alone). */
const typeIs =
  (label: string, wanted: string, said: string) => (answer: Answer) =>
    answer.contentType.split(";")[0]?.trim() === wanted
      ? Effect.succeed(answer)
      : Effect.fail(
          new Missed({
            reason: `${label} answered ${answer.contentType || "no content type"}, not ${said}`,
          })
        );

/** The web's front page renders: a page a browser shows, not an error's JSON. */
const webFrontPage = (web: string) => {
  const label = "GET / on the web";

  return send(label, HttpClientRequest.get(`${web}/`)).pipe(
    Effect.flatMap(statusIs(label, 200, notServingYet)),
    Effect.flatMap(typeIs(label, "text/html", "HTML")),
    Effect.asVoid
  );
};

/** An agent surface on the web: 200, with the media type it answers with. */
const agentSurface = (
  web: string,
  { contentType, path }: (typeof agentProbes)[number]
) => {
  const label = `GET ${path} on the web`;

  return send(label, HttpClientRequest.get(`${web}${path}`)).pipe(
    Effect.flatMap(statusIs(label, 200, notServingYet)),
    Effect.flatMap(typeIs(label, contentType, contentType))
  );
};

/**
 * The web's `/llms.txt`: Markdown that opens with its title. The web answers
 * 503 when the platform does not, so a 200 is the service binding working.
 */
const webLlmsTxt = (web: string, probe: (typeof agentProbes)[number]) => {
  const label = "GET /llms.txt on the web";

  return agentSurface(web, probe).pipe(
    Effect.flatMap(({ text }) =>
      text.startsWith("# ")
        ? Effect.void
        : Effect.fail(
            new Missed({ reason: `${label} answered 200 without a title` })
          )
    )
  );
};

/**
 * One probe's run: how long it took, and whether it held. A transient miss
 * is asked again, every `ASK_AGAIN`, for `settling` at most; the probe fails
 * with its last miss.
 */
const timed = <A>(
  probe: Probe,
  run: Effect.Effect<A, Missed, HttpClient.HttpClient>,
  settling: Duration.Input
) =>
  Effect.timed(
    Effect.result(
      Effect.retry(run, {
        schedule: Schedule.spaced(ASK_AGAIN).pipe(
          Schedule.upTo({ duration: settling })
        ),
        while: ({ transient }) => transient === true,
      })
    )
  ).pipe(
    Effect.map(([elapsed, outcome]) => ({
      elapsedMs: Math.round(Duration.toMillis(elapsed)),
      outcome,
      probe,
    }))
  );

/**
 * Runs every probe against the platform at `origin`, and with `web` the
 * web's probes against that origin; with `stage`, `/health` must name it.
 * `settling` bounds how long a probe asks again while a Worker answers with
 * its own failure (30 s unless given).
 */
export const smoke = (
  origin: string,
  options: {
    readonly stage?: Stage;
    readonly settling?: Duration.Input;
    readonly web?: string;
  } = {}
): Effect.Effect<SmokeReport, SmokeFailed, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const settling = options.settling ?? SETTLING;

    const first = yield* timed(
      "health",
      health(origin, Option.fromUndefinedOr(options.stage)),
      settling
    );

    const { web } = options;

    const seeded = web === undefined ? true : yield* holdsSeeded(origin);

    const skipped = seeded
      ? []
      : agentProbes.filter(({ probe }) => seededProbes.has(probe));

    const rest = yield* Effect.forEach(
      [
        ["oauth-metadata", oauthMetadata(origin)],
        ["mcp-needs-credential", mcpNeedsCredential(origin)],
        ["anonymous-unknown-project", anonymousUnknownProject(origin)],
        ["missing-repo-404", missingRepo(origin)],
        ["platform-root", platformRoot(origin)],
        ...(web === undefined
          ? []
          : ([
              ["web-front-page", webFrontPage(web)],
              ...agentProbes.flatMap((agent) =>
                skipped.includes(agent)
                  ? []
                  : [
                      [
                        agent.probe,
                        agent.probe === "web-llms-txt"
                          ? webLlmsTxt(web, agent)
                          : Effect.asVoid(agentSurface(web, agent)),
                      ] as const,
                    ]
              ),
            ] as const)),
      ] as const,
      ([probe, run]) => timed(probe, run, settling)
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

    const budgeted = new Set<Probe>(agentProbes.map(({ probe }) => probe));

    const timings = runs.map(({ elapsedMs, probe }) =>
      budgeted.has(probe)
        ? { budgetMs: AGENT_BUDGET_MS, elapsedMs, probe }
        : { elapsedMs, probe }
    );

    return {
      origin,
      probes: timings,
      stage: first.outcome.success,
      warnings: [
        ...skipped.map(
          ({ probe }) =>
            `${probe} was skipped: ${SEEDED.project} is not on this stage (bun run seed puts it there)`
        ),
        ...timings.flatMap(({ budgetMs, elapsedMs, probe }) =>
          budgetMs !== undefined && elapsedMs > budgetMs
            ? [
                `${probe} answered in ${elapsedMs} ms, over its ${budgetMs} ms budget`,
              ]
            : []
        ),
      ],
    };
  });

/** Neither `--url` nor bootstrap's record says where the stage lives. */
export class NoOrigin extends Schema.TaggedError<NoOrigin>()("NoOrigin", {
  file: Schema.String,
  stage: Schema.String,
}) {
  override get message() {
    return `no --url, and ${this.file} doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage ${this.stage} first`;
  }
}

/** Where a stage's platform lives, and its web when smoke can know it. */
interface Origins {
  readonly platform: string;
  readonly web: Option.Option<string>;
}

const trimmed = (origin: string) => origin.replace(/\/+$/u, "");

/**
 * Where `stage`'s platform and web live: `--url` (and `--web-url`), or
 * bootstrap's workers.dev record. A platform given by `--url` has no web
 * unless `--web-url` names it.
 */
const originsOf = (argv: readonly string[], stage: Stage) =>
  Effect.gen(function* () {
    const given = flagValue(argv, "--url");
    const web = Option.map(flagValue(argv, "--web-url"), trimmed);

    if (Option.isSome(given)) {
      return { platform: trimmed(given.value), web } satisfies Origins;
    }

    const subdomain = yield* recordedSubdomain.pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.mapError(() => new NoOrigin({ file: subdomainFile, stage }))
    );

    return {
      platform: platformOrigin(stage, subdomain),
      web: Option.orElse(web, () => Option.some(webOrigin(stage, subdomain))),
    } satisfies Origins;
  });

/**
 * `bun scripts/smoke.ts --stage <s> [--url <origin>] [--web-url <origin>]`:
 * smoke-tests the stage, printing each probe's time, or each failure and why.
 */
export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);
    const origins = yield* originsOf(argv, stage);

    yield* Console.log(
      `smoke ${stage}: ${origins.platform}${Option.match(origins.web, {
        onNone: () => "",
        onSome: (web) => ` and ${web}`,
      })}`
    );

    const report = yield* smoke(origins.platform, {
      stage,
      ...Option.match(origins.web, {
        onNone: () => ({}),
        onSome: (web) => ({ web }),
      }),
    }).pipe(
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
      ({ budgetMs, elapsedMs, probe }) =>
        Console.log(
          `smoke ${stage}: ${probe} passed in ${elapsedMs} ms${
            budgetMs === undefined ? "" : ` (budget ${budgetMs} ms)`
          }`
        ),
      { discard: true }
    );

    yield* Effect.forEach(
      report.warnings,
      (line) => Console.warn(`smoke ${stage}: warning: ${line}`),
      { discard: true }
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
