import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts, EnvSchemaOf } from "@repo/protocol/contracts";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Ledger, LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  LayerName,
  SuiteRoot,
} from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";

import { keys } from "../src/client/keys.ts";
import { ledgerAtom } from "../src/client/ledger.ts";
import { areaSummaries } from "../src/features/ledger/areas.ts";
import { ProjectView } from "../src/features/project/project-page.tsx";
import { VisibilityView } from "../src/features/visibility/visibility-page.tsx";
import {
  readVisibility,
  VisibilityPageData,
} from "../src/routes/$owner/$project/visibility.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";
import { inOrder, markupOf, plainText, textOf } from "./ask-fixtures.ts";
import { fixturesClient } from "./dev-client.ts";
import { textIn } from "./markup.ts";
import { elementWith, factsOf, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const root = SuiteRoot.make(`sha256:3f9a${"0b1c".repeat(15)}`);

const earlierRoot = SuiteRoot.make(`sha256:${"9e8d".repeat(16)}`);

const exportArea = AreaName.make("export");

const maintainers = LayerName.make("maintainers");

const decodeLedger = Schema.decodeSync(Ledger);

const datekitRead = decodeLedger({
  entries: [],
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks", "agent-config", "notes"],
      name: "maintainers",
      readers: "deciders",
      reason:
        "Held-back checks judge an answer by the ask's words, not by tests it could read.",
      repo: "datekit--maintainers",
      writers: "deciders",
    },
  ],
  posture: "openWithSealedEvidence",
  postureLabel: "Open with sealed evidence",
  project: "datekit",
});

const entries: readonly LedgerEntry[] = [
  LedgerEntry.cases.LayerDeclared.make({
    at: DateTime.makeUnsafe("2026-10-09T10:00:00.000Z"),
    disclose: "sealed",
    kinds: ["checks", "agent-config", "notes"],
    layer: maintainers,
    seq: 1,
  }),
  LedgerEntry.cases.PostureChanged.make({
    at: DateTime.makeUnsafe("2026-10-09T10:05:00.000Z"),
    decision: DecisionId.make("dec-000003"),
    from: "open",
    seq: 2,
    to: "openWithSealedEvidence",
  }),
  LedgerEntry.cases.CountChanged.make({
    area: exportArea,
    at: DateTime.makeUnsafe("2026-10-10T09:00:00.000Z"),
    count: 5,
    layer: maintainers,
    seq: 3,
  }),
  LedgerEntry.cases.CommitmentPublished.make({
    area: exportArea,
    at: DateTime.makeUnsafe("2026-10-10T09:00:00.000Z"),
    authors: 2,
    checks: 5,
    seq: 4,
    suite: earlierRoot,
  }),
  LedgerEntry.cases.Admitted.make({
    area: exportArea,
    at: DateTime.makeUnsafe("2026-10-11T08:00:00.000Z"),
    knownBadCaught: 2,
    mainRuns: 3,
    seq: 5,
    suite: root,
  }),
  LedgerEntry.cases.CommitmentPublished.make({
    area: exportArea,
    at: DateTime.makeUnsafe("2026-10-11T08:00:00.000Z"),
    authors: 3,
    checks: 7,
    seq: 6,
    suite: root,
  }),
  LedgerEntry.cases.ValueSet.make({
    at: DateTime.makeUnsafe("2026-10-11T09:30:00.000Z"),
    by: Handle.make("ines-v"),
    key: EnvKey.make("SENTRY_AUTH_TOKEN"),
    seq: 7,
  }),
  LedgerEntry.cases.Released.make({
    at: DateTime.makeUnsafe("2026-10-12T08:00:00.000Z"),
    by: Handle.make("okonkwo"),
    landing: LandedSha.make("9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"),
    layer: maintainers,
    paths: 2,
    seq: 8,
  }),
];

const parserArea = AreaName.make("parser");

const parserRoot = SuiteRoot.make(`sha256:7fbe4b${"2c3d".repeat(14)}a1`);

const parserCommitment = LedgerEntry.cases.CommitmentPublished.make({
  area: parserArea,
  at: DateTime.makeUnsafe("2026-10-12T08:00:00.000Z"),
  authors: 3,
  checks: 4,
  seq: 9,
  suite: parserRoot,
});

const datekit: Ledger = {
  ...datekitRead,
  entries: [...entries, parserCommitment],
};

const open = decodeLedger({
  entries: [],
  layers: [],
  posture: "open",
  postureLabel: "Open",
  project: "burrow",
});

const datekitEnv = Schema.decodeSync(EnvSchemaView)({
  at: "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c",
  file: ".env.schema",
  imports: [],
  items: [
    {
      key: "APP_ENV",
      required: true,
      sensitive: false,
      tags: [],
      type: "enum(development, test, production)",
    },
    {
      key: "SENTRY_AUTH_TOKEN",
      placeholder: "placeholder-sentry-auth-token",
      required: "depends",
      sensitive: true,
      tags: ["release"],
      value: { setAt: "2026-10-10T09:30:00.000Z", setBy: "ines-v" },
    },
  ],
  project: "datekit",
});

/** The tab as a ledger test reads it: the environment unread, as before a first landing. */
const tabWith = (ledger: Ledger, at: DateTime.Utc = now) => (
  <VisibilityView env={undefined} ledger={ledger} now={at} />
);

const page = tabWith(datekit);

const seqsOf = (markup: string) =>
  [...markup.matchAll(/data-seq="(?<seq>\d+)"/gu)].map((found) =>
    Number(found.groups?.seq)
  );

const whenOf = (markup: string, marker: string) =>
  /<time\b[^>]*>(?<when>[^<]*)<\/time>/u.exec(
    markup.slice(markup.indexOf(marker))
  )?.groups?.when;

const historyRowsOf = (markup: string) =>
  [
    ...mainOf(markup).matchAll(/<li\b[^>]*data-entry="[^"]*"[\s\S]*?<\/li>/gu),
  ].map(([row]) => row);

const wordsOf = (markup: string) =>
  historyRowsOf(markup).map((row) =>
    plainText(elementWith(row, "data-entry-word")).trim()
  );

const toneOf = (row: string) =>
  /text-sealed/u.test(elementWith(row, "data-entry-word")) ? "sealed" : "ink";

describe("a project's ledger", () => {
  it("is titled Visibility, its status line saying the posture and every sealed area in one sentence, and its history titled Ledger", () => {
    const markup = markupOf(page);

    expect(markup).toMatch(/<h1\b[^>]*>Visibility<\/h1>/u);
    expect(markup).toMatch(/<h2\b[^>]*id="ledger"[^>]*>Ledger<\/h2>/u);
    expect(textIn(elementWith(markup, "data-ledger-head")).trim()).toBe(
      "Open with sealed evidence. export: 7 sealed checks by 3 people; parser: 4 sealed checks by 3 people."
    );
  });

  it("leads with the posture alone when the platform's label names the areas the sentence counts", () => {
    const named: Ledger = {
      ...datekit,
      postureLabel:
        "Open with sealed evidence · sealed checks in export, parser",
    };

    const markup = markupOf(tabWith(named));

    expect(textIn(elementWith(markup, "data-ledger-head")).trim()).toBe(
      "Open with sealed evidence. export: 7 sealed checks by 3 people; parser: 4 sealed checks by 3 people."
    );
    // The label itself is the platform's, whole, on the lead word.
    expect(elementWith(markup, "data-posture=")).toContain(
      'title="Open with sealed evidence · sealed checks in export, parser"'
    );
  });

  it("leads with any other label whole", () => {
    const core: Ledger = {
      ...datekit,
      posture: "openCore",
      postureLabel: "Open core · closed: maintainers",
    };

    expect(
      textIn(elementWith(markupOf(tabWith(core)), "data-ledger-head")).trim()
    ).toBe(
      "Open core · closed: maintainers. export: 7 sealed checks by 3 people; parser: 4 sealed checks by 3 people."
    );
  });

  it("shows the posture label the platform computed", () => {
    const markup = markupOf(page);

    expect(markup).toContain('data-posture="openWithSealedEvidence"');
    expect(textOf(page)).toContain("Open with sealed evidence");
  });

  it("shows each declared layer, its name in mono, with its audience, kinds, disclosure, reason, readers and writers", () => {
    const markup = mainOf(markupOf(page));

    const layer = markup.slice(
      markup.indexOf('data-layer="maintainers"'),
      markup.indexOf('id="held-back"')
    );

    expect(elementWith(layer, "data-layer-name")).toMatch(
      /class="[^"]*font-mono[^"]*text-sealed|class="[^"]*text-sealed[^"]*font-mono/u
    );
    expect(
      inOrder(plainText(layer), [
        "maintainers",
        "Audience",
        "maintainers",
        "Holds",
        "checks, agent-config, notes",
        "Disclosure",
        "sealed",
        "Reason",
        "Held-back checks judge an answer by the ask's words, not by tests it could read.",
        "Readers",
        "the maintainers",
        "Writers",
        "the maintainers",
      ])
    ).toBeTruthy();
  });

  it("titles each sealed area in sealed violet, its root shortened and whole in its title, with its admission and last change", () => {
    const markup = mainOf(markupOf(page));

    const area = markup.slice(
      markup.indexOf('data-area="export"'),
      markup.indexOf('data-area="parser"')
    );

    expect(elementWith(area, "data-area-title")).toMatch(/text-sealed/u);
    expect(
      inOrder(plainText(area), [
        "export: 7 sealed checks by 3 people",
        "Root",
        "sha256:3f9a0b…",
        "Admission",
        "admitted Oct 11; passes main 3/3; catches 2 known-bad",
        "Last changed",
        "1 d ago",
      ])
    ).toBeTruthy();
    expect(area).toContain(`title="${root}"`);
    expect(markup).toContain(`title="${parserRoot}"`);
  });

  it("lists the history newest first, one line each, each with its typed word", () => {
    const markup = markupOf(page);
    const rows = historyRowsOf(markup);

    expect(seqsOf(mainOf(markup))).toStrictEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(wordsOf(markup)).toStrictEqual([
      "Commitment changed",
      "Released",
      "Value set",
      "Commitment changed",
      "Admitted",
      "Commitment changed",
      "Count changed",
      "Posture changed",
      "Layer added",
    ]);

    for (const row of rows) {
      // One line: inline parts, never a paragraph or a block under another.
      expect(row.slice(row.indexOf(">") + 1)).not.toMatch(
        /<(?:p|div|br|ul|ol)\b/u
      );
    }
  });

  it("draws the sealed kinds' words in sealed violet, and the rest in ink", () => {
    const rows = historyRowsOf(markupOf(page));

    expect(rows.map(toneOf)).toStrictEqual([
      "sealed",
      "ink",
      "sealed",
      "sealed",
      "sealed",
      "sealed",
      "sealed",
      "ink",
      "ink",
    ]);
  });

  it("says each entry in the ledger's words, a root shortened and whole in its title", () => {
    const markup = markupOf(page);
    const text = plainText(mainOf(markup));
    const admitted = historyRowsOf(markup)[4] ?? "";

    expect(inOrder(text, ["ines-v", "set", "SENTRY_AUTH_TOKEN"])).toBeTruthy();
    expect(
      inOrder(text, ["okonkwo", "released 2 paths", "9b1c3e5"])
    ).toBeTruthy();
    expect(
      inOrder(text, ["Posture changed", "Open", "Open with sealed evidence"])
    ).toBeTruthy();
    expect(plainText(admitted)).toContain("sha256:3f9a0b…");
    expect(admitted).toContain(`title="${root}"`);
  });

  it("adds no path, check name or file name to what the ledger says", () => {
    const markup = markupOf(page);

    for (const leak of [
      "held-back/",
      "layers/",
      ".test.ts",
      ".ts<",
      "/export/",
    ]) {
      expect(markup).not.toContain(leak);
    }
  });

  it("never shows an entry as recorded in the future, though it arrived after the page was read", () => {
    // Served at 07:00; the release at 08:00 arrived while the page stayed open.
    const markup = mainOf(
      markupOf(tabWith(datekit, DateTime.makeUnsafe("2026-10-12T07:00:00Z")))
    );

    expect(whenOf(markup, 'data-seq="8"')).toBe("now");
    expect(whenOf(markup, 'data-seq="7"')).toBe("22 h ago");
    expect(markup).not.toMatch(/>in \d+ (?:min|h|d)</u);
  });

  it("puts what is held back, the CLI line and what each disclosure means in its facts, and says the posture in its status line, not again there", () => {
    const markup = markupOf(page);
    const facts = factsOf(markup);
    const text = plainText(facts);

    expect(elementWith(markup, "data-ledger-head")).toContain(
      'data-posture="openWithSealedEvidence"'
    );
    expect(facts).not.toContain("data-posture");
    expect(
      inOrder(text, [
        "Held back",
        "export",
        "7 sealed checks",
        "parser",
        "4 sealed checks",
        `${Brand.cli} ledger --project oscabriel/datekit`,
        "sealed: counts, authors and a salted root",
        "write-only: names, and who set each value and when",
      ])
    ).toBeTruthy();
    // The command is the text of the one code element a tap selects whole.
    expect(
      plainText(
        /<code\b[^>]*select-all[^>]*>.*?<\/code>/u.exec(facts)?.[0] ?? ""
      )
    ).toContain("ledger --project oscabriel/datekit");
  });

  it("shows a project without layers as Open, with nothing held back", () => {
    const view = tabWith(open);
    const markup = markupOf(view);

    expect(markup).toMatch(/data-posture="open"[^>]*>Open</u);
    expect(textIn(elementWith(markup, "data-ledger-head")).trim()).toBe(
      "Open. Nothing is held back."
    );
    expect(textOf(view)).toContain("Nothing is held back");
    expect(textOf(view)).not.toContain("sealed checks by");
  });

  it.effect("sits under the project's crumbs: datekit, then Visibility", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/oscabriel/datekit/visibility", page);
      const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

      expect(crumbs).toMatch(
        /<a\b[^>]*href="\/oscabriel\/datekit"[^>]*>oscabriel\/datekit<\/a>/u
      );
      expect(plainText(crumbs)).toContain("Visibility");
    })
  );
});

describe(areaSummaries, () => {
  it("folds each area's latest count, authors, root and the admission of that root", () => {
    expect(areaSummaries(datekit)).toStrictEqual([
      {
        admission: Option.some({
          at: DateTime.makeUnsafe("2026-10-11T08:00:00.000Z"),
          knownBadCaught: 2,
          mainRuns: 3,
        }),
        area: exportArea,
        authors: Option.some(3),
        changedAt: DateTime.makeUnsafe("2026-10-11T08:00:00.000Z"),
        checks: 7,
        root: Option.some(root),
      },
      {
        admission: Option.none(),
        area: parserArea,
        authors: Option.some(3),
        changedAt: DateTime.makeUnsafe("2026-10-12T08:00:00.000Z"),
        checks: 4,
        root: Option.some(parserRoot),
      },
    ]);
  });

  it("folds by sequence number, whatever order the entries arrive in", () => {
    const shuffled = { ...datekit, entries: datekit.entries.toReversed() };

    expect(areaSummaries(shuffled)).toStrictEqual(areaSummaries(datekit));
  });

  it("keeps no admission for a root that joined without one", () => {
    const later: Ledger = {
      ...datekit,
      entries: [
        ...datekit.entries,
        LedgerEntry.cases.CommitmentPublished.make({
          area: exportArea,
          at: DateTime.makeUnsafe("2026-10-12T09:00:00.000Z"),
          authors: 3,
          checks: 8,
          seq: 10,
          suite: earlierRoot,
        }),
      ],
    };

    const [summary] = areaSummaries(later);

    expect(summary?.checks).toBe(8);
    expect(summary?.root).toStrictEqual(Option.some(earlierRoot));
    expect(summary?.admission).toStrictEqual(Option.none());
  });

  it("has no area for a ledger with no sealed entries", () => {
    expect(areaSummaries(open)).toStrictEqual([]);
  });
});

interface Asked {
  readonly ledgers: number;
  readonly schemas: number;
}

const nothingAsked: Asked = { ledgers: 0, schemas: 0 };

// The env's schema is read from the landed main; before a first landing the platform answers `UnknownProject`.
const platformHandlers = (asked: Ref.Ref<Asked>, { landed = true } = {}) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("ledger", ({ project }) =>
      Effect.gen(function* () {
        yield* Ref.update(asked, (seen) => ({
          ...seen,
          ledgers: seen.ledgers + 1,
        }));

        if (project !== datekit.project) {
          return yield* new UnknownProject({ project });
        }

        return datekit;
      })
    ),
    Contracts.toLayerHandler(EnvSchemaOf._tag, ({ project }) =>
      Effect.gen(function* () {
        yield* Ref.update(asked, (seen) => ({
          ...seen,
          schemas: seen.schemas + 1,
        }));

        if (!landed || project !== datekit.project) {
          return yield* new UnknownProject({ project });
        }

        return datekitEnv;
      })
    ),
    asTester
  );

const platformOf = (asked: Ref.Ref<Asked>, where = {}) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide(platformHandlers(asked, where))
  );

describe(readVisibility, () => {
  it.effect(
    "reads the project's ledger, entries and all, and its environment, each once",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readVisibility("datekit").pipe(
          Effect.provide(platformOf(asked))
        );

        expect(read.ledger.postureLabel).toBe("Open with sealed evidence");
        expect(read.ledger.entries.map(({ seq }) => seq)).toStrictEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]);
        expect(read.env?.items.map(({ key }) => key)).toStrictEqual([
          "APP_ENV",
          "SENTRY_AUTH_TOKEN",
        ]);
        expect(yield* Ref.get(asked)).toStrictEqual({ ledgers: 1, schemas: 1 });
      })
  );

  it.effect(
    "reads no environment, and no 404, for a project whose main has not landed",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readVisibility("datekit").pipe(
          Effect.provide(platformOf(asked, { landed: false }))
        );

        expect(read.ledger.project).toBe("oscabriel/datekit");
        expect(read.env).toBeUndefined();
      })
  );

  it.effect("is a not-found for a project the platform does not know", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);

      const failed = yield* Effect.flip(
        readVisibility("oscabriel/no-such-project").pipe(
          Effect.provide(platformOf(asked))
        )
      );

      expect(isNotFound(failed)).toBeTruthy();
      expect((yield* Ref.get(asked)).ledgers).toBe(1);
    })
  );

  it.effect(
    "is a not-found, asking nothing, for an address that names no project",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const failed = yield* Effect.flip(
          readVisibility("Not_A-Project").pipe(
            Effect.provide(platformOf(asked))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(yield* Ref.get(asked)).toStrictEqual(nothingAsked);
      })
  );
});

const runUntil = (done: Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(
    Effect.andThen(done),
    Effect.repeat({ times: 200, until: (held) => held })
  );

describe(ledgerAtom, () => {
  it.effect(
    "reads the ledger again when the project's keys change, as the watch's poll changes them",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        // One browser tab whose `ContractsClient` reaches the stub platform in process.
        const registry = yield* Effect.acquireRelease(
          Effect.sync(() =>
            AtomRegistry.make({
              initialValues: [
                Atom.initialValue(
                  ContractsClient.runtime.layer,
                  Layer.effect(
                    ContractsClient,
                    RpcTest.makeClient(webContracts, { flatten: true })
                  ).pipe(
                    Layer.provide(platformHandlers(asked)),
                    Layer.provideMerge(Reactivity.layer)
                  )
                ),
              ],
            })
          ),
          (made) =>
            Effect.sync(() => {
              made.dispose();
            })
        );

        const atom = ledgerAtom(datekit.project);

        registry.mount(atom);
        yield* AtomRegistry.getResult(registry, atom, {
          suspendOnWaiting: true,
        });

        // What the watch's poll does every POLL_MS: the project's keys changed.
        yield* AtomRegistry.getResult(
          registry,
          ContractsClient.runtime.atom(
            Reactivity.invalidate(keys.project(datekit.project))
          ),
          { suspendOnWaiting: true }
        );

        expect(
          yield* runUntil(
            Ref.get(asked).pipe(Effect.map((seen) => seen.ledgers > 1))
          )
        ).toBeTruthy();
      })
  );
});

describe("the ledger's way in", () => {
  it("is linked from the project's page", () => {
    const listing = Schema.decodeSync(ProjectListing)({
      openAsks: 0,
      posture: "openWithSealedEvidence",
      project: "datekit",
    });

    const markup = markupOf(
      <ProjectView
        asks={[]}
        landings={[]}
        listing={listing}
        now={now}
        platformUrl="https://platform-test.example.workers.dev"
      />
    );

    expect(markup).toMatch(
      /<a\b[^>]*href="\/oscabriel\/datekit\/visibility#ledger"[^>]*>Ledger<\/a>/u
    );
  });
});

describe("the Visibility tab's views", () => {
  // Views only: props in, markup out, and outside the visibility cartridge,
  // so the web reads only what the public contracts return.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/{ledger,env,visibility}/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const reaching =
    /from\s+["'](?:@repo\/visibility[^"']*|@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

  it("import no transport and nothing from the visibility cartridge", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);

    expect(
      Object.entries(sources).flatMap(([path, source]) =>
        reaching.test(source) ? [path] : []
      )
    ).toStrictEqual([]);
  });
});

const regionIdsOf = (markup: string) =>
  [...mainOf(markup).matchAll(/<h2\b[^>]*\bid="(?<id>[^"]+)"/gu)].map(
    (found) => found.groups?.id
  );

const attributesOf = (markup: string, attribute: string) =>
  [
    ...mainOf(markup).matchAll(
      new RegExp(`${attribute}="(?<value>[^"]*)"`, "gu")
    ),
  ].map((found) => found.groups?.value);

const tabOf = (markup: string) => ({
  areas: attributesOf(markup, "data-area"),
  entries: seqsOf(mainOf(markup)).length,
  keys: attributesOf(markup, "data-env-key"),
  layers: attributesOf(markup, "data-layer"),
});

/** A fresh dev world seeds itself first, which a full test run can slow past 5 s. */
const seededWorld = { timeout: 30_000 };

const decodeVisibility = Schema.decodeEffect(VisibilityPageData);

describe("a project's Visibility tab", () => {
  it.effect(
    "shows, in one page, the layers, the held-back areas, the environment without a value, and the ledger",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit/visibility",
          <VisibilityView env={datekitEnv} ledger={datekit} now={now} />
        );

        expect(markup).toMatch(/<h1\b[^>]*>Visibility<\/h1>/u);
        expect(regionIdsOf(markup)).toStrictEqual([
          "layers",
          "held-back",
          "environment",
          "ledger",
        ]);
        expect(tabOf(markup)).toStrictEqual({
          areas: ["export", "parser"],
          entries: 9,
          keys: ["SENTRY_AUTH_TOKEN", "APP_ENV"],
          layers: ["maintainers"],
        });
        expect(markup).not.toContain("placeholder-sentry-auth-token");
      })
  );

  it.effect(
    "reads the dev world's layered project whole: its maintainers layer, its export and parser areas, its env keys and its ledger",
    () =>
      Effect.gen(function* () {
        const read = yield* readVisibility("oscabriel/vellum").pipe(
          Effect.flatMap(decodeVisibility),
          Effect.provide(fixturesClient())
        );

        const markup = yield* renderAt(
          "/oscabriel/vellum/visibility",
          <VisibilityView env={read.env} ledger={read.ledger} now={read.now} />
        );

        const tab = tabOf(markup);

        expect(tab.layers).toStrictEqual(["maintainers"]);
        expect(tab.areas).toStrictEqual(["export", "parser"]);
        expect(tab.keys).toContain("SENTRY_AUTH_TOKEN");
        expect(tab.entries).toBe(read.ledger.entries.length);
        expect(markup).not.toMatch(/<(?:input|textarea|form|select)\b/u);
      }),
    seededWorld
  );
});
