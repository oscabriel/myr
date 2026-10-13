import { UnknownProject } from "@repo/protocol/refusal";
import {
  Config,
  Console,
  DateTime,
  Duration,
  Effect,
  Option,
  Result,
  Schedule,
  Schema,
} from "effect";
import type { Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { ANALYTICS_READ, errorsQuery, SQL_API, workersOf } from "./logs.ts";
import {
  flagValue,
  platformOrigin,
  recordedSubdomain,
  stageOf,
  subdomainFile,
  webOrigin,
} from "./stages.ts";
import type { Stage } from "./stages.ts";

export const platformProbes = [
  "health",
  "oauth-metadata",
  "mcp-needs-credential",
  "anonymous-unknown-project",
  "missing-repo-404",
  "platform-root",
] as const;

export const webProbes = [
  "web-front-page",
  "web-llms-txt",
  "web-project-llms-txt",
  "web-ask-md",
  "web-agent-skills",
] as const;

export const AGENT_BUDGET_MS = 500;

const SEEDED = { ask: "format-ordinal", project: "oscabriel/datekit" } as const;

export const seededProbes: ReadonlySet<Probe> = new Set([
  "web-project-llms-txt",
  "web-ask-md",
]);

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

export const probes = [...platformProbes, ...webProbes] as const;

// Run after every other probe, and only when smoke is told when the deploy began.
export const logProbes = ["worker-logs"] as const;

export const Probe = Schema.Literals([...probes, ...logProbes]);

export type Probe = typeof Probe.Type;

const MISSING = "oscabriel/no-such-project";

const PATIENCE = Duration.seconds(30);

// A fresh deploy answers with server errors or defects for its first seconds.
const SETTLING = Duration.seconds(30);

const ASK_AGAIN = Duration.seconds(1);

// Workers Logs reach the SQL API some seconds after the invocation, so the
// logs are read this long after the probes, whose own errors then count.
const INGESTION = Duration.seconds(30);

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

class Missed extends Schema.TaggedError<Missed>()("Missed", {
  reason: Schema.String,
  transient: Schema.optionalKey(Schema.Boolean),
}) {}

interface Answer {
  readonly contentType: string;
  readonly status: number;
  readonly text: string;
}

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

const serverError = (status: number) => status >= 500;

// A fresh workers.dev deploy, or one adding a route, answers 404 for its first seconds.
const notServingYet = (status: number) => status >= 500 || status === 404;

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

const missing =
  (reason: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.mapError(self, () => new Missed({ reason }));

const decodeHealth = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ ok: Schema.Literal(true), stage: Schema.NonEmptyString })
  )
);

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

const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({ project: Schema.String }),
  tag: Schema.Literal("listAsks"),
});

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

const decodeDefect = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Tuple([Schema.TaggedStruct("Defect", { defect: Schema.Unknown })])
  )
);

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

// False only on an UnknownProject refusal; any other answer leaves the probes to report it.
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

const missingRepo = (origin: string) => {
  const route = `/${MISSING}.git/info/refs`;
  const label = `GET ${route}`;

  return send(
    label,
    HttpClientRequest.get(`${origin}${route}?service=git-upload-pack`)
  ).pipe(Effect.flatMap(statusIs(label, 404)), Effect.asVoid);
};

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

const typeIs =
  (label: string, wanted: string, said: string) => (answer: Answer) =>
    answer.contentType.split(";")[0]?.trim() === wanted
      ? Effect.succeed(answer)
      : Effect.fail(
          new Missed({
            reason: `${label} answered ${answer.contentType || "no content type"}, not ${said}`,
          })
        );

const webFrontPage = (web: string) => {
  const label = "GET / on the web";

  return send(label, HttpClientRequest.get(`${web}/`)).pipe(
    Effect.flatMap(statusIs(label, 200, notServingYet)),
    Effect.flatMap(typeIs(label, "text/html", "HTML")),
    Effect.asVoid
  );
};

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

// The web answers 503 when the platform does not, so a 200 proves the service binding.
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

// What reading the stage's logs needs: the instant the deploy's first upload
// began, the Workers to read, and infra's credentials.
export interface LogsCheck {
  readonly since: DateTime.Utc;
  readonly workers: readonly string[];
  readonly accountId: string;
  readonly token: Redacted.Redacted;
  // The SQL API's endpoint; a test points it at a fake.
  readonly api?: string;
  readonly ingestion?: Duration.Input;
}

const decodeErrors = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      data: Schema.Array(
        Schema.Struct({ errors: Schema.Int, scriptName: Schema.String })
      ),
    })
  )
);

// How the API refuses the credentials, as seen live: 400 (error 9106) for a
// token it can't authenticate, and 422 naming the account tag for an account
// the token can't read; 401 and 403 are its usual answers to a missing
// permission.
const refusedCredentials = (status: number, text: string) =>
  status === 400 ||
  status === 401 ||
  status === 403 ||
  (status === 422 && text.includes("account or zone tag"));

// The API's own first line, which names what it could not run.
const unread = (label: string, status: number, text: string) => {
  const said = text.split("\n")[0]?.trim().slice(0, 200) ?? "";

  if (refusedCredentials(status, text)) {
    return `${label} answered ${status}: CLOUDFLARE_API_TOKEN needs ${ANALYTICS_READ} on the account CLOUDFLARE_ACCOUNT_ID names`;
  }

  return said === ""
    ? `${label} answered ${status}`
    : `${label} answered ${status}: ${said}`;
};

const workerLogs = (check: LogsCheck) =>
  Effect.gen(function* () {
    const label = "POST /analytics/sql for the stage's Workers Logs";
    const since = DateTime.formatIso(check.since);

    const { status, text } = yield* send(
      label,
      HttpClientRequest.bodyJsonUnsafe(
        HttpClientRequest.post(check.api ?? SQL_API),
        {
          query: errorsQuery(check.workers),
          scope: { accountTag: check.accountId },
          time_range: { start: since },
        }
      ).pipe(HttpClientRequest.bearerToken(check.token))
    );

    if (status !== 200) {
      return yield* new Missed({
        reason: unread(label, status, text),
        transient: serverError(status),
      });
    }

    const { data } = yield* decodeErrors(text).pipe(
      missing(`${label} answered 200 without {"data":[{scriptName, errors}]}`)
    );

    const logged = check.workers.flatMap((worker) => {
      const errors = data
        .filter(({ scriptName }) => scriptName === worker)
        .reduce((sum, row) => sum + row.errors, 0);

      return errors > 0 ? [`${worker} ${errors}`] : [];
    });

    return yield* logged.length === 0
      ? Effect.void
      : Effect.fail(
          new Missed({
            reason: `exceptions or error-level lines since ${since}: ${logged.join(", ")}`,
          })
        );
  });

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

export const smoke = (
  origin: string,
  options: {
    readonly stage?: Stage;
    readonly settling?: Duration.Input;
    readonly web?: string;
    readonly logs?: LogsCheck;
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

    const { logs } = options;

    const read =
      logs === undefined
        ? []
        : [
            yield* Effect.sleep(logs.ingestion ?? INGESTION).pipe(
              Effect.andThen(timed("worker-logs", workerLogs(logs), settling))
            ),
          ];

    const runs: readonly {
      readonly probe: Probe;
      readonly elapsedMs: number;
      readonly outcome: Result.Result<unknown, Missed>;
    }[] = [first, ...rest, ...read];

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

export class NoOrigin extends Schema.TaggedError<NoOrigin>()("NoOrigin", {
  file: Schema.String,
  stage: Schema.String,
}) {
  override get message() {
    return `no --url, and ${this.file} doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage ${this.stage} first`;
  }
}

export class BadSince extends Schema.TaggedError<BadSince>()("BadSince", {
  given: Schema.String,
}) {
  override get message() {
    return `--since ${this.given} is not an ISO 8601 instant, as 2026-10-13T12:00:00.000Z`;
  }
}

export class NoLogCredentials extends Schema.TaggedError<NoLogCredentials>()(
  "NoLogCredentials",
  {}
) {
  override readonly message =
    "--since reads the stage's Workers Logs with infra's credentials, and CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not set: run smoke as the deploy does, through bunx varlock run --path infra/ --";
}

const Credentials = Config.all({
  accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
});

const decodeSince = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);

const logsOf = (argv: readonly string[], stage: Stage) =>
  Option.match(flagValue(argv, "--since"), {
    onNone: () => Effect.succeedNone,
    onSome: (given) =>
      Effect.gen(function* () {
        const since = yield* Effect.fromOption(decodeSince(given)).pipe(
          Effect.mapError(() => new BadSince({ given }))
        );

        const { accountId, token } = yield* Credentials.pipe(
          Effect.mapError(() => new NoLogCredentials())
        );

        return Option.some({
          accountId,
          since,
          token,
          workers: workersOf(stage),
        } satisfies LogsCheck);
      }),
  });

interface Origins {
  readonly platform: string;
  readonly web: Option.Option<string>;
}

const trimmed = (origin: string) => origin.replace(/\/+$/u, "");

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

export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);
    const origins = yield* originsOf(argv, stage);
    const logs = yield* logsOf(argv, stage);

    yield* Console.log(
      `smoke ${stage}: ${origins.platform}${Option.match(origins.web, {
        onNone: () => "",
        onSome: (web) => ` and ${web}`,
      })}${Option.match(logs, {
        onNone: () => "",
        onSome: ({ since }) =>
          `, then its Workers' logs since ${DateTime.formatIso(since)}`,
      })}`
    );

    const report = yield* smoke(origins.platform, {
      stage,
      ...Option.match(origins.web, {
        onNone: () => ({}),
        onSome: (web) => ({ web }),
      }),
      ...Option.match(logs, {
        onNone: () => ({}),
        onSome: (check) => ({ logs: check }),
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
