import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Result, Schema } from "effect";

import {
  bucketsFrom,
  checkTriggers,
  d1From,
  kvFrom,
  missingSecrets,
  plan,
  secretNames,
  Step,
  TriggerMismatch,
  TriggersResponse,
  writeIds,
} from "../../../infra/bootstrap.ts";
import type { Existing } from "../../../infra/bootstrap.ts";
import { schemaItems } from "../../../infra/env-schema.ts";
import { blankJsonc } from "../../../infra/jsonc.ts";
import { resources, stages } from "../../../infra/stages.ts";
import { repoRoot } from "./root.ts";

/** A file under the repo root, as text. */
const rootText = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(path.join(yield* repoRoot, file));
  }).pipe(Effect.provide(NodeServices.layer));

/** What this test reads of a stage's block in the platform's `wrangler.jsonc`. */
const PlatformStage = Schema.Struct({
  artifacts: Schema.Tuple([Schema.Struct({ namespace: Schema.String })]),
  d1_databases: Schema.Tuple([
    Schema.Struct({ binding: Schema.String, database_name: Schema.String }),
  ]),
  r2_buckets: Schema.Tuple([Schema.Struct({ bucket_name: Schema.String })]),
  services: Schema.Tuple([Schema.Struct({ service: Schema.String })]),
  triggers: Schema.Struct({
    events: Schema.Tuple([
      Schema.Struct({
        filter: Schema.Struct({ namespace: Schema.String }),
        targets: Schema.Tuple([
          Schema.Struct({ workflow_name: Schema.String }),
        ]),
      }),
    ]),
  }),
  vars: Schema.Struct({ STAGE: Schema.String }),
  workflows: Schema.Array(
    Schema.Struct({ binding: Schema.String, name: Schema.String })
  ),
});

const Wrangler = <S extends Schema.Top>(stage: S) =>
  Schema.fromJsonString(
    Schema.Struct({
      env: Schema.Record(Schema.String, stage),
      name: Schema.String,
    })
  );

/** `apps/<app>/wrangler.jsonc`, comments and trailing commas aside, decoded. */
const wrangler = <S extends Schema.Top & { readonly DecodingServices: never }>(
  app: string,
  stage: S
) =>
  rootText(`apps/${app}/wrangler.jsonc`).pipe(
    Effect.map(blankJsonc),
    Effect.flatMap(Schema.decodeUnknownEffect(Wrangler(stage)))
  );

const nothing: Existing = { d1: [], kv: [], namespaces: [], r2: [] };

/** Every resource of `dev-oscabriel` and `demo` present, with ids. */
const everything: Existing = {
  d1: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "front-page-dev-oscabriel",
    },
    { id: "22222222-2222-4222-8222-222222222222", name: "front-page-demo" },
  ],
  kv: [
    { id: "33333333333333333333333333333333", title: "oauth-dev-oscabriel" },
    { id: "44444444444444444444444444444444", title: "oauth-demo" },
  ],
  namespaces: ["projects-dev-oscabriel", "projects-demo"],
  r2: ["evidence-dev-oscabriel", "evidence-demo"],
};

describe("the stage table", () => {
  it.effect(
    "names every stage the platform's wrangler.jsonc declares, and each resource its block uses",
    () =>
      Effect.gen(function* () {
        const platform = yield* wrangler("platform", PlatformStage);

        expect(platform.name).toBe("platform");
        expect(Object.keys(platform.env)).toStrictEqual([...stages]);

        // Each block as the table names it, and as wrangler.jsonc does.
        const named = stages.map((stage) => {
          const names = resources(stage);

          return {
            frontPage: names.frontPage,
            onPush: [names.onPush, names.onPush],
            platform: names.platform,
            projects: [names.projects, names.projects],
            sandbox: names.sandbox,
            stage,
            workflows: [names.answer, names.onPush],
          };
        });

        const declared = stages.map((stage) => {
          const block = platform.env[stage];

          return {
            frontPage: block?.d1_databases[0].database_name,
            onPush: [
              block?.triggers.events[0].targets[0].workflow_name,
              block?.workflows.find(({ binding }) => binding === "ON_PUSH")
                ?.name,
            ],
            // Wrangler names a stage's Worker `<name>-<env>`.
            platform: `${platform.name}-${stage}`,
            projects: [
              block?.artifacts[0].namespace,
              block?.triggers.events[0].filter.namespace,
            ],
            sandbox: block?.services[0].service,
            stage: block?.vars.STAGE,
            workflows: block?.workflows.map(({ name }) => name),
          };
        });

        expect(declared).toStrictEqual(named);
        expect(
          stages.map((stage) => platform.env[stage]?.r2_buckets[0].bucket_name)
        ).toStrictEqual(stages.map((stage) => resources(stage).evidence));
      })
  );

  it.effect("names every stage the sandbox's wrangler.jsonc declares", () =>
    Effect.gen(function* () {
      const sandbox = yield* wrangler("sandbox", Schema.Unknown);

      expect(sandbox.name).toBe("sandbox");
      expect(Object.keys(sandbox.env)).toStrictEqual([...stages]);
    })
  );
});

describe("the bootstrap plan", () => {
  it("creates every resource of a stage that has none", () => {
    expect(plan("dev-oscabriel", nothing)).toStrictEqual([
      Step.CreateNamespace({ name: "projects-dev-oscabriel" }),
      Step.CreateD1({ name: "front-page-dev-oscabriel" }),
      Step.CreateKv({ title: "oauth-dev-oscabriel" }),
      Step.CreateR2({ name: "evidence-dev-oscabriel" }),
    ]);
  });

  it("creates nothing on a second run", () => {
    expect(plan("dev-oscabriel", everything)).toStrictEqual([]);
    expect(plan("demo", everything)).toStrictEqual([]);
  });

  it("creates only what is missing, and never counts another stage's", () => {
    const demoOnly: Existing = {
      d1: [
        { id: "22222222-2222-4222-8222-222222222222", name: "front-page-demo" },
      ],
      kv: [
        {
          id: "33333333333333333333333333333333",
          title: "oauth-dev-oscabriel",
        },
      ],
      namespaces: ["projects-demo"],
      r2: ["evidence-dev-oscabriel"],
    };

    expect(plan("dev-oscabriel", demoOnly)).toStrictEqual([
      Step.CreateNamespace({ name: "projects-dev-oscabriel" }),
      Step.CreateD1({ name: "front-page-dev-oscabriel" }),
    ]);
  });
});

/** The lines of `after` that differ from `before`'s, by line. */
const changed = (before: string, after: string) => {
  const old = before.split("\n");

  return after
    .split("\n")
    .flatMap((line, index) =>
      line === old[index] ? [] : [`${index + 1}: ${line.trim()}`]
    );
};

describe("writing ids into wrangler.jsonc", () => {
  const ids = {
    frontPage: "11111111-1111-4111-8111-111111111111",
    oauth: "33333333333333333333333333333333",
  };

  it.effect(
    "rewrites only the stage's D1 and KV ids, keeping every other line and comment",
    () =>
      Effect.gen(function* () {
        const text = yield* rootText("apps/platform/wrangler.jsonc");
        const lines = text.split("\n");
        const written = writeIds(text, "dev-oscabriel", ids);

        const devBlock = lines.findIndex((line) =>
          line.includes('"dev-oscabriel": {')
        );

        const demoBlock = lines.findIndex((line) => line.includes('"demo": {'));

        const lineOf = (needle: string) =>
          lines.findIndex(
            (line, index) =>
              index > devBlock && index < demoBlock && line.includes(needle)
          ) + 1;

        expect(written.split("\n")).toHaveLength(lines.length);
        expect(changed(text, written)).toStrictEqual([
          `${lineOf('"database_id"')}: "database_id": "${ids.frontPage}",`,
          `${lineOf('"OAUTH_KV"')}: { "binding": "OAUTH_KV", "id": "${ids.oauth}" },`,
        ]);
      })
  );

  it.effect("changes nothing when the ids are already written", () =>
    Effect.gen(function* () {
      const text = yield* rootText("apps/platform/wrangler.jsonc");
      const written = writeIds(text, "demo", ids);

      expect(writeIds(written, "demo", ids)).toBe(written);
      expect(writeIds(text, "demo", {})).toBe(text);
    })
  );

  it.effect("writes only the id it is given", () =>
    Effect.gen(function* () {
      const text = yield* rootText("apps/platform/wrangler.jsonc");

      const written = writeIds(text, "demo", { oauth: ids.oauth });

      expect(changed(text, written)).toHaveLength(1);
      expect(written).toContain(`"id": "${ids.oauth}"`);
    })
  );

  it("keeps a comment that sits inside the stage's binding", () => {
    const text = [
      "{",
      '  "env": {',
      '    "demo": {',
      "      // the KV namespace `oauth-demo`, {braces} and all",
      '      "kv_namespaces": [{ "binding": "OAUTH_KV", /* new */ "id": "0", },],',
      "    },",
      "  },",
      "}",
    ].join("\n");

    expect(writeIds(text, "demo", { oauth: "abc" })).toBe(
      text.replace('"id": "0"', '"id": "abc"')
    );
  });
});

describe("the push-event trigger, read back", () => {
  const fixture = rootText("infra/fixtures/triggers.json").pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(TriggersResponse))
    )
  );

  it.effect(
    "accepts S1's shape, whose targets carry script_name, for its stage",
    () =>
      Effect.gen(function* () {
        const live = yield* fixture;

        expect(
          Result.isSuccess(checkTriggers("dev-oscabriel", live))
        ).toBeTruthy();
      })
  );

  it.effect("refuses a stage whose trigger is missing", () =>
    Effect.gen(function* () {
      const live = yield* fixture;

      const without = {
        ...live,
        result: {
          ...live.result,
          triggers: live.result.triggers.filter(
            ({ filter }) => filter.namespace !== "projects-dev-oscabriel"
          ),
        },
      };

      expect(checkTriggers("dev-oscabriel", without)).toStrictEqual(
        Result.fail(
          new TriggerMismatch({
            found: [
              "cf.artifacts.repo.forked on layers-dev-oscabriel → platform-dev-oscabriel/on-push-dev-oscabriel",
              "cf.artifacts.repo.pushed on layers-dev-oscabriel → platform-dev-oscabriel/on-push-dev-oscabriel",
            ],
            namespace: "projects-dev-oscabriel",
            script: "platform-dev-oscabriel",
            workflow: "on-push-dev-oscabriel",
          })
        )
      );
    })
  );

  it.effect("refuses another stage's triggers", () =>
    Effect.gen(function* () {
      const live = yield* fixture;

      expect(Result.isFailure(checkTriggers("demo", live))).toBeTruthy();
    })
  );

  it("refuses a target without script_name when it decodes", () => {
    const asConfigured = {
      result: {
        script_name: "platform-dev-oscabriel",
        triggers: [
          {
            filter: { namespace: "projects-dev-oscabriel" },
            targets: [
              { type: "workflow", workflow_name: "on-push-dev-oscabriel" },
            ],
            type: "cf.artifacts.repo.pushed",
          },
        ],
      },
      success: true,
    };

    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(TriggersResponse)(asConfigured)
      )
    ).toBeTruthy();
  });
});

describe("what bootstrap reads from Wrangler", () => {
  it.effect("reads D1 databases from `d1 list --json`", () =>
    Effect.gen(function* () {
      expect(
        yield* d1From(
          JSON.stringify([
            {
              created_at: "2026-10-07T00:00:00.000Z",
              name: "front-page-dev-oscabriel",
              uuid: "11111111-1111-4111-8111-111111111111",
            },
          ])
        )
      ).toStrictEqual([
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "front-page-dev-oscabriel",
        },
      ]);
    })
  );

  it.effect(
    "reads KV namespaces from `kv namespace list`, past a warning line",
    () =>
      Effect.gen(function* () {
        expect(
          yield* kvFrom(
            [
              "▲ [WARNING] a newer wrangler is out",
              JSON.stringify([
                {
                  id: "33333333333333333333333333333333",
                  supports_url_encoding: true,
                  title: "oauth-dev-oscabriel",
                },
              ]),
            ].join("\n")
          )
        ).toStrictEqual([
          {
            id: "33333333333333333333333333333333",
            title: "oauth-dev-oscabriel",
          },
        ]);
      })
  );

  it("reads bucket names from `r2 bucket list`'s labelled output", () => {
    const output = [
      " ⛅️ wrangler 4.147.0",
      "───────────────────",
      "Listing buckets...",
      "name:           evidence-dev-oscabriel",
      "creation_date:  2026-10-07T00:00:00.000Z",
      "",
      "name:           witness",
      "creation_date:  2026-09-01T00:00:00.000Z",
    ].join("\n");

    expect(bucketsFrom(output)).toStrictEqual([
      "evidence-dev-oscabriel",
      "witness",
    ]);
  });
});

describe("secrets, by name only", () => {
  it.effect("takes the required names from the platform's .env.schema", () =>
    Effect.gen(function* () {
      const schema = yield* rootText("apps/platform/.env.schema");

      expect(schemaItems(schema)).toStrictEqual([
        { name: "OPERATOR_TOKEN", required: true },
        { name: "SESSION_TOKENS", required: false },
        { name: "GITHUB_CLIENT_ID", required: false },
        { name: "GITHUB_CLIENT_SECRET", required: false },
        { name: "COOKIE_KEY", required: false },
      ]);
    })
  );

  it("infers a required item from a value when the header says infer", () => {
    const schema = [
      "# @defaultRequired=infer",
      "# ---",
      "",
      "# @sensitive",
      "TOKEN=",
      "",
      "LEVEL=info",
      "",
      "# @required=forEnv(production)",
      "LATER=",
    ].join("\n");

    expect(schemaItems(schema)).toStrictEqual([
      { name: "TOKEN", required: false },
      { name: "LEVEL", required: true },
      { name: "LATER", required: false },
    ]);
  });

  it.effect("reads only names from `secret list`", () =>
    Effect.gen(function* () {
      expect(
        yield* secretNames(
          JSON.stringify([{ name: "OPERATOR_TOKEN", type: "secret_text" }])
        )
      ).toStrictEqual(["OPERATOR_TOKEN"]);
    })
  );

  it("names the required secrets a deployed Worker lacks", () => {
    const items = [
      { name: "OPERATOR_TOKEN", required: true },
      { name: "SESSION_TOKENS", required: false },
    ];

    expect(missingSecrets(items, ["SESSION_TOKENS"])).toStrictEqual([
      "OPERATOR_TOKEN",
    ]);
    expect(missingSecrets(items, ["OPERATOR_TOKEN"])).toStrictEqual([]);
  });
});
