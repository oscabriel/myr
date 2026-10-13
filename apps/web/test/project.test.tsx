import { describe, expect, it } from "@effect/vitest";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { AskListing } from "@repo/protocol/domain/ask";
import type { Ask } from "@repo/protocol/domain/ask";
import { FileView, TagName, TreeListing } from "@repo/protocol/domain/code";
import { Glob } from "@repo/protocol/domain/common";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { LandingView } from "@repo/protocol/domain/landing";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Ledger } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  AskId,
  Handle,
  KindName,
  LayerName,
  ProjectName,
} from "@repo/protocol/ids";
import { UnknownRevision } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import {
  DateTime,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization, RpcTest } from "effect/rpc";
import type { ReactNode } from "react";

import { recentLandings } from "../src/client/events.ts";
import type { DevWorldOptions } from "../src/dev/server.ts";
import { devServer } from "../src/dev/server.ts";
import { ledeOf } from "../src/features/front/head.ts";
import { stampStep } from "../src/features/front/stamps.ts";
import { ImportOffer, offerFor } from "../src/features/import/import-offer.tsx";
import { ProjectFrame } from "../src/features/project/project-frame.tsx";
import {
  CloneSteps,
  ProjectHeader,
  WatchSteps,
} from "../src/features/project/project-header.tsx";
import { recentShown } from "../src/features/project/landings.tsx";
import { postureWord } from "../src/features/project/posture-label.ts";
import { PostureMark } from "../src/features/project/posture-mark.tsx";
import {
  ProjectView,
  heldBackOf,
  homeListing,
} from "../src/features/project/project-page.tsx";
import type { ProjectViewProps } from "../src/features/project/project-page.tsx";
import { UnknownProjectView } from "../src/features/project/unknown-project.tsx";
import { askStates } from "../src/features/shared/ask-progress.ts";
import { projectTabOf } from "../src/features/shared/shell/sections.ts";
import {
  ProjectHeaderData,
  ProjectPageData,
  readProjectHeader,
  readProjectPage,
} from "../src/server/project-page.ts";
import { ask as parseIsoWeek } from "./ask-fixtures.ts";
import { allInOrder, markupOf, textIn, textOf } from "./markup.ts";
import { elementWith } from "./records.ts";
import { renderAt } from "./render.tsx";
import { reachingTransport } from "./transport.ts";

const rowOf = (markup: string, ask: string) => {
  const start = markup.indexOf(`data-ask="${ask}"`);

  const ends = ['data-ask="', "</ul></section>", "</main>"].flatMap((end) => {
    const at = markup.indexOf(end, start + 1);

    return at === -1 ? [] : [at];
  });

  return start === -1 ? "" : markup.slice(start, Math.min(...ends));
};

const missingFrom = (text: string, parts: readonly string[]) =>
  parts.filter((part) => !text.includes(part));

const foundIn = (text: string, parts: readonly string[]) =>
  parts.filter((part) => text.includes(part));

const mainOf = (markup: string) =>
  markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));

const aboutOf = (markup: string) => elementWith(markup, 'data-column="about"');

/** The main region without its about column. */
const mainColumnOf = (markup: string) =>
  mainOf(markup).replace(aboutOf(markup), "");

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const platformUrl = "https://platform-test.example.workers.dev";

/** The gate's seven stages in cost order, as DESIGN.md's stage strip names them. */
const STAGES = [
  "Parse",
  "Shape",
  "Merge",
  "Cheap",
  "Checks",
  "Held-back",
  "Maintainer",
];

const TABS = [
  "Overview",
  "Code",
  "Asks",
  "Landings",
  "Proposals",
  "People",
  "Policy",
  "Visibility",
];

const listing = Schema.decodeSync(ProjectListing)({
  landedAt: "2026-10-06T09:00:00.000Z",
  openAsks: 2,
  posture: "openWithSealedEvidence",
  project: "datekit",
});

const asks = Schema.decodeSync(Schema.Array(AskListing))([
  {
    ask: "fix-week-start",
    blockedBy: [],
    claimed: false,
    kind: "bug",
    territory: "core",
    want: "A week starts on the locale's first day, not always on Sunday.",
  },
  {
    ask: "drop-legacy-parse",
    blockedBy: [
      "drop-legacy-parse-core",
      "drop-legacy-parse-format",
      "drop-legacy-parse-delete",
    ],
    claimed: false,
    kind: "migrate",
    territory: ".",
    want: "Nothing calls the legacy parser any more.",
  },
  {
    ask: "drop-legacy-parse-core",
    blockedBy: [],
    claimed: false,
    kind: "migrate",
    territory: "core",
    want: "core: 2 callers of legacyParse → parse",
  },
  {
    ask: "drop-legacy-parse-format",
    blockedBy: [],
    claimed: true,
    kind: "migrate",
    territory: "format",
    want: "format: 1 caller of legacyParse → parse",
  },
  {
    ask: "drop-legacy-parse-delete",
    blockedBy: ["drop-legacy-parse-core", "drop-legacy-parse-format"],
    claimed: false,
    kind: "migrate",
    territory: ".",
    want: "Delete legacyParse: nothing calls it any more",
  },
  {
    ask: "trim-week-names",
    blockedBy: ["fix-week-start"],
    claimed: false,
    kind: "bug",
    reserve: "newcomers",
    territory: "core",
    want: "Week names are trimmed.",
  },
]);

const parent: Ask = {
  ...parseIsoWeek,
  blockedBy: [
    AskId.make("drop-legacy-parse-core"),
    AskId.make("drop-legacy-parse-format"),
    AskId.make("drop-legacy-parse-delete"),
  ],
  brief: { want: "Nothing calls the legacy parser any more." },
  id: AskId.make("drop-legacy-parse"),
  kind: KindName.make("migrate"),
};

const landingOf = (
  sha: string,
  more: { readonly ask?: string; readonly opened?: string },
  answerer?: string
) =>
  Schema.decodeSync(LandingView)({
    ...more,
    assisted: [],
    author: answerer ?? "ines-v",
    credits: [
      { handle: "ines-v", role: "Asked-by" },
      ...(answerer === undefined
        ? []
        : [{ handle: answerer, role: "Signed-off-by" as const }]),
    ],
    landedAt: "2026-10-06T09:00:00.000Z",
    parent: "2".repeat(40),
    project: "datekit",
    sha: sha.repeat(40),
  });

const landings = [
  landingOf("a", { ask: "parse-iso-week" }, "bram"),
  landingOf("b", { opened: "format-ordinal" }),
  landingOf("c", { ask: "format-era" }, "okonkwo"),
  landingOf("d", { opened: "add-months-clamp" }),
];

const AT = "a".repeat(40);

const root = Schema.decodeSync(TreeListing)({
  at: AT,
  entries: [
    {
      mode: "040000",
      name: "src",
      path: "src",
      sha: "b".repeat(40),
      type: "tree",
    },
    {
      mode: "100644",
      name: "README.md",
      path: "README.md",
      sha: "c".repeat(40),
      type: "blob",
    },
  ],
  readme: { path: "README.md", sha: "c".repeat(40) },
});

const readme = Schema.decodeSync(FileView)({
  at: AT,
  binary: false,
  path: "README.md",
  sha: "c".repeat(40),
  size: 26,
  text: "# datekit\n\nDates, kept.\n",
  truncated: false,
});

const vellumLedger: Ledger = {
  entries: [
    LedgerEntry.cases.CountChanged.make({
      area: AreaName.make("export"),
      at: now,
      count: 7,
      layer: LayerName.make("maintainers"),
      seq: 1,
    }),
  ],
  layers: [],
  posture: "openWithSealedEvidence",
  postureLabel: "Open with sealed evidence",
  project: ProjectName.make("oscabriel/vellum"),
};

const props = (more: Partial<ProjectViewProps> = {}): ProjectViewProps => ({
  asks,
  landings,
  listing,
  now,
  parents: [parent],
  platformUrl,
  ...more,
});

const page = (more: Partial<ProjectViewProps> = {}) =>
  renderAt("/oscabriel/datekit", <ProjectView {...props(more)} />);

describe(ProjectView, () => {
  it.effect(
    "lists every open ask with its want as the link, then its kind, territory and id",
    () =>
      Effect.gen(function* () {
        const row = rowOf(yield* page(), "fix-week-start");

        expect(row).toMatch(
          /<a\b[^>]*href="\/oscabriel\/datekit\/asks\/fix-week-start"[^>]*>A week starts on the locale&#x27;s first day, not always on Sunday\.<\/a>/u
        );
        expect(textIn(row)).toContain("bug · core · fix-week-start");
        expect(textIn(row)).toContain("Open to take");
        expect(textIn(row)).toContain(
          `${Brand.cli} claim fix-week-start --project oscabriel/datekit`
        );
      })
  );

  it.effect(
    "reads an ask whose blockers have all landed (left the list) as open to take, and counts it",
    () =>
      Effect.gen(function* () {
        const markup = yield* page({
          asks: asks.map((each) =>
            each.ask === "fix-week-start"
              ? { ...each, blockedBy: [AskId.make("landed-before")] }
              : each
          ),
        });

        expect(textIn(rowOf(markup, "fix-week-start"))).toContain(
          "Open to take"
        );
        expect(textIn(markup)).toContain("5 open asks, 2 open to take");
      })
  );

  it.effect(
    "draws a family as its parent's row with the fan, its children listed under it",
    () =>
      Effect.gen(function* () {
        const markup = yield* page();
        const family = rowOf(markup, "drop-legacy-parse");

        expect(family).toContain('data-family="drop-legacy-parse"');
        expect(
          missingFrom(textIn(family), [
            "0 of 2 landed",
            "Hide 2 children",
            "core: 2 callers of legacyParse → parse",
            "delete waits for 2",
          ])
        ).toStrictEqual([]);
        expect(family.match(/data-family-child="/gu)).toHaveLength(2);
        // Its members are drawn in the fan, not again as rows of their own.
        expect(
          foundIn(markup, [
            'data-ask="drop-legacy-parse-core"',
            'data-ask="drop-legacy-parse-delete"',
          ])
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "reads an ask that waits on another as waiting, with the one it waits on listed",
    () =>
      Effect.gen(function* () {
        const markup = yield* page();
        const row = rowOf(markup, "trim-week-names");

        expect(textIn(row)).toContain("Waiting");
        expect(row).not.toContain(`${Brand.cli} claim trim-week-names`);
        expect(markup).toContain('data-ask="fix-week-start"');
      })
  );

  it.effect(
    "says in the about column how a change lands here: the seven stages, who decides, what is held back",
    () =>
      Effect.gen(function* () {
        const about = aboutOf(
          yield* page({
            deciders: [
              {
                handles: [Handle.make("ines-v"), Handle.make("okonkwo")],
                paths: Glob.make("src/**"),
              },
            ],
            heldBack: heldBackOf(vellumLedger),
          })
        );

        const text = textIn(about);

        expect(
          missingFrom(text, ["How a change lands here", "export: 7 sealed checks"])
        ).toStrictEqual([]);
        expect(allInOrder(text, STAGES)).toBeTruthy();
        expect(text).toMatch(/src\/\*\*\s*·\s*ines-v, okonkwo/u);
        expect(
          missingFrom(about, [
            'href="/oscabriel/datekit/people"',
            'href="/oscabriel/datekit/ledger"',
            'href="/oscabriel/datekit/llms.txt"',
          ])
        ).toStrictEqual([]);
        // The posture is the header's to say, once.
        expect(about).not.toContain("data-posture=");
      })
  );

  it.effect(
    "names where an imported project came from, with its branch, as a copy read-only here; and nothing for one that started empty",
    () =>
      Effect.gen(function* () {
        const facts = aboutOf(
          yield* page({
            importedFrom: {
              branch: "master",
              url: "https://github.com/dtolnay/anyhow",
            },
          })
        );

        const text = textIn(facts);

        expect(
          missingFrom(text, [
            "Imported from",
            "https://github.com/dtolnay/anyhow",
            "branch master",
            "This project is a copy of a public repo, read-only here and not run by its upstream maintainers.",
          ])
        ).toStrictEqual([]);
        expect(facts).toMatch(
          /<a[^>]*href="https:\/\/github\.com\/dtolnay\/anyhow"[^>]*rel="noreferrer"/u
        );
        expect(textIn(aboutOf(yield* page()))).not.toContain("Imported from");
      })
  );

  it.effect(
    "gives the clone command and the claim command in the about column, and the last three landings as one-line credits in the main one",
    () =>
      Effect.gen(function* () {
        const markup = yield* page();
        const about = textIn(aboutOf(markup));
        const landed = mainColumnOf(markup);

        expect(
          allInOrder(about, [
            `git clone ${platformUrl}/oscabriel/datekit.git`,
            `${Brand.cli} claim <ask> --project oscabriel/datekit`,
          ])
        ).toBeTruthy();
        expect(landed.match(/data-landing="/gu)).toHaveLength(3);
        expect(
          missingFrom(textIn(landed), [
            "Answer parse-iso-week",
            "Asked by ines-v · answered by bram",
          ])
        ).toStrictEqual([]);
        expect(textIn(landed)).not.toContain("Asked-by: ines-v");
      })
  );

  it.effect(
    "has no code table, and its clone command only in the about column: the Code tab has the rest",
    () =>
      Effect.gen(function* () {
        const markup = yield* page({ code: { readme, root } });
        const main = mainColumnOf(markup);

        expect(main).not.toContain('href="/oscabriel/datekit/tree/main/src"');
        expect(main).not.toContain("git clone");
        expect(main).toContain('data-readme="README.md"');
        expect(textIn(main)).toContain("Dates, kept.");
        // The README comes after the asks and the landings.
        expect(
          allInOrder(main, ['id="open-asks"', 'id="recent-landings"', "data-readme"])
        ).toBeTruthy();
      })
  );

  it.effect(
    "says an empty project is empty, with the commands that would fill it",
    () =>
      Effect.gen(function* () {
        const { landedAt: _landed, ...unlanded } = listing;

        const text = textIn(
          yield* page({
            asks: [],
            landings: [],
            listing: { ...unlanded, openAsks: 0 },
          })
        );

        expect(text).toContain("No open asks");
        expect(text).toContain(`${Brand.cli} ask open`);
        expect(text).toContain("Nothing has landed");
        // The project exists, so `init` would refuse it: its first push lands main.
        expect(text).toContain(
          `git push ${platformUrl}/oscabriel/datekit.git HEAD:main`
        );
        expect(text).not.toContain(`${Brand.cli} init`);
      })
  );

  it.effect(
    "never says nothing has landed on a project whose main has landed",
    () =>
      Effect.gen(function* () {
        const text = textIn(yield* page({ landings: [] }));

        expect(text).toContain("No landings among the recent events");
        expect(text).not.toContain("Nothing has landed");
        expect(text).not.toContain("git push");
      })
  );

  it("draws the same page with no router around it, nothing selected", () => {
    const text = textOf(<ProjectView {...props()} />);

    expect(text).toContain("How a change lands here");
    expect(text).toContain("fix-week-start");
  });
});

describe(recentShown, () => {
  it("shows the last three answers once three have landed, the setup's landings dropped", () => {
    const answers = [
      landingOf("1", { ask: "one" }, "bram"),
      landingOf("2", { opened: "two" }),
      landingOf("3", { ask: "three" }, "bram"),
      landingOf("4", { ask: "four" }, "bram"),
      landingOf("5", {}),
    ];

    expect(recentShown(answers).map(({ ask }) => ask)).toStrictEqual([
      "one",
      "three",
      "four",
    ]);
  });

  it("shows the last three of any kind before three answers have landed", () => {
    expect(recentShown(landings).map(({ sha }) => sha[0])).toStrictEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe(ledeOf, () => {
  it("is a README's first sentence, past its title, as plain words", () => {
    expect(
      ledeOf(
        "# datekit\n\nSmall, dependency-free date helpers for `TypeScript`. datekit reads ISO 8601 text.\n"
      )
    ).toBe("Small, dependency-free date helpers for TypeScript.");
    expect(
      ledeOf(
        "# burrow\n\nThe services behind [burrow's](https://x.test) shop: six packages.\n"
      )
    ).toBe("The services behind burrow's shop: six packages.");
  });

  it("is none when the README opens with no prose", () => {
    expect(ledeOf("# title\n\n| a | b |\n| - | - |\n")).toBeUndefined();
  });
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

const failingProjects =
  (
    handler: (request: Request) => Promise<Response>,
    listed: Ref.Ref<number> | undefined
  ) =>
  (request: Request) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const body = yield* Effect.promise(() => request.clone().text());

        if (listed !== undefined && body.includes('"listProjects"')) {
          yield* Ref.update(listed, (count) => count + 1);

          return new Response("", { status: 503 });
        }

        return yield* Effect.promise(() => handler(request));
      })
    );

const devWorldWith = (options: DevWorldOptions, listed?: Ref.Ref<number>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { dispose, handler } = devServer(options);

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return clientOver(failingProjects(handler, listed));
    })
  );

const devWorld = devWorldWith({});

const unanswering = clientOver(() =>
  Promise.resolve(new Response("", { status: 503 }))
);

const nothingLanded = Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
  Layer.provide([
    Layer.mergeAll(
      unanswered,
      Contracts.toLayerHandler("readTree", ({ at }) =>
        Effect.fail(new UnknownRevision({ rev: at ?? "main" }))
      ),
      Contracts.toLayerHandler("listAsks", () => Effect.succeed({ asks: [] }))
    ),
    asTester,
  ])
);

const decodePage = Schema.decodeEffect(ProjectPageData);

const inputNamed = (markup: string, name: string) =>
  new RegExp(`<input[^>]*name="${name}"[^>]*>`, "u").exec(markup)?.[0] ?? "";

/** A fresh dev world seeds itself first, which a full test run can slow past 5 s. */
const seededWorld = { timeout: 30_000 };

const propsFrom = (data: ProjectPageData): ProjectViewProps => {
  const events = data.events ?? [];
  const [latest] = recentLandings(events);

  return {
    asks: data.asks,
    code: data.code,
    deciders: data.policy?.policy?.deciders,
    heldBack: data.ledger === undefined ? undefined : heldBackOf(data.ledger),
    importedFrom: data.policy?.importedFrom,
    landings: recentLandings(events),
    lastLanded: latest?.landedAt,
    listing: homeListing({
      asks: data.asks,
      ledger: data.ledger,
      project: data.project,
    }),
    now: data.now,
    parents: data.parents,
    platformUrl,
    states: askStates(events),
  };
};

const sentFrom = (
  data: ProjectPageData,
  more: Partial<ProjectViewProps> = {}
) =>
  renderAt(
    `/${data.project}`,
    <ProjectView {...propsFrom(data)} {...more} />
  );

const readFrom = (name: string, world: Layer.Layer<Client>) =>
  readProjectPage(name).pipe(Effect.flatMap(decodePage), Effect.provide(world));

const decodeHeader = Schema.decodeEffect(ProjectHeaderData);

const headerFrom = (name: string, world: Layer.Layer<Client>) =>
  readProjectHeader(name).pipe(
    Effect.flatMap(decodeHeader),
    Effect.provide(world)
  );

/** A project page as its route draws it: the project's frame, its header, then the page. */
const framed = (url: string, header: ProjectHeaderData, page: ReactNode) =>
  renderAt(
    url,
    <ProjectFrame
      header={
        <ProjectHeader
          current={projectTabOf(url)}
          header={header}
          platformUrl={platformUrl}
        />
      }
    >
      {page}
    </ProjectFrame>
  );

const tabsOf = (markup: string) =>
  [
    ...elementWith(markup, 'data-project-tabs=""').matchAll(
      /<a\b(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/a>/gu
    ),
  ].map(({ groups }) => ({
    current: /aria-current="page"/u.test(groups?.attributes ?? ""),
    label: textIn(groups?.text ?? "").replaceAll(/\d+/gu, "").trim(),
  }));

describe("the project's home as the server sends it", () => {
  it.effect(
    "carries datekit's asks, landings and README, with no code table, and the clone command only beside them",
    () =>
      Effect.gen(function* () {
        const data = yield* readFrom("datekit", devWorld);
        const markup = yield* sentFrom(data);
        const main = mainOf(markup);

        expect(main).toMatch(
          /<a\b[^>]*href="\/oscabriel\/datekit\/asks\/add-months-clamp"[^>]*>[^<]+<\/a>/u
        );
        expect(
          missingFrom(main, [
            "Small, dependency-free date helpers",
            'data-readme="README.md"',
          ])
        ).toStrictEqual([]);
        expect(
          foundIn(mainColumnOf(markup), [
            'href="/oscabriel/datekit/tree/main/src"',
            "git clone",
            "Reading from the platform",
          ])
        ).toStrictEqual([]);
        expect(textIn(aboutOf(markup))).toContain("How a change lands here");
        expect(
          (main.match(/data-landing="/gu) ?? []).length
        ).toBeLessThanOrEqual(3);
      }),
    seededWorld
  );

  it.effect(
    "draws burrow's family expanded, its six children listed",
    () =>
      Effect.gen(function* () {
        const data = yield* readFrom("burrow", devWorld);

        const family = rowOf(
          mainOf(yield* sentFrom(data)),
          "drop-legacy-fetch"
        );

        expect(family.match(/data-family-child="/gu)).toHaveLength(6);
        expect(textIn(family)).toContain("0 of 6 landed");
        expect(textIn(family)).toContain("Hide 6 children");
      }),
    seededWorld
  );

  it.effect(
    "is sent without its asks and code, not as a not-found, when the platform does not answer",
    () =>
      Effect.gen(function* () {
        const { asks: read, code } = yield* readFrom("datekit", unanswering);

        expect(read).toBeUndefined();
        expect(code).toBeUndefined();
      })
  );

  it.effect(
    "shows a project whose main has not landed with no code, and no error",
    () =>
      Effect.gen(function* () {
        const data = yield* readFrom("datekit", nothingLanded);

        expect(data.code).toBeUndefined();
        expect(mainOf(yield* sentFrom(data))).not.toContain("data-readme");
      })
  );

  it.effect.each(["no-such-project", "Not_A_Project"])(
    "is a not-found for %s, which the platform does not know",
    (name) =>
      Effect.gen(function* () {
        const failed = yield* Effect.flip(
          readProjectPage(name).pipe(Effect.provide(devWorld))
        );

        expect(isNotFound(failed)).toBeTruthy();
      }),
    seededWorld
  );
});

const headerFacts = {
  deciders: [Handle.make("ines-v"), Handle.make("okonkwo")],
  landedAt: DateTime.makeUnsafe("2026-10-06T09:00:00Z"),
  latestTag: TagName.make("v0.3.0"),
  lede: "Dates, kept.",
  now,
  open: { asks: 5, takeable: 2 },
  posture: {
    label: "Open with sealed evidence · sealed checks in export",
    posture: "openWithSealedEvidence",
  },
  project: ProjectName.make("oscabriel/datekit"),
} satisfies ProjectHeaderData;

const headerOf = (markup: string) => elementWith(markup, 'data-project-header=""');

/** The header as a page draws it, its current tab's mark and its name's element taken out. */
const sameHeader = (markup: string) =>
  headerOf(markup)
    .replaceAll(' aria-current="page"', "")
    .replace('<h1 class="text-headline', '<p class="text-headline')
    .replace("</h1>", "</p>");

const HEADER_READS = [
  "ledger",
  "listAsks",
  "listRefs",
  "log",
  "projectPolicy",
  "readFile",
  "readTree",
] as const;

/** Each read waits until every one has started, so a read made after another never ends. */
const answeringAtOnce = Layer.unwrap(
  Effect.gen(function* () {
    const started = yield* Ref.make(0);
    const all = yield* Deferred.make<void>();

    const held = Effect.gen(function* () {
      const count = yield* Ref.updateAndGet(started, (seen) => seen + 1);

      if (count === HEADER_READS.length) {
        yield* Deferred.succeed(all, undefined);
      }

      yield* Deferred.await(all);

      return yield* Effect.die("Read at once, answered with nothing.");
    });

    return Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([
        Layer.mergeAll(
          unanswered,
          ...HEADER_READS.map((read) => Contracts.toLayerHandler(read, () => held))
        ),
        asTester,
      ])
    );
  })
);

describe("a project's page in its frame", () => {
  it.effect(
    "opens burrow on Overview: eight tabs, the clone command and the seven stages in the about column, and no inspector",
    () =>
      Effect.gen(function* () {
        const header = yield* headerFrom("oscabriel/burrow", devWorld);
        const data = yield* readFrom("oscabriel/burrow", devWorld);
        const markup = yield* framed(
          "/oscabriel/burrow",
          header,
          <ProjectView {...propsFrom(data)} />
        );

        const about = textIn(elementWith(markup, 'data-column="about"'));

        expect(tabsOf(markup)).toStrictEqual(
          TABS.map((label) => ({ current: label === "Overview", label }))
        );
        expect(about).toContain(
          `git clone ${platformUrl}/oscabriel/burrow.git`
        );
        expect(allInOrder(about, STAGES)).toBeTruthy();
        expect(markup).not.toMatch(/data-facts="(?:inline|inspector)"/u);
      }),
    seededWorld
  );

  it.effect(
    "draws the same header on Overview, a tree page and an ask page, only the current tab moving",
    () =>
      Effect.gen(function* () {
        const pages = [
          "/oscabriel/datekit",
          "/oscabriel/datekit/tree/main/src",
          "/oscabriel/datekit/asks/fix-week-start",
        ];

        const markups = yield* Effect.forEach(pages, (url) =>
          framed(url, headerFacts, <main id="main" />)
        );

        expect(
          markups.map((markup) =>
            tabsOf(markup)
              .filter(({ current }) => current)
              .map(({ label }) => label)
          )
        ).toStrictEqual([["Overview"], ["Code"], ["Asks"]]);
        // Overview's title is the project; the others title their own subject.
        expect(new Set(markups.map(sameHeader)).size).toBe(1);
        expect(markups.map(headerOf).every((header) => header !== "")).toBeTruthy();
      })
  );

  it.effect(
    "says the posture once on the page, in its short form, the platform's words in its title",
    () =>
      Effect.gen(function* () {
        const markup = yield* framed(
          "/oscabriel/datekit",
          headerFacts,
          <ProjectView {...props({ heldBack: heldBackOf(vellumLedger) })} />
        );

        const header = headerOf(markup);

        expect(markup.match(/data-posture="/gu)).toHaveLength(1);
        expect(header).toContain('data-posture="openWithSealedEvidence"');
        expect(textIn(header)).toContain(postureWord("openWithSealedEvidence"));
        expect(header).toContain(
          'title="Open with sealed evidence · sealed checks in export"'
        );
      })
  );

  it.effect(
    "gives the project's facts in one row: open asks, last landing, newest tag and who decides",
    () =>
      Effect.gen(function* () {
        const markup = yield* framed("/oscabriel/datekit", headerFacts, null);
        const facts = elementWith(markup, 'data-project-facts=""');

        expect(
          allInOrder(textIn(facts), [
            "5 open asks",
            "Landed 1 d ago",
            "v0.3.0",
            "Decided by ines-v, okonkwo",
          ])
        ).toBeTruthy();
        expect(facts).toContain('href="/people/ines-v"');
        expect(textIn(headerOf(markup))).toContain("Dates, kept.");
      })
  );

  it.effect(
    "offers Watch, Clone and Contribute, and counts the open asks on the Asks tab",
    () =>
      Effect.gen(function* () {
        const markup = yield* framed("/oscabriel/datekit", headerFacts, null);

        expect(
          [...headerOf(markup).matchAll(/data-action="(?<action>\w+)"/gu)].map(
            ({ groups }) => groups?.action
          )
        ).toStrictEqual(["watch", "clone", "contribute"]);
        expect(
          textIn(elementWith(markup, 'data-project-tabs=""'))
        ).toContain("Asks5");
      })
  );

  it("says the commands its popovers give whole, each a real CLI command with its project", () => {
    const steps = textOf(
      <>
        <CloneSteps platformUrl={platformUrl} project={headerFacts.project} />
        <WatchSteps project={headerFacts.project} />
      </>
    );

    expect(
      allInOrder(steps, [
        `git clone ${platformUrl}/oscabriel/datekit.git`,
        `${Brand.cli} claim <ask> --project oscabriel/datekit`,
        `${Brand.cli} status --project oscabriel/datekit`,
      ])
    ).toBeTruthy();
    expect(
      commandDocs(Contracts)
        .filter(({ path }) => ["claim", "status"].includes(path.join(" ")))
        .map(({ flags, path }) => [path.join(" "), flags.includes("--project")])
    ).toStrictEqual([
      ["claim", true],
      ["status", true],
    ]);
  });
});

describe("the project's header as the server sends it", () => {
  it.effect(
    "takes its posture from the project's own ledger, never the list of projects",
    () =>
      Effect.gen(function* () {
        const listed = yield* Ref.make(0);

        const header = yield* headerFrom(
          "oscabriel/vellum",
          devWorldWith({ fixtures: "on" }, listed)
        );

        const head = headerOf(
          yield* framed("/oscabriel/vellum", header, null)
        );

        expect(yield* Ref.get(listed)).toBe(0);
        expect(head).toContain('data-posture="openWithSealedEvidence"');
        expect(head).toContain('title="Open with sealed evidence');
      }),
    seededWorld
  );

  it.effect(
    "says no posture while its own ledger is unread, never one it was not told",
    () =>
      Effect.gen(function* () {
        const { posture: _unread, ...header } = yield* headerFrom(
          "oscabriel/vellum",
          devWorldWith({ fixtures: "on" })
        );

        const markup = yield* framed("/oscabriel/vellum", header, null);

        expect(markup.match(/data-posture="/gu)?.length ?? 0).toBe(0);
      }),
    seededWorld
  );

  it.live("makes every read at once, none waiting on another", () =>
    Effect.gen(function* () {
      const header = yield* readProjectHeader("oscabriel/datekit").pipe(
        Effect.flatMap(decodeHeader),
        Effect.provide(answeringAtOnce),
        Effect.timeout(Duration.seconds(3))
      );

      expect(Object.keys(header).toSorted()).toStrictEqual(["now", "project"]);
    })
  );

  it.effect.each(["oscabriel/no-such-project", "Not_A_Project"])(
    "is a not-found for %s, so the page under it says why",
    (name) =>
      Effect.gen(function* () {
        const failed = yield* Effect.flip(
          readProjectHeader(name).pipe(Effect.provide(devWorld))
        );

        expect(isNotFound(failed)).toBeTruthy();
      }),
    seededWorld
  );
});

const vellum = ProjectName.make("oscabriel/vellum");

describe("a family child landing while the page is open", () => {
  it.live(
    "stamps nothing the first read holds, then stamps the child that landed, once, and moves the count",
    () =>
      Effect.gen(function* () {
        const world = devWorldWith({
          fixtures: "live",
          liveAfter: Duration.zero,
        });

        const [data, later] = yield* Effect.gen(function* () {
          const first = yield* readProjectPage("oscabriel/vellum").pipe(
            Effect.flatMap(decodePage)
          );

          const client = yield* Client;

          const second: readonly ProjectEvent[] = yield* Stream.runCollect(
            client.watch({ project: vellum, since: 0 })
          );

          return [first, second] as const;
        }).pipe(Effect.provide(world));

        const mounted = stampStep(undefined, data.events ?? []);
        const read = stampStep(mounted, later);
        const again = stampStep(read, later);

        expect([...mounted.stamped]).toStrictEqual([]);
        expect([...read.stamped]).toStrictEqual([
          "retire-old-tokenizer-vellum-lint",
        ]);
        expect(again.stamped).toBe(read.stamped);

        const before = rowOf(
          mainOf(yield* sentFrom(data, { stamps: mounted.stamped })),
          "retire-old-tokenizer"
        );

        const after = rowOf(
          mainOf(
            yield* sentFrom(
              { ...data, events: later },
              { stamps: read.stamped }
            )
          ),
          "retire-old-tokenizer"
        );

        expect({
          after: textIn(after).includes("3 of 6 landed"),
          before: textIn(before).includes("2 of 6 landed"),
          stampedAfter: after.match(/animate-stamp/gu)?.length,
          stampedBefore: before.includes("animate-stamp"),
        }).toStrictEqual({
          after: true,
          before: true,
          // The child's node in the fan, and its row in the list under it.
          stampedAfter: 2,
          stampedBefore: false,
        });
      }),
    seededWorld
  );
});

describe(UnknownProjectView, () => {
  it.effect(
    "shows the platform's UnknownProject refusal for a name that could be a project, and the way onward",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/no-such-project",
          <UnknownProjectView name="oscabriel/no-such-project" />
        );

        expect(markup).toContain('data-refusal="UnknownProject"');
        expect(markup).toContain("oscabriel/no-such-project");
        expect(markup).toMatch(/<a\b[^>]*href="\/asks"[^>]*>Open asks<\/a>/u);
      })
  );

  it.effect(
    "keeps the one-sentence not-found, and no offer, for a person's address",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/no-such",
          <UnknownProjectView name="oscabriel/no-such" />
        );

        expect(markup).toContain('data-refusal="UnknownProject"');
        expect(markup).not.toContain("<form");
        expect(offerFor("oscabriel/no-such")).toStrictEqual(Option.none());
      })
  );

  it("says in a sentence that an address naming no possible project names none", () => {
    const markup = markupOf(<UnknownProjectView name="Not_A_Project" />);

    expect(markup).not.toContain("data-refusal");
    expect(textOf(<UnknownProjectView name="Not_A_Project" />)).toContain(
      "No such project"
    );
  });
});

describe(ImportOffer, () => {
  const click = ProjectName.make("github.com/pallets/click");

  const offered = (handle: Option.Option<Handle>) =>
    renderAt(
      "/github.com/pallets/click",
      <ImportOffer importer={{ handle }} project={click} />
    );

  it("is what a source namespace's address offers, and no other", () => {
    expect(offerFor("github.com/pallets/click")).toStrictEqual(
      Option.some(click)
    );
    expect(offerFor("oscabriel/no-such")).toStrictEqual(Option.none());
    expect(offerFor("Not_A_Project")).toStrictEqual(Option.none());
  });

  it.effect(
    "draws the form prefilled from the address, the owner fixed and no refusal",
    () =>
      Effect.gen(function* () {
        const markup = yield* offered(Option.some(Handle.make("oscabriel")));

        expect(inputNamed(markup, "url")).toContain(
          'value="https://github.com/pallets/click"'
        );
        expect(inputNamed(markup, "owner")).toMatch(
          /type="hidden"[^>]*value="github\.com\/pallets"|value="github\.com\/pallets"[^>]*type="hidden"/u
        );
        expect(inputNamed(markup, "name")).toContain('value="click"');
        expect(markup).not.toContain('data-slot="select-trigger"');
        expect(markup).not.toContain("data-refusal");
      })
  );

  it.effect(
    "keeps the URL the address rebuilds read-only, and the branch and the name editable",
    () =>
      Effect.gen(function* () {
        const markup = yield* offered(Option.some(Handle.make("oscabriel")));

        expect(inputNamed(markup, "url")).toContain('readOnly=""');
        expect(inputNamed(markup, "branch")).not.toContain("readOnly");
        expect(inputNamed(markup, "name")).not.toContain("readOnly");
      })
  );

  it.effect(
    "signed out, says what would be imported, with the sign-in link back to the address",
    () =>
      Effect.gen(function* () {
        const markup = yield* offered(Option.none());

        expect(markup).not.toContain("<form");
        expect(markup).toContain(
          `href="/auth/signin?return=${encodeURIComponent("/github.com/pallets/click")}"`
        );
        expect(textIn(markup)).toContain("https://github.com/pallets/click");
      })
  );
});

describe("the project's views", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/project/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
    expect(reachingTransport(sources)).toStrictEqual([]);
  });
});
