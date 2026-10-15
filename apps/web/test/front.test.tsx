import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { deleteChildId, splitFamily } from "@repo/project/migrate";
import { Client, Contracts } from "@repo/protocol/contracts";
import { AskListing } from "@repo/protocol/domain/ask";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, Glob, SymbolName } from "@repo/protocol/domain/common";
import {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import { AskId, KindName, ProjectName } from "@repo/protocol/ids";
import { UnknownAsk } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import {
  DateTime,
  Deferred,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization, RpcTest } from "effect/rpc";

import { devServer } from "../src/dev/server.ts";
import { arrange, familiesIn } from "../src/features/front/families.ts";
import {
  filterEntries,
  frontPath,
  readFilter,
} from "../src/features/front/filter.ts";
import type { FrontFilter } from "../src/features/front/filter.ts";
import { FrontPageView } from "../src/features/front/front-page.tsx";
import type { FrontPageProps } from "../src/features/front/front-page.tsx";
import { FrontPageData, readFrontPage } from "../src/server/front-page.ts";
import { ask as parseIsoWeek } from "./ask-fixtures.ts";
import { textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";
import { reachingTransport } from "./transport.ts";

const kind = Schema.decodeSync(KindName);

const rowOf = (markup: string, ask: string) => {
  const start = markup.indexOf(`data-ask="${ask}"`);

  const ends = ["data-ask=", "<section", "</main>"].flatMap((end) => {
    const at = markup.indexOf(end, start + 1);

    return at === -1 ? [] : [at];
  });

  return start === -1 ? "" : markup.slice(start, Math.min(...ends));
};

const rowsIn = (markup: string) =>
  [...markup.matchAll(/<li\b[^>]*data-ask="(?<ask>[^"]+)"/gu)].map(
    (row) => row.groups?.ask
  );

const headersIn = (markup: string) =>
  [
    ...markup.matchAll(
      /<section aria-label="(?<project>[^"]+)"[^>]*>(?<header><div\b[\s\S]*?<\/div><\/div>)/gu
    ),
  ].map((match) => [match.groups?.project, match.groups?.header] as const);

const listIn = (markup: string) =>
  markup.slice(markup.indexOf("data-board-list"), markup.indexOf("</main>"));

const filtersIn = (markup: string) =>
  /<nav aria-label="Filter the asks"[\s\S]*?<\/nav>/u.exec(markup)?.[0] ?? "";

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const entries = Schema.decodeSync(Schema.Array(FrontPageEntry))([
  {
    ask: {
      ask: "explain-iso-week",
      blockedBy: [],
      claimed: false,
      kind: "bug",
      reserve: "newcomers",
      territory: "core",
      want: "The docs say which week of the year a date falls in.",
    },
    posture: "open",
    project: "datekit",
    takeable: false,
  },
  {
    ask: {
      ask: "fix-week-start",
      blockedBy: [],
      claimed: false,
      kind: "bug",
      territory: "core",
      want: "A week starts on the locale's first day, not always on Sunday.",
    },
    posture: "open",
    project: "datekit",
    takeable: true,
  },
  {
    ask: {
      ask: "split-format",
      blockedBy: [],
      claimed: false,
      kind: "migrate",
      territory: "format",
      want: "The format package calls the new parser.",
    },
    posture: "openWithSealedEvidence",
    project: "burrow",
    takeable: true,
  },
]);

const projects = Schema.decodeSync(Schema.Array(ProjectListing))([
  {
    landedAt: "2026-10-06T09:00:00.000Z",
    openAsks: 1,
    posture: "openWithSealedEvidence",
    project: "burrow",
  },
  { openAsks: 2, posture: "open", project: "datekit" },
]);

const asksOf = (shown: readonly FrontPageEntry[]) =>
  shown.map(({ ask }) => ask.ask);

const props = (
  filter: FrontFilter,
  more: Partial<FrontPageProps> = {}
): FrontPageProps => ({
  entries,
  events: new Map(),
  filter,
  now,
  parents: [],
  projects,
  ...more,
});

const front = (filter: FrontFilter, more: Partial<FrontPageProps> = {}) =>
  renderAt(frontPath(filter), <FrontPageView {...props(filter, more)} />);

describe(filterEntries, () => {
  it("puts the asks the viewer may take first, keeping the order given", () => {
    expect(asksOf(filterEntries(entries, {}))).toStrictEqual([
      "fix-week-start",
      "split-format",
      "explain-iso-week",
    ]);
  });

  it("narrows the list to one kind", () => {
    expect(
      asksOf(filterEntries(entries, { kind: kind("migrate") }))
    ).toStrictEqual(["split-format"]);
  });

  it("narrows the list to the asks held for newcomers", () => {
    expect(
      asksOf(filterEntries(entries, { reserved: "newcomers" }))
    ).toStrictEqual(["explain-iso-week"]);
  });

  it("narrows the list to the asks open to take", () => {
    expect(asksOf(filterEntries(entries, { take: "open" }))).toStrictEqual([
      "fix-week-start",
      "split-format",
    ]);
  });

  it("narrows the list to one project", () => {
    expect(
      asksOf(
        filterEntries(entries, {
          project: ProjectName.make("oscabriel/burrow"),
        })
      )
    ).toStrictEqual(["split-format"]);
  });
});

describe(readFilter, () => {
  it("keeps a valid kind, reserve, take and project from the address, and drops what is not one", () => {
    expect(
      readFilter({
        kind: "bug",
        project: "datekit",
        reserved: "newcomers",
        take: "open",
      })
    ).toStrictEqual({
      kind: "bug",
      project: "oscabriel/datekit",
      reserved: "newcomers",
      take: "open",
    });
    expect(
      readFilter({
        kind: "Not A Kind",
        project: "Not_A_Project",
        reserved: "everyone",
        take: "all",
      })
    ).toStrictEqual({});
  });
});

const listing = (id: string, blockedBy: readonly string[] = []) =>
  Schema.decodeSync(AskListing)({
    ask: id,
    blockedBy,
    claimed: false,
    kind: "migrate",
    territory: ".",
    want: `The want of ${id}.`,
  });

describe(familiesIn, () => {
  const children = ["drop-fetch-auth", "drop-fetch-kit"];

  it("reads a family from a parent waiting on asks named after it, with its delete child", () => {
    const listed = [
      listing("drop-fetch", [...children, "drop-fetch-delete"]),
      listing("drop-fetch-auth"),
      listing("drop-fetch-kit"),
      listing("drop-fetch-delete", children),
      listing("fix-week-start"),
    ];

    expect(familiesIn(listed)).toStrictEqual([
      {
        finale: "drop-fetch-delete",
        members: ["drop-fetch-auth", "drop-fetch-kit", "drop-fetch-delete"],
        parent: "drop-fetch",
      },
    ]);
  });

  it("reads one where the list leaves its delete child out, or holds only it", () => {
    expect(
      familiesIn([
        listing("drop-fetch", children),
        listing("drop-fetch-auth"),
        listing("drop-fetch-kit"),
      ]).map(({ members }) => members)
    ).toStrictEqual([children]);
    expect(
      familiesIn([
        listing("drop-fetch", ["drop-fetch-delete"]),
        listing("drop-fetch-delete"),
      ]).map(({ members }) => members)
    ).toStrictEqual([["drop-fetch-delete"]]);
  });

  it("reads no family from an ask that waits on an ask not named after it", () => {
    expect(
      familiesIn([
        listing("footnote-backrefs", ["number-footnotes"]),
        listing("number-footnotes"),
      ])
    ).toStrictEqual([]);
  });

  it("finds the family the platform's split opens, by the names it gives", () => {
    const migrateParent: Ask = {
      ...parseIsoWeek,
      blockedBy: [],
      brief: { want: "Replace legacyFetch with http.get." },
      check: CheckSpec.cases.Migrate.make({
        count: Command.make("bun run count"),
        from: SymbolName.make("legacyFetch"),
        to: SymbolName.make("http.get"),
      }),
      id: AskId.make("drop-fetch"),
      kind: KindName.make("migrate"),
      project: ProjectName.make("oscabriel/burrow"),
      territory: { module: ".", paths: [Glob.make("packages/**")] },
    };

    const counted = Option.getOrThrow(
      splitFamily({
        configDir: Brand.configDir,
        counts: { byModule: { auth: 2, kit: 1 }, total: 3 },
        modules: [
          { module: "auth", paths: [Glob.make("packages/auth/**")] },
          { module: "kit", paths: [Glob.make("packages/kit/**")] },
        ],
        parent: migrateParent,
      })
    );

    const listed = [
      counted.parent,
      ...counted.children,
      counted.deleteChild,
    ].map((ask) => listing(ask.id, ask.blockedBy));

    expect(familiesIn(listed)).toStrictEqual([
      {
        finale: deleteChildId(counted.parent.id),
        members: [
          ...counted.children.map(({ id }) => id),
          counted.deleteChild.id,
        ],
        parent: counted.parent.id,
      },
    ]);
  });
});

describe(arrange, () => {
  it("puts each family at its parent's place, its members out of the list", () => {
    const listed = [
      listing("fix-week-start"),
      listing("drop-fetch-auth"),
      listing("drop-fetch", ["drop-fetch-auth"]),
      listing("parse-iso"),
    ];

    expect(
      arrange(listed).map((item) =>
        item.kind === "family"
          ? `${item.parent.ask}: ${item.members.map(({ ask }) => ask).join(", ")}`
          : item.listing.ask
      )
    ).toStrictEqual([
      "fix-week-start",
      "drop-fetch: drop-fetch-auth",
      "parse-iso",
    ]);
  });
});

describe(FrontPageView, () => {
  it.effect(
    "shows the asks the viewer may take first, grouped by project",
    () =>
      Effect.gen(function* () {
        expect(rowsIn(yield* front({}))).toStrictEqual([
          "fix-week-start",
          "explain-iso-week",
          "split-format",
        ]);
      })
  );

  it.effect(
    "says each project's posture once, on its group's header, and on no row",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({});
        const headers = headersIn(markup);

        const [datekit, burrow] = headers.map(([, header]) => header ?? "");

        expect(headers.map(([project]) => project)).toStrictEqual([
          "oscabriel/datekit",
          "oscabriel/burrow",
        ]);
        expect({
          burrowLink: burrow?.includes('href="/oscabriel/burrow"'),
          burrowPosture: burrow?.includes(
            'data-posture="openWithSealedEvidence"'
          ),
          burrowWords: textIn(burrow ?? "").includes(
            "Open with sealed evidence"
          ),
          datekitCounts: textIn(datekit ?? "").includes("2 open · 1 to take"),
        }).toStrictEqual({
          burrowLink: true,
          burrowPosture: true,
          burrowWords: true,
          datekitCounts: true,
        });
        expect(listIn(markup).match(/data-posture=/gu)).toHaveLength(2);
        expect(
          ["fix-week-start", "explain-iso-week", "split-format"].filter((ask) =>
            rowOf(markup, ask).includes("data-posture")
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "draws its rows when the list of projects has not arrived, with no posture yet",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({}, { projects: undefined });

        expect(rowsIn(markup)).toHaveLength(3);
        expect(listIn(markup)).not.toContain("data-posture=");
      })
  );

  it.effect(
    "says an ask held for newcomers is held for them whoever reads it, with no command for a viewer who may not take it",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({});
        const row = rowOf(markup, "explain-iso-week");

        expect(row).toContain('data-takeable="false"');
        expect(textIn(row)).toMatch(
          /^(?!.*Not open to you).*Held for newcomers/su
        );
        expect(row).not.toContain("Open to take");
        expect(row).not.toContain(`${Brand.cli} claim explain-iso-week`);
        expect(rowOf(markup, "fix-week-start")).toContain("Open to take");
      })
  );

  it.effect("links each ask's want, and shows its kind, territory and id", () =>
    Effect.gen(function* () {
      const row = rowOf(yield* front({}), "split-format");

      expect(row).toMatch(
        /<a\b[^>]*href="\/oscabriel\/burrow\/asks\/split-format"[^>]*>The format package calls the new parser\.<\/a>/u
      );
      expect(textIn(row)).toContain("migrate · format · split-format");
    })
  );

  it.effect(
    "gives an ask the viewer may take no claim command, no copy button and no command box",
    () =>
      Effect.gen(function* () {
        const row = rowOf(yield* front({}), "fix-week-start");

        expect(row).not.toContain(`${Brand.cli} claim`);
        expect(row).not.toContain('aria-label="Copy claim command"');
        expect(row).not.toContain("select-all");
      })
  );

  it.effect("counts the asks shown, and those open to take", () =>
    Effect.gen(function* () {
      expect(textIn(yield* front({}))).toContain("3 open asks, 2 open to take");
    })
  );

  it.effect(
    "narrows by kind, offering each kind, who an ask is for, and each project, with counts",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({ kind: kind("migrate") });
        const all = yield* front({});
        const toolbar = filtersIn(all);

        expect(rowsIn(markup)).toStrictEqual(["split-format"]);
        expect(
          [
            'href="/asks?kind=bug"',
            'href="/asks?kind=migrate&amp;reserved=newcomers"',
          ].filter((href) => !markup.includes(href))
        ).toStrictEqual([]);
        expect(
          [
            'href="/asks?reserved=newcomers"',
            'href="/asks?take=open"',
            'href="/asks?project=oscabriel%2Fburrow"',
          ].filter((href) => !all.includes(href))
        ).toStrictEqual([]);
        expect(textIn(toolbar)).toMatch(
          /Open to take\s*2[\s\S]*Held for newcomers\s*1/u
        );
        expect(
          ["Reserved", "For people, not agents"].filter((words) =>
            textIn(toolbar).includes(words)
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "draws the filters as a landmark beside the list, and no inspector",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({});
        const board = markup.slice(markup.indexOf("data-board="));

        expect(
          board.indexOf('<nav aria-label="Filter the asks"')
        ).toBeGreaterThan(-1);
        const list = board.indexOf("data-board-list");

        expect([
          board.indexOf("</nav>") < list,
          list < board.indexOf('data-ask="'),
        ]).toStrictEqual([true, true]);
        expect(
          ["data-facts", "Start here", "Selected ask", "data-toolbar"].filter(
            (words) => markup.includes(words)
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "offers each kind, each state and each project in the filters, with counts, and a reset once one is set",
    () =>
      Effect.gen(function* () {
        const filters = filtersIn(yield* front({ kind: kind("bug") }));

        expect(
          [...filters.matchAll(/<h2\b[^>]*>(?<head>[^<]+)<\/h2>/gu)].map(
            ({ groups }) => groups?.head
          )
        ).toStrictEqual(["Kind", "State", "Project"]);
        expect(textIn(filters)).toMatch(
          /All\s*3[\s\S]*bug\s*2[\s\S]*migrate\s*1[\s\S]*Open to take\s*1[\s\S]*Held for newcomers\s*1/u
        );
        expect(filters).toMatch(
          /<a\b[^>]*aria-current="page"[^>]*href="\/asks\?kind=bug"|<a\b[^>]*href="\/asks\?kind=bug"[^>]*aria-current="page"/u
        );
        expect(filters).toMatch(
          /<a\b[^>]*href="\/asks"[^>]*>Reset filters<\/a>/u
        );
        expect(filtersIn(yield* front({}))).not.toContain("Reset filters");
      })
  );

  it.effect(
    "keeps the filter in the address, so /asks?kind=bug&take=open shows the bugs open to take and every option keeps the rest",
    () =>
      Effect.gen(function* () {
        const markup = yield* front(readFilter({ kind: "bug", take: "open" }));

        const filters = filtersIn(markup);

        expect(rowsIn(markup)).toStrictEqual(["fix-week-start"]);
        expect(
          [
            'href="/asks?kind=bug&amp;reserved=newcomers"',
            'href="/asks?take=open"',
            'href="/asks?kind=migrate&amp;take=open"',
            'href="/asks?kind=bug&amp;take=open&amp;project=oscabriel%2Fdatekit"',
          ].filter((href) => !filters.includes(href))
        ).toStrictEqual([]);
      })
  );

  it.effect("puts no strip of steps and no command box above the list", () =>
    Effect.gen(function* () {
      const markup = yield* front({});

      expect(markup).not.toContain("data-how-to");
      expect(markup).not.toMatch(/<code\b[^>]*select-all/u);
      expect(textIn(markup)).not.toContain(Brand.cli);
    })
  );

  it.effect("with an ask selected, marks its row and opens no inspector", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/asks?ask=fix-week-start",
        <FrontPageView {...props({})} />
      );

      expect(markup).toMatch(
        /<li\b[^>]*data-selected="true"[^>]*data-ask="fix-week-start"/u
      );
      expect(markup).not.toContain("data-facts");
    })
  );

  it.effect("never uses the words a forge's lists use", () =>
    Effect.gen(function* () {
      const text = textIn(yield* front({})).toLowerCase();

      for (const word of ["queue", "inbox", "explore", "trending"]) {
        expect(text).not.toContain(word);
      }
    })
  );

  it.effect(
    "says an empty front page is empty, with a link to bring a project and no command",
    () =>
      Effect.gen(function* () {
        const markup = yield* front({}, { entries: [], projects: [] });
        const text = textIn(markup);

        expect(text).toContain("No open asks");
        expect(markup).toMatch(
          /<a\b[^>]*href="\/import"[^>]*>Bring a project here<\/a>/u
        );
        expect(text).not.toContain(Brand.cli);
      })
  );

  it.effect(
    "says a front page with projects but no asks has none open, with no command",
    () =>
      Effect.gen(function* () {
        const text = textIn(yield* front({}, { entries: [] }));

        expect(text).toContain("No open asks");
        expect(text).not.toContain(Brand.cli);
      })
  );
});

const clientOver = (answer: (request: Request) => Promise<Response>) =>
  Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url: "http://localhost/rpc" })),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
        answer(new Request(input, init))
      )
    )
  );

const devWorld = Layer.unwrap(
  Effect.gen(function* () {
    const { dispose, handler } = devServer();

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    return clientOver(handler);
  })
);

const projectsNeverAnswer = Layer.effect(
  Client,
  RpcTest.makeClient(Contracts)
).pipe(
  Layer.provide([
    Layer.mergeAll(
      unanswered,
      Contracts.toLayerHandler("frontPage", () => Effect.succeed({ entries })),
      Contracts.toLayerHandler("listProjects", () => Effect.never)
    ),
    asTester,
  ])
);

/** A family's parent and child, so the page reads the parent and replays its project. */
const familyEntries = Schema.decodeSync(Schema.Array(FrontPageEntry))(
  ["drop-fetch", "drop-fetch-auth"].map((ask) => ({
    ask: {
      ask,
      blockedBy: ask === "drop-fetch" ? ["drop-fetch-auth"] : [],
      claimed: false,
      kind: "migrate",
      territory: ".",
      want: `The want of ${ask}.`,
    },
    posture: "open",
    project: "burrow",
    takeable: true,
  }))
);

/** The parent's read answers only once the replay has begun, so reading the two one after the other never ends. */
const parentWaitsOnReplay = Layer.unwrap(
  Effect.gen(function* () {
    const replayed = yield* Deferred.make<boolean>();

    return Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("frontPage", () =>
            Effect.succeed({ entries: familyEntries })
          ),
          Contracts.toLayerHandler("showAsk", (payload) =>
            Deferred.await(replayed).pipe(
              Effect.andThen(new UnknownAsk({ ask: payload.ask }))
            )
          ),
          Contracts.toLayerHandler("watch", () =>
            Stream.fromEffect(Deferred.succeed(replayed, true)).pipe(
              Stream.flatMap(() => Stream.empty)
            )
          )
        ),
        asTester,
      ])
    );
  })
);

const decodeData = Schema.decodeEffect(FrontPageData);

/** A fresh dev world seeds itself first, which a full test run can slow past 5 s. */
const seededWorld = { timeout: 30_000 };

const sentFrom = (data: FrontPageData, filter: FrontFilter = {}) =>
  renderAt(
    "/asks",
    <FrontPageView
      entries={data.entries}
      events={
        new Map(data.events.map(({ events, project }) => [project, events]))
      }
      filter={filter}
      now={data.now}
      parents={data.parents}
      projects={undefined}
    />
  );

describe("the front page as the server sends it", () => {
  it.effect(
    "holds every open ask's want as a link, grouped by project, burrow's family as one fan row",
    () =>
      Effect.gen(function* () {
        const data = yield* readFrontPage.pipe(
          Effect.flatMap(decodeData),
          Effect.provide(devWorld)
        );

        const markup = yield* sentFrom(data);
        const text = textIn(markup);

        expect(listIn(markup)).not.toContain("Reading from the platform");
        expect(markup).toMatch(
          /<a\b[^>]*href="\/oscabriel\/datekit\/asks\/add-months-clamp"[^>]*>[^<]+<\/a>/u
        );
        expect(headersIn(markup).map(([project]) => project)).toStrictEqual([
          "oscabriel/burrow",
          "oscabriel/datekit",
        ]);
        expect(text).toContain("10 open asks, 7 open to take");

        const family = rowOf(markup, "drop-legacy-fetch");
        const nodes = family.match(/<li class="flex items-center gap-1.5"/gu);

        expect({
          familyRows: rowsIn(markup).filter(
            (ask) => ask?.startsWith("drop-legacy-fetch") === true
          ),
          nodes: nodes?.length,
          noCommandBox: !listIn(markup).includes("select-all"),
          strip: /0 of 6 landed[\s\S]*Show 6 children/u.test(textIn(family)),
        }).toStrictEqual({
          familyRows: ["drop-legacy-fetch"],
          nodes: 6,
          noCommandBox: true,
          strip: true,
        });
      }),
    seededWorld
  );

  it.effect(
    "is read without the list of projects, which may never answer",
    () =>
      Effect.gen(function* () {
        const data = yield* readFrontPage.pipe(
          Effect.flatMap(decodeData),
          Effect.provide(projectsNeverAnswer)
        );

        expect(rowsIn(yield* sentFrom(data))).toHaveLength(3);
      })
  );

  it.effect("reads the parents and replays the projects at once", () =>
    Effect.gen(function* () {
      const data = yield* readFrontPage.pipe(
        Effect.flatMap(decodeData),
        Effect.provide(parentWaitsOnReplay)
      );

      expect({
        events: data.events.map(({ project }) => project),
        parents: data.parents,
      }).toStrictEqual({ events: ["oscabriel/burrow"], parents: [] });
    })
  );
});

describe("the front page's views", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/front/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(1);
    expect(reachingTransport(sources)).toStrictEqual([]);
  });

  it("never write a cookie", () => {
    expect(
      Object.entries(sources).flatMap(([path, source]) =>
        /document\.cookie|cookieStore|set-cookie/iu.test(source) ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
