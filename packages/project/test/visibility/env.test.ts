import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { Hostname } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { EnvItem } from "@repo/protocol/domain/env";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Territory } from "@repo/protocol/domain/territory";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  EnvKey,
  Handle,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  NotDecider,
  NotSensitive,
  UnknownEnvItem,
  ValueTooShort,
} from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk } from "@repo/testkit/scenarios";
import type { Scenario } from "@repo/testkit/scenarios";
import { EnvSchemaParser } from "@repo/visibility/env-schema";
import type { ParsedEnvSchema } from "@repo/visibility/env-schema";
import { EnvSchemaParserEnvSpec } from "@repo/visibility/env-schema/env-spec";
import { EnvSchemaParserMemory } from "@repo/visibility/env-schema/memory";
import { SealedValue } from "@repo/visibility/vault";
import { WriteOnlyValuesWebCrypto } from "@repo/visibility/vault/webcrypto";
import { Context, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import datekitText from "../../../../examples/datekit/.env.schema?raw";
import { noRunEnv, ProjectEnv } from "../../src/env-port.ts";
import { ProjectStore } from "../../src/project-store.ts";
import { projectService } from "../../src/project.ts";
import type { ProjectApi } from "../../src/project.ts";
import {
  ProjectEnvLive,
  schemaFilesAt,
  widenedProxies,
} from "../../src/visibility/env.ts";
import { CheckScript, mergedAt, Pusher, worldOf } from "../world.ts";

const scenario = aProject({ deciders: ["ines-v"], people: ["bram"] });

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const mainRef = RefName.make("refs/heads/main");

const ines = Person.make({ handle: Handle.make("ines-v") });

const bram = Person.make({ handle: Handle.make("bram") });

const anyone = Anonymous.make({});

const noon = at("2026-10-07T12:00:00Z");

const token = EnvKey.make("SENTRY_AUTH_TOKEN");

const value = "sntrys_eyJpYXQiOjE3M";

const envFile = RepoPath.make(".env.schema");

const datekitParsed: ParsedEnvSchema = {
  header: [
    {
      name: "currentEnv",
      value: {
        fn: "ref",
        named: [],
        positional: ["APP_ENV"],
        text: "ref(APP_ENV)",
      },
    },
    { name: "defaultRequired", value: "infer" },
    { name: "defaultSensitive", value: false },
  ],
  imports: [],
  items: [
    {
      decorators: [
        {
          name: "type",
          value: {
            fn: "enum",
            named: [],
            positional: ["development", "test", "production"],
            text: "enum(development, test, production)",
          },
        },
      ],
      key: "APP_ENV",
      value: "development",
    },
    {
      decorators: [{ name: "type", value: "url" }],
      description: "Error reporting DSN. Public: it ships in builds.",
      key: "SENTRY_DSN",
      value: "https://public@o0.ingest.example.invalid/1",
    },
    {
      decorators: [
        { name: "sensitive", value: true },
        {
          name: "required",
          value: {
            fn: "forEnv",
            named: [],
            positional: ["production"],
            text: "forEnv(production)",
          },
        },
        { name: "tag", value: { named: [], positional: ["release"] } },
        {
          name: "proxy",
          value: {
            named: [
              { key: "domain", value: "sentry.io" },
              { key: "path", value: "/api/**" },
            ],
            positional: [],
          },
        },
      ],
      description:
        "Source-map upload token. Release step only; never enters a check.",
      key: "SENTRY_AUTH_TOKEN",
    },
    {
      decorators: [],
      description: "Where locale data lives.",
      key: "DATEKIT_LOCALE_DIR",
      value: "./locales",
    },
  ],
};

const item = Schema.decodeUnknownSync(EnvItem);

const weekParsed: ParsedEnvSchema = {
  header: [],
  imports: [],
  items: [
    { decorators: [], key: "APP_ENV", value: "test" },
    { decorators: [], key: "WEEK_API_KEY" },
  ],
};

class Parses extends Context.Service<
  Parses,
  { readonly count: Effect.Effect<number> }
>()("test/Parses") {}

const counting = (inner: Layer.Layer<EnvSchemaParser>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const parser = yield* EnvSchemaParser;
      const count = yield* Ref.make(0);

      return Context.make(
        EnvSchemaParser,
        EnvSchemaParser.of({
          parse: (file, text) =>
            Effect.andThen(
              Ref.update(count, (n) => n + 1),
              parser.parse(file, text)
            ),
        })
      ).pipe(Context.add(Parses, { count: Ref.get(count) }));
    })
  ).pipe(Layer.provide(inner));

const sentryAuthToken = item({
  description:
    "Source-map upload token. Release step only; never enters a check.",
  key: "SENTRY_AUTH_TOKEN",
  proxy: { domains: ["sentry.io"], path: "/api/**" },
  required: "depends",
  sensitive: true,
  tags: ["release"],
});

const tokenPlaceholder = "__SENTRY_AUTH_TOKEN_PLACEHOLDER__";

const tokenRunEnv = {
  placeholders: [{ key: token, placeholder: tokenPlaceholder }],
  proxies: [
    {
      block: false,
      host: "sentry.io",
      key: token,
      path: "/api/**",
      placeholder: tokenPlaceholder,
    },
  ],
};

const start = (schema: string): Files => [
  ["package.json", '{ "name": "alice/datekit" }\n'],
  ["src/index.ts", "export const now = () => 0;\n"],
  [".env.schema", schema],
];

const vault = WriteOnlyValuesWebCrypto(
  Redacted.make("0123456789abcdef".repeat(4))
);

const worldWith = <More = never>(
  parser: Layer.Layer<EnvSchemaParser | More>,
  on: Scenario = scenario
) =>
  ProjectEnvLive.pipe(
    Layer.provide(vault),
    Layer.provideMerge(parser),
    Layer.provideMerge(worldOf(on, "memory"))
  );

const world = worldWith(
  EnvSchemaParserMemory(new Map([[envFile, datekitParsed]]))
);

const begun = (schema: string = datekitText, more: Files = []) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* projectService(project);

    yield* api.initProject(ines, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), [...start(schema), ...more], "Start")
    );

    yield* api.recordFirstPush(ines, first);

    return api;
  });

const tokenItem = (api: ProjectApi) =>
  Effect.map(api.envShape(anyone), ({ items }) =>
    items.find(({ key }) => key === token)
  );

const stored = ProjectStore.use((store) => store.load());

describe("the env shape at the landed SHA", () => {
  // Holds the hand-written fake to the real parser's reading, so a drift in either shows here.
  it.effect(
    "is read from datekit's committed .env.schema as the fake holds it",
    () =>
      Effect.gen(function* () {
        const parser = yield* EnvSchemaParser;

        expect(yield* parser.parse(envFile, datekitText)).toStrictEqual(
          datekitParsed
        );
      }).pipe(Effect.provide(EnvSchemaParserEnvSpec))
  );

  it.effect(
    "is empty where no schema can be read, so a maintainer's value is for an unknown item",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();
        const shown = yield* api.envShape(anyone);

        const refused = yield* Effect.flip(
          api.setEnv(ines, { key: token, value: Redacted.make(value) })
        );

        const env = yield* ProjectEnv;

        expect({
          file: shown.file,
          items: shown.items,
          refused,
          run: yield* env.runEnv({ landed: false }, yield* stored),
          stored: (yield* stored).envValues,
        }).toStrictEqual({
          file: envFile,
          items: [],
          refused: new UnknownEnvItem({ key: token }),
          run: noRunEnv,
          stored: [],
        });
      }).pipe(Effect.provide(worldWith(EnvSchemaParserMemory(new Map()))))
  );

  it.effect(
    "lists datekit's four items, the token sensitive behind sentry.io and with no value",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();
        const shown = yield* api.envShape(anyone);

        expect({
          currentEnvKey: shown.currentEnvKey,
          file: shown.file,
          keys: shown.items.map(({ key }) => key),
          token: shown.items.find(({ key }) => key === token),
        }).toStrictEqual({
          currentEnvKey: "APP_ENV",
          file: envFile,
          keys: [
            "APP_ENV",
            "SENTRY_DSN",
            "SENTRY_AUTH_TOKEN",
            "DATEKIT_LOCALE_DIR",
          ],
          token: sentryAuthToken,
        });
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "reads the root's schema first, then each workspace package's, a key declared twice once",
    () =>
      Effect.gen(function* () {
        const api = yield* begun(datekitText, [
          ["packages/week/.env.schema", "APP_ENV=test\nWEEK_API_KEY=\n"],
          ["packages/week/src/week.ts", "export const week = () => 1;\n"],
        ]);

        const shown = yield* api.envShape(anyone);

        expect({
          currentEnvKey: shown.currentEnvKey,
          file: shown.file,
          keys: shown.items.map(({ key }) => key),
          week: shown.items.find(({ key }) => key === "WEEK_API_KEY"),
        }).toStrictEqual({
          currentEnvKey: "APP_ENV",
          file: envFile,
          keys: [
            "APP_ENV",
            "SENTRY_DSN",
            "SENTRY_AUTH_TOKEN",
            "DATEKIT_LOCALE_DIR",
            "WEEK_API_KEY",
          ],
          week: item({
            key: "WEEK_API_KEY",
            required: true,
            sensitive: true,
            tags: [],
          }),
        });
      }).pipe(
        Effect.provide(
          worldWith(
            EnvSchemaParserMemory(
              new Map([
                [envFile, datekitParsed],
                [RepoPath.make("packages/week/.env.schema"), weekParsed],
              ])
            ),
            scenario.pipe(
              withAsk({ id: "week-start", territory: "packages/week" })
            )
          )
        )
      )
  );

  it.effect("parses a commit's schemas once, however often it is read", () =>
    Effect.gen(function* () {
      const api = yield* begun();

      yield* api.envShape(anyone);
      yield* api.setEnv(ines, { key: token, value: Redacted.make(value) });
      yield* api.envShape(anyone);
      yield* api.scanForValues({ text: value });

      expect(yield* Parses.use(({ count }) => count)).toBe(1);
    }).pipe(
      Effect.provide(
        worldWith(
          counting(EnvSchemaParserMemory(new Map([[envFile, datekitParsed]])))
        )
      )
    )
  );
});

describe("a write-only value", () => {
  it.effect(
    "is set by a maintainer, shown as who and when, stored sealed, and recorded in the ledger",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        const set = yield* api.setEnv(ines, {
          key: token,
          value: Redacted.make(value),
        });

        const shown = yield* tokenItem(api);
        const rows = yield* stored;
        const row = rows.envValues.find(({ key }) => key === token);

        const sealed = yield* Schema.decodeUnknownEffect(SealedValue)(
          row?.sealed
        );

        expect({
          ledger: rows.ledger,
          row: { setAt: row?.setAt, setBy: row?.setBy },
          set,
        }).toStrictEqual({
          ledger: [
            LedgerEntry.cases.ValueSet.make({
              at: noon,
              by: Handle.make("ines-v"),
              key: token,
              seq: 1,
            }),
          ],
          row: { setAt: noon, setBy: "ines-v" },
          set: { key: token, setAt: noon, setBy: "ines-v" },
        });
        expect(shown).toStrictEqual({
          ...sentryAuthToken,
          value: { setAt: noon, setBy: "ines-v" },
        });
        expect(
          `${Object.values(sealed).join(" ")} ${JSON.stringify(rows.envValues)}`
        ).not.toContain(value);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "appends the ledger entry as an event, and no event holds the value",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        yield* api.setEnv(ines, { key: token, value: Redacted.make(value) });

        const events = yield* ProjectStore.use((store) =>
          store.eventsSince(0, 100)
        );

        const appended = events.flatMap(({ event }) =>
          ProjectEvent.guards.LedgerAppended(event) ? [event.entry] : []
        );

        expect(appended).toStrictEqual([
          LedgerEntry.cases.ValueSet.make({
            at: noon,
            by: Handle.make("ines-v"),
            key: token,
            seq: 1,
          }),
        ]);
        expect(JSON.stringify(events)).not.toContain(value);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "is refused to a non-maintainer, for an item not sensitive or unknown, and when too short",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        const refused = (
          who: Person,
          key: string,
          text: string,
          acknowledgeShort = false
        ) =>
          Effect.flip(
            api.setEnv(who, {
              acknowledgeShort,
              key: EnvKey.make(key),
              value: Redacted.make(text),
            })
          );

        const got = {
          byBram: yield* refused(bram, "SENTRY_AUTH_TOKEN", value),
          notSensitive: yield* refused(ines, "APP_ENV", value),
          shortAcknowledged: yield* refused(
            ines,
            "SENTRY_AUTH_TOKEN",
            "ab",
            true
          ),
          tooShort: yield* refused(ines, "SENTRY_AUTH_TOKEN", "abcdefgh"),
          unknown: yield* refused(ines, "NOPE", value),
        };

        expect(got).toStrictEqual({
          byBram: new NotDecider({}),
          notSensitive: new NotSensitive({ key: EnvKey.make("APP_ENV") }),
          shortAcknowledged: new ValueTooShort({
            key: token,
            minimum: 3,
            next: `${Brand.cli} env set SENTRY_AUTH_TOKEN`,
          }),
          tooShort: ValueTooShort.of(token, 12),
          unknown: new UnknownEnvItem({ key: EnvKey.make("NOPE") }),
        });

        const acknowledged = yield* api.setEnv(ines, {
          acknowledgeShort: true,
          key: token,
          value: Redacted.make("abcdefgh"),
        });

        expect(acknowledged.setBy).toBe("ines-v");
        expect((yield* stored).envValues.map(({ key }) => key)).toStrictEqual([
          token,
        ]);
      }).pipe(Effect.provide(world))
  );
});

const proxied = (proxy: string) =>
  [
    "# @defaultSensitive=false",
    "# ---",
    "# @type=enum(development, test, production)",
    "APP_ENV=development",
    "",
    "# @sensitive",
    `# @proxy(${proxy})`,
    "SENTRY_AUTH_TOKEN=",
    "",
  ].join("\n");

describe("the env a check of unlanded code runs with", () => {
  it.effect(
    "names a placeholder for every sensitive item and the @proxy items, and holds no value",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        yield* api.setEnv(ines, { key: token, value: Redacted.make(value) });

        const env = yield* ProjectEnv;
        const run = yield* env.runEnv({ landed: false }, yield* stored);

        expect(run).toStrictEqual(tokenRunEnv);
        expect(JSON.stringify(run)).not.toContain(value);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "leaves an empty @proxy path or method off the rule, as the check job's wire takes none",
    () =>
      Effect.gen(function* () {
        yield* begun(proxied('domain="sentry.io", path="", method="POST"'));

        const env = yield* ProjectEnv;

        expect(
          (yield* env.runEnv({ landed: false }, yield* stored)).proxies
        ).toStrictEqual([
          {
            block: false,
            host: "sentry.io",
            key: token,
            method: "POST",
            placeholder: tokenPlaceholder,
          },
        ]);
      }).pipe(Effect.provide(worldWith(EnvSchemaParserEnvSpec)))
  );
});

describe("the env a check of landed code runs with", () => {
  it.effect(
    "carries the stored value, opened, beside the same placeholders and proxies",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        yield* api.setEnv(ines, { key: token, value: Redacted.make(value) });

        const env = yield* ProjectEnv;

        const { values, ...run } = yield* env.runEnv(
          { landed: true },
          yield* stored
        );

        expect({
          run,
          values: values?.map((each) => ({
            key: each.key,
            value: Redacted.value(each.value),
          })),
        }).toStrictEqual({
          run: { ...tokenRunEnv, landed: true },
          values: [{ key: token, value }],
        });
      }).pipe(Effect.provide(world))
  );

  it.effect("carries no value for an item whose value nobody set", () =>
    Effect.gen(function* () {
      yield* begun();

      const env = yield* ProjectEnv;

      expect(yield* env.runEnv({ landed: true }, yield* stored)).toStrictEqual({
        ...tokenRunEnv,
        landed: true,
        values: [],
      });
    }).pipe(Effect.provide(world))
  );
});

describe("the scan for stored values", () => {
  it.effect(
    "finds a stored value in a text or a blob by its item, and never the placeholder",
    () =>
      Effect.gen(function* () {
        const api = yield* begun();

        yield* api.setEnv(ines, { key: token, value: Redacted.make(value) });

        expect({
          blob: yield* api.scanForValues({
            blob: new TextEncoder().encode(`SENTRY_AUTH_TOKEN=${value}\n`),
          }),
          placeholder: yield* api.scanForValues({
            text: "Authorization: Bearer __SENTRY_AUTH_TOKEN_PLACEHOLDER__",
          }),
          text: yield* api.scanForValues({
            text: `uploading with ${value} to sentry.io`,
          }),
        }).toStrictEqual({
          blob: Option.some(token),
          placeholder: Option.none(),
          text: Option.some(token),
        });
      }).pipe(Effect.provide(world))
  );
});

const narrow = proxied('domain="sentry.io"');

const wide = proxied('domain=["sentry.io", "upload.example.invalid"]');

const tipOf = (name: RepoName) =>
  Effect.gen(function* () {
    const refs = yield* (yield* RepoHost).refs(name).pipe(Effect.orDie);

    return LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );
  });

const landSchema = (api: ProjectApi, schema: string, requestId: string) =>
  Effect.gen(function* () {
    const { fork } = yield* api.fork(ines);
    const base = yield* tipOf(fork);
    const main = yield* tipOf(repo);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(fork, Option.some(base), start(schema), "Change the env")
    );

    const merged = yield* mergedAt({ base, fork, head, main, repo });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        [LaneName.make("lint"), LaneName.make("types")],
        (lane) => checker.script(merged, lane, ["passed"]),
        { discard: true }
      )
    );

    yield* api.land(ines, {
      base,
      head,
      message: "Change the env",
      requestId: RequestId.make(requestId),
    });

    return yield* tipOf(repo);
  });

const widenings = (api: ProjectApi) =>
  Effect.map(api.today(ines), ({ decisions }) =>
    decisions.flatMap(({ evidence, subject }) =>
      DecisionSubject.guards.ProxyWidened(subject)
        ? [{ evidence, subject }]
        : []
    )
  );

describe("a landing that widens a @proxy", () => {
  const read = worldWith(EnvSchemaParserEnvSpec);

  it.effect(
    "opens a ProxyWidened decision on Today with the hosts before and after; narrowing opens none",
    () =>
      Effect.gen(function* () {
        const api = yield* begun(narrow);
        const before = yield* tipOf(repo);
        const widened = yield* landSchema(api, wide, "land-wide");
        const afterWidening = yield* widenings(api);

        yield* landSchema(api, narrow, "land-narrow");

        expect(widened).not.toBe(before);
        expect(afterWidening).toStrictEqual([
          {
            evidence: [
              { label: "before", value: "sentry.io" },
              { label: "after", value: "sentry.io, upload.example.invalid" },
            ],
            subject: DecisionSubject.cases.ProxyWidened.make({
              hosts: [
                Hostname.make("sentry.io"),
                Hostname.make("upload.example.invalid"),
              ],
              item: token,
            }),
          },
        ]);
        expect(yield* widenings(api)).toStrictEqual(afterWidening);
      }).pipe(Effect.provide(read))
  );
});

const territory = Schema.decodeUnknownSync(Territory);

describe("where the env schemas live", () => {
  it("is the repo's root, then each workspace package's folder, once each", () => {
    expect(
      schemaFilesAt([
        territory({ module: "week", paths: ["packages/week/**"] }),
        territory({
          module: "format",
          paths: ["packages/format/**", "packages/format/README.md"],
        }),
        territory({ module: "again", paths: ["packages/week/src/**"] }),
      ])
    ).toStrictEqual([
      ".env.schema",
      "packages/week/.env.schema",
      "packages/format/.env.schema",
      "packages/week/src/.env.schema",
    ]);
  });

  it("is the root alone for a single-package repo", () => {
    expect(
      schemaFilesAt([territory({ module: ".", paths: ["**"] })])
    ).toStrictEqual([".env.schema"]);
    expect(schemaFilesAt([])).toStrictEqual([".env.schema"]);
  });
});

const behind = (
  key: string,
  domains: readonly [string, ...string[]],
  block?: boolean
) =>
  item({
    key,
    proxy: block === undefined ? { domains } : { block, domains },
    required: true,
    sensitive: true,
    tags: [],
  });

describe("a widened proxy", () => {
  it("is an item whose value may reach a host it could not before, with every host it may reach", () => {
    expect(
      widenedProxies(
        { items: [behind("SENTRY_AUTH_TOKEN", ["sentry.io"])] },
        {
          items: [
            behind("SENTRY_AUTH_TOKEN", [
              "sentry.io",
              "upload.example.invalid",
            ]),
            behind("NPM_TOKEN", ["registry.npmjs.org"]),
          ],
        }
      )
    ).toStrictEqual([
      {
        hosts: ["sentry.io", "upload.example.invalid"],
        item: "SENTRY_AUTH_TOKEN",
      },
      { hosts: ["registry.npmjs.org"], item: "NPM_TOKEN" },
    ]);
  });

  it("is an unblocked rule that was blocked", () => {
    expect(
      widenedProxies(
        { items: [behind("SENTRY_AUTH_TOKEN", ["sentry.io"], true)] },
        { items: [behind("SENTRY_AUTH_TOKEN", ["sentry.io"])] }
      )
    ).toStrictEqual([{ hosts: ["sentry.io"], item: "SENTRY_AUTH_TOKEN" }]);
  });

  it("is never a narrowing, an unchanged rule, a newly blocked one, or a dropped item", () => {
    const both = behind("SENTRY_AUTH_TOKEN", [
      "sentry.io",
      "upload.example.invalid",
    ]);

    expect([
      widenedProxies(
        { items: [both] },
        { items: [behind("SENTRY_AUTH_TOKEN", ["sentry.io"])] }
      ),
      widenedProxies({ items: [both] }, { items: [both] }),
      widenedProxies(
        { items: [both] },
        {
          items: [
            behind(
              "SENTRY_AUTH_TOKEN",
              ["sentry.io", "upload.example.invalid", "evil.example"],
              true
            ),
          ],
        }
      ),
      widenedProxies({ items: [both] }, { items: [] }),
    ]).toStrictEqual([[], [], [], []]);
  });
});
