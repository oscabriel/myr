/**
 * A project's ledger, rendered to HTML with `react-dom/server` from fixtures
 * decoded with the protocol's own schemas: the posture label, each declared
 * layer, each sealed area folded from the entries (count, authors, root,
 * admission), and the entries newest first. The ledger carries no path, no
 * check name and no file name, and the view adds none.
 */
import { describe, expect, it } from "@effect/vitest";
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
import { DateTime, Option, Schema } from "effect";

import {
  LedgerView,
  areaSummaries,
} from "../src/features/ledger/ledger-page.tsx";
import { ProjectView } from "../src/features/project/project-page.tsx";
import { inOrder, markupOf, textOf } from "./ask-fixtures.ts";

const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const root = SuiteRoot.make(`sha256:3f9a${"0b1c".repeat(15)}`);

const earlierRoot = SuiteRoot.make(`sha256:${"9e8d".repeat(16)}`);

const exportArea = AreaName.make("export");

const maintainers = LayerName.make("maintainers");

const decodeLedger = Schema.decodeSync(Ledger);

/** The ledger's own fields, decoded from the wire as `ledger` returns them. */
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

/** Its entries, each made (and checked) by the protocol's own constructors. */
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

/** datekit's ledger once its maintainers layer holds the `export` suite. */
const datekit: Ledger = { ...datekitRead, entries };

/** A project with no visibility config: the platform's neutral ledger. */
const open = decodeLedger({
  entries: [],
  layers: [],
  posture: "open",
  postureLabel: "Open",
  project: "burrow",
});

const page = <LedgerView ledger={datekit} now={now} />;

/** The entries' sequence numbers, in the order the page lists them. */
const seqsOf = (markup: string) =>
  [...markup.matchAll(/data-seq="(?<seq>\d+)"/gu)].map((found) =>
    Number(found.groups?.seq)
  );

describe("a project's ledger", () => {
  it("shows the posture label the platform computed", () => {
    const markup = markupOf(page);

    expect(markup).toContain('data-posture="openWithSealedEvidence"');
    expect(textOf(page)).toContain("Open with sealed evidence");
  });

  it("shows each declared layer with its audience, kinds, disclosure and reason", () => {
    const text = textOf(page);

    expect(
      inOrder(text, [
        "maintainers",
        "Audience",
        "maintainers",
        "Holds",
        "checks, agent-config, notes",
        "Disclosure",
        "sealed",
        "Reason",
        "Held-back checks judge an answer by the ask's words, not by tests it could read.",
      ])
    ).toBeTruthy();
  });

  it("shows each sealed area's count, authors, root and admission record", () => {
    const text = textOf(page);

    expect(text).toContain("export: 7 sealed checks by 3 people");
    expect(text).toContain(root);
    expect(text).toContain(
      "admitted Oct 11; passes main 3/3; catches 2 known-bad"
    );
  });

  it("lists the entries newest first, each in the ledger's words", () => {
    const text = textOf(page);

    expect(seqsOf(markupOf(page))).toStrictEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(inOrder(text, ["ines-v", "set", "SENTRY_AUTH_TOKEN"])).toBeTruthy();
    expect(
      inOrder(text, ["okonkwo", "released 2 paths", "9b1c3e5"])
    ).toBeTruthy();
    expect(
      inOrder(text, ["Posture changed", "Open", "Open with sealed evidence"])
    ).toBeTruthy();
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

  it("shows a project without layers as Open, with nothing held back", () => {
    const text = textOf(<LedgerView ledger={open} now={now} />);

    expect(text).toContain("Open");
    expect(text).toContain("Nothing is held back");
    expect(text).not.toContain("sealed checks by");
  });
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
        ...entries,
        LedgerEntry.cases.CommitmentPublished.make({
          area: exportArea,
          at: DateTime.makeUnsafe("2026-10-12T09:00:00.000Z"),
          authors: 3,
          checks: 8,
          seq: 9,
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
      /<a\b[^>]*href="\/datekit\/ledger"[^>]*>Ledger<\/a>/u
    );
  });
});

describe("the ledger and env views", () => {
  // Views only: props in, markup out, and outside the visibility cartridge,
  // so the web reads only what the public contracts return.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/{ledger,env}/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const reaching =
    /from\s+["'](?:@repo\/visibility[^"']*|@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

  it("import no transport and nothing from the visibility cartridge", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);

    expect(
      Object.entries(sources).flatMap(([path, source]) =>
        reaching.test(source) ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
