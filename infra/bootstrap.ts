// Usage: bun run bootstrap -- --stage <stage> [--dry-run | --check-triggers]
// Idempotent: creates only what is missing, and never deletes.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Config,
  Console,
  Data,
  Effect,
  FileSystem,
  Option,
  Path,
  Result,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { schemaItems } from "./env-schema.ts";
import type { SchemaItem } from "./env-schema.ts";
import { blankJsonc, pathKey, valueSpans } from "./jsonc.ts";
import type { JsonPath, Span } from "./jsonc.ts";
import {
  repoRoot,
  resources,
  stageOf,
  subdomainFile,
  WorkersDev,
} from "./stages.ts";
import type { Stage } from "./stages.ts";

export interface Existing {
  readonly namespaces: readonly string[];
  readonly d1: readonly { readonly name: string; readonly id: string }[];
  readonly kv: readonly { readonly title: string; readonly id: string }[];
  readonly r2: readonly string[];
}

export type Step = Data.TaggedEnum<{
  CreateNamespace: { readonly name: string };
  CreateD1: { readonly name: string };
  CreateKv: { readonly title: string };
  CreateR2: { readonly name: string };
}>;

export const Step = Data.taggedEnum<Step>();

export const plan = (stage: Stage, existing: Existing): readonly Step[] => {
  const names = resources(stage);

  return [
    ...[names.projects, names.layers].flatMap((name) =>
      existing.namespaces.includes(name) ? [] : [Step.CreateNamespace({ name })]
    ),
    ...(existing.d1.some(({ name }) => name === names.frontPage)
      ? []
      : [Step.CreateD1({ name: names.frontPage })]),
    ...(existing.kv.some(({ title }) => title === names.oauth)
      ? []
      : [Step.CreateKv({ title: names.oauth })]),
    ...[names.evidence, names.releases, names.codeCache].flatMap((name) =>
      existing.r2.includes(name) ? [] : [Step.CreateR2({ name })]
    ),
  ];
};

export interface Ids {
  readonly frontPage?: string | undefined;
  readonly oauth?: string | undefined;
}

const spanOf = (
  json: string,
  spans: ReadonlyMap<string, Span>,
  place: {
    readonly stage: Stage;
    readonly list: string;
    readonly binding: string;
    readonly key: string;
  }
): Option.Option<Span> => {
  const base: JsonPath = ["env", place.stage, place.list];
  const at = (path: JsonPath) => Option.fromNullishOr(spans.get(pathKey(path)));

  for (let index = 0; Option.isSome(at([...base, index])); index += 1) {
    const named = Option.exists(
      at([...base, index, "binding"]),
      ({ end, start }) =>
        json.slice(start, end) === JSON.stringify(place.binding)
    );

    if (named) {
      return at([...base, index, place.key]);
    }
  }

  return Option.none();
};

// Only those two values change: every comment, comma and line stays.
export const writeIds = (text: string, stage: Stage, ids: Ids): string => {
  const json = blankJsonc(text);
  const spans = valueSpans(json);

  const edits = [
    {
      binding: "FRONT_PAGE",
      id: ids.frontPage,
      key: "database_id",
      list: "d1_databases",
    },
    { binding: "OAUTH_KV", id: ids.oauth, key: "id", list: "kv_namespaces" },
  ].flatMap(({ id, ...place }) =>
    id === undefined
      ? []
      : Option.toArray(
          Option.map(spanOf(json, spans, { ...place, stage }), (span) => ({
            span,
            value: JSON.stringify(id),
          }))
        )
  );

  let written = text;

  // From the last edit back, so each span still points where it did.
  for (const { span, value } of edits.toSorted(
    (a, b) => b.span.start - a.span.start
  )) {
    written = `${written.slice(0, span.start)}${value}${written.slice(span.end)}`;
  }

  return written;
};

const Target = Schema.Struct({
  script_name: Schema.String,
  type: Schema.String,
  workflow_name: Schema.optionalKey(Schema.String),
});

const Trigger = Schema.Struct({
  filter: Schema.Struct({ namespace: Schema.optionalKey(Schema.String) }),
  targets: Schema.Array(Target),
  type: Schema.String,
});

export const TriggersResponse = Schema.Struct({
  result: Schema.Struct({
    script_name: Schema.String,
    triggers: Schema.Array(Trigger),
  }),
  success: Schema.Boolean,
});

const PUSHED = "cf.artifacts.repo.pushed";

export class TriggerMismatch extends Schema.TaggedError<TriggerMismatch>()(
  "TriggerMismatch",
  {
    found: Schema.Array(Schema.String),
    namespace: Schema.String,
    script: Schema.String,
    workflow: Schema.String,
  }
) {
  override get message() {
    const found = this.found.length === 0 ? "none" : this.found.join("; ");

    return `${this.script} has no ${PUSHED} trigger on ${this.namespace} starting ${this.workflow}; it has: ${found}`;
  }
}

const held: Result.Result<void> = Result.flip(Result.failVoid);

export const checkTriggers = (
  stage: Stage,
  live: typeof TriggersResponse.Type
): Result.Result<void, TriggerMismatch> => {
  const names = resources(stage);
  const { script_name: script, triggers } = live.result;

  const holds =
    live.success &&
    script === names.platform &&
    triggers.some(
      ({ filter, targets, type }) =>
        type === PUSHED &&
        filter.namespace === names.projects &&
        targets.some(
          (target) =>
            target.type === "workflow" &&
            target.script_name === names.platform &&
            target.workflow_name === names.onPush
        )
    );

  return holds
    ? held
    : Result.fail(
        new TriggerMismatch({
          found: triggers.flatMap(({ filter, targets, type }) =>
            targets.map(
              (target) =>
                `${type} on ${filter.namespace ?? "*"} → ${target.script_name}/${target.workflow_name ?? target.type}`
            )
          ),
          namespace: names.projects,
          script: names.platform,
          workflow: names.onPush,
        })
      );
};

const jsonIn = (stdout: string) => {
  const start = stdout.search(/^[[{]/mu);

  return start === -1 ? stdout : stdout.slice(start);
};

const decodeD1 = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ name: Schema.String, uuid: Schema.String }))
  )
);

const decodeKv = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))
  )
);

const decodeSecrets = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String })))
);

export const d1From = (stdout: string) =>
  decodeD1(jsonIn(stdout)).pipe(
    Effect.map((databases) =>
      databases.map(({ name, uuid }) => ({ id: uuid, name }))
    )
  );

export const kvFrom = (stdout: string) =>
  decodeKv(jsonIn(stdout)).pipe(
    Effect.map((namespaces) =>
      namespaces.map(({ id, title }) => ({ id, title }))
    )
  );

export const bucketsFrom = (stdout: string): readonly string[] =>
  stdout
    .split("\n")
    .flatMap((line) =>
      Option.toArray(
        Option.fromNullishOr(
          /^name:\s+(?<name>\S+)\s*$/u.exec(line)?.groups?.name
        )
      )
    );

export const secretNames = (stdout: string) =>
  decodeSecrets(jsonIn(stdout)).pipe(
    Effect.map((secrets) => secrets.map(({ name }) => name))
  );

export const missingSecrets = (
  items: readonly SchemaItem[],
  listed: readonly string[]
): readonly string[] =>
  items.flatMap(({ name, required }) =>
    required && !listed.includes(name) ? [name] : []
  );

export class CloudflareRefused extends Schema.TaggedError<CloudflareRefused>()(
  "CloudflareRefused",
  { route: Schema.String, status: Schema.Int }
) {
  override get message() {
    return `the Cloudflare API answered ${this.route} with ${this.status}`;
  }
}

export class WranglerFailed extends Schema.TaggedError<WranglerFailed>()(
  "WranglerFailed",
  { command: Schema.String, exitCode: Schema.Int }
) {
  override get message() {
    return `${this.command} exited ${this.exitCode}`;
  }
}

export class MissingSecrets extends Schema.TaggedError<MissingSecrets>()(
  "MissingSecrets",
  { names: Schema.Array(Schema.String), stage: Schema.String }
) {
  override get message() {
    return `${this.stage}'s platform lacks ${this.names.join(", ")}: set them by name, from the stage's secrets file (STAGE_SECRETS_FILE)`;
  }
}

const API = "https://api.cloudflare.com/client/v4";

const Credentials = Config.all({
  accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
});

type Credentials =
  typeof Credentials extends Config.Config<infer A> ? A : never;

const call = (
  credentials: Credentials,
  route: string,
  body?: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = `${API}/accounts/${credentials.accountId}${route}`;

    const request = (
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(url), body)
    ).pipe(HttpClientRequest.bearerToken(credentials.token));

    const response = yield* client.execute(request);

    return { status: response.status, text: yield* response.text };
  });

const ok = (credentials: Credentials, route: string) =>
  call(credentials, route).pipe(
    Effect.flatMap(({ status, text }) =>
      status === 200
        ? Effect.succeed(text)
        : Effect.fail(new CloudflareRefused({ route, status }))
    )
  );

const decodeTriggers = Schema.decodeEffect(
  Schema.fromJsonString(TriggersResponse)
);

const decodeSubdomain = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ result: WorkersDev }))
);

const exists = (credentials: Credentials, route: string) =>
  call(credentials, route).pipe(
    Effect.flatMap(({ status }) =>
      status === 200 || status === 404
        ? Effect.succeed(status === 200)
        : Effect.fail(new CloudflareRefused({ route, status }))
    )
  );

const wrangler = (root: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const app = path.join(root, "apps/platform");

    const handle = yield* spawner.spawn(
      ChildProcess.make(path.join(app, "node_modules/.bin/wrangler"), args, {
        cwd: app,
        // Writes outside Artifacts go through `wrangler login`, never the
        // read-mostly infra token.
        env: {
          CLOUDFLARE_API_TOKEN: undefined,
          WRANGLER_SEND_METRICS: "false",
        },
        extendEnv: true,
        stderr: "inherit",
      })
    );

    const [stdout, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
      { concurrency: "unbounded" }
    );

    return exitCode === 0
      ? stdout
      : yield* new WranglerFailed({
          command: `wrangler ${args.join(" ")}`,
          exitCode,
        });
  }).pipe(Effect.scoped, Effect.catchTag("PlatformError", Effect.die));

const readExisting = (root: string, credentials: Credentials, stage: Stage) =>
  Effect.gen(function* () {
    const { layers, projects } = resources(stage);

    const namespaces = yield* Effect.filter([projects, layers], (name) =>
      exists(credentials, `/artifacts/namespaces/${name}`)
    );

    return {
      d1: yield* wrangler(root, ["d1", "list", "--json"]).pipe(
        Effect.flatMap(d1From)
      ),
      kv: yield* wrangler(root, ["kv", "namespace", "list"]).pipe(
        Effect.flatMap(kvFrom)
      ),
      namespaces,
      r2: bucketsFrom(yield* wrangler(root, ["r2", "bucket", "list"])),
    } satisfies Existing;
  });

const describe = (step: Step) =>
  Step.$match(step, {
    CreateD1: ({ name }) => `create D1 ${name}`,
    CreateKv: ({ title }) => `create KV ${title}`,
    CreateNamespace: ({ name }) => `create Artifacts namespace ${name}`,
    CreateR2: ({ name }) => `create R2 ${name}`,
  });

export const planLines = (
  stage: Stage,
  steps: readonly Step[]
): readonly string[] => [
  ...steps.map((step) => `bootstrap ${stage} (dry run): ${describe(step)}`),
  `bootstrap ${stage} (dry run): would create ${steps.length}; nothing was changed`,
];

// Bootstrap writes the stage's block itself, not Wrangler's top-level binding.
const NO_CONFIG_EDIT = "--update-config=false";

const create = (root: string, credentials: Credentials, step: Step) =>
  Step.$match(step, {
    CreateD1: ({ name }) =>
      wrangler(root, ["d1", "create", name, NO_CONFIG_EDIT]),
    CreateKv: ({ title }) =>
      wrangler(root, ["kv", "namespace", "create", title, NO_CONFIG_EDIT]),
    CreateNamespace: ({ name }) => {
      const route = "/artifacts/namespaces";

      // `unrestricted` is cf's default jurisdiction, and the probes'.
      return call(credentials, route, {
        jurisdiction: "unrestricted",
        namespace: name,
      }).pipe(
        Effect.flatMap(({ status }) =>
          status === 200 || status === 201
            ? Effect.void
            : Effect.fail(new CloudflareRefused({ route, status }))
        )
      );
    },
    CreateR2: ({ name }) =>
      wrangler(root, ["r2", "bucket", "create", name, NO_CONFIG_EDIT]),
  }).pipe(Effect.asVoid);

const rewrite = (root: string, file: string, edit: (text: string) => string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(root, file);

    const text = yield* fs
      .exists(at)
      .pipe(
        Effect.flatMap((present) =>
          present ? fs.readFileString(at) : Effect.succeed("")
        )
      );

    const written = edit(text);

    if (written !== text) {
      yield* fs.writeFileString(at, written);
      yield* Console.log(`bootstrap: wrote ${file}`);
    }
  }).pipe(Effect.orDie);

const triggers = (credentials: Credentials, stage: Stage) =>
  Effect.gen(function* () {
    const { platform, projects } = resources(stage);

    const live = yield* ok(credentials, `/triggers/${platform}`).pipe(
      Effect.flatMap(decodeTriggers)
    );

    const verdict = checkTriggers(stage, live);

    return yield* Result.isFailure(verdict)
      ? Effect.fail(verdict.failure)
      : Console.log(
          `bootstrap ${stage}: ${platform} hears pushes to ${projects}.`
        );
  });

const secrets = (root: string, credentials: Credentials, stage: Stage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { platform } = resources(stage);

    const items = schemaItems(
      yield* fs
        .readFileString(path.join(root, "apps/platform/.env.schema"))
        .pipe(Effect.orDie)
    );

    const required = items.flatMap(({ name, required: needed }) =>
      needed ? [name] : []
    );

    // A script's settings answer 404 until its first deploy.
    const deployed = yield* exists(
      credentials,
      `/workers/scripts/${platform}/settings`
    );

    const listed = deployed
      ? yield* wrangler(root, [
          "secret",
          "list",
          "--env",
          stage,
          "--format",
          "json",
        ]).pipe(Effect.flatMap(secretNames))
      : [];

    const missing = missingSecrets(items, listed);

    if (!deployed) {
      return yield* Console.log(
        `bootstrap ${stage}: ${platform} is not deployed yet, so its first deploy must carry ${required.join(", ")} through varlock, from the stage's secrets file (STAGE_SECRETS_FILE).`
      );
    }

    return yield* missing.length === 0
      ? Console.log(
          `bootstrap ${stage}: ${platform} holds every required secret.`
        )
      : Effect.fail(new MissingSecrets({ names: missing, stage }));
  });

const dryRun = (root: string, credentials: Credentials, stage: Stage) =>
  Effect.gen(function* () {
    const steps = plan(stage, yield* readExisting(root, credentials, stage));

    yield* Console.log(planLines(stage, steps).join("\n"));
  });

const make = (root: string, credentials: Credentials, stage: Stage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = resources(stage);
    const before = yield* readExisting(root, credentials, stage);
    const steps = plan(stage, before);

    yield* Effect.forEach(
      steps,
      (step) =>
        Console.log(`bootstrap ${stage}: ${describe(step)}`).pipe(
          Effect.andThen(create(root, credentials, step))
        ),
      { discard: true }
    );

    const after =
      steps.length === 0
        ? before
        : yield* readExisting(root, credentials, stage);

    yield* rewrite(root, "apps/platform/wrangler.jsonc", (text) =>
      writeIds(text, stage, {
        frontPage: after.d1.find(({ name }) => name === names.frontPage)?.id,
        oauth: after.kv.find(({ title }) => title === names.oauth)?.id,
      })
    );

    const migrations = yield* fs
      .exists(path.join(root, "apps/platform/migrations"))
      .pipe(Effect.orDie);

    if (migrations) {
      yield* wrangler(root, [
        "d1",
        "migrations",
        "apply",
        names.frontPage,
        "--remote",
        "--env",
        stage,
      ]);
    }

    const { result } = yield* ok(credentials, "/workers/subdomain").pipe(
      Effect.flatMap(decodeSubdomain)
    );

    yield* rewrite(
      root,
      subdomainFile,
      () => `${JSON.stringify(result, null, 2)}\n`
    );

    yield* secrets(root, credentials, stage);

    yield* Console.log(
      `bootstrap ${stage}: created ${steps.length}; next: bun run deploy -- --stage ${stage}`
    );
  });

export const bootstrap = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);
    const credentials = yield* Credentials;
    const root = yield* repoRoot;

    if (argv.includes("--check-triggers")) {
      return yield* triggers(credentials, stage);
    }

    return yield* argv.includes("--dry-run")
      ? dryRun(root, credentials, stage)
      : make(root, credentials, stage);
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* bootstrap(args);
    }).pipe(Effect.provide([FetchHttpClient.layer, BunServices.layer]))
  );
}
