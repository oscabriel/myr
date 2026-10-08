import { describe, expect, it } from "@effect/vitest";
import {
  Ledger,
  LedgerEntry,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import {
  AreaName,
  EnvKey,
  Handle,
  LayerName,
  ProjectName,
  SuiteRoot,
} from "@repo/protocol/ids";
import { DateTime, Option, Schema } from "effect";

import { entriesForPolicy, ledgerOf } from "../src/ledger.ts";

const project = ProjectName.make("datekit");

const at = DateTime.makeUnsafe("2026-10-11T09:00:00Z");

const layer = (
  name: string,
  holds: readonly string[],
  disclose = "sealed"
) => ({
  audience: "maintainers",
  disclose,
  holds,
  name,
  readers: "deciders",
  reason: "Held-back checks keep answers honest.",
  writers: "deciders",
});

const maintainers = layer("maintainers", ["checks", "notes"]);

const policy = (layers: readonly unknown[]) =>
  Schema.decodeUnknownSync(VisibilityPolicy)({
    checks: {
      areas: { export: "src/export/**" },
      attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
      canary: true,
      commit: "salted-sha256-merkle",
      layer: "maintainers",
      pin: "claim",
      result: "area-bit",
    },
    env: { setters: "deciders" },
    flows: { noWriteDown: true, release: "deciders" },
    layers,
    notice: { narrowingDays: 7 },
  });

const minute = (count: number) => DateTime.add(at, { minutes: count });

const exportArea = AreaName.make("export");

const maintainersLayer = LayerName.make("maintainers");

const valueSet = LedgerEntry.cases.ValueSet.make({
  at: minute(3),
  by: Handle.make("ines-v"),
  key: EnvKey.make("SENTRY_AUTH_TOKEN"),
  seq: 4,
});

const rows: readonly LedgerEntry[] = [
  LedgerEntry.cases.CommitmentPublished.make({
    area: exportArea,
    at: minute(2),
    authors: 3,
    checks: 7,
    seq: 3,
    suite: SuiteRoot.make(`sha256:${"3f9a".repeat(16)}`),
  }),
  LedgerEntry.cases.LayerDeclared.make({
    at,
    disclose: "sealed",
    kinds: ["checks", "notes"],
    layer: maintainersLayer,
    seq: 1,
  }),
  valueSet,
  LedgerEntry.cases.CountChanged.make({
    area: exportArea,
    at: minute(1),
    count: 7,
    layer: maintainersLayer,
    seq: 2,
  }),
];

const mit = Option.some("MIT");

describe("a project's ledger", () => {
  it("lists every row in sequence order, with the posture computed from the config", () => {
    const visibility = policy([maintainers]);

    const ledger = ledgerOf({
      licence: mit,
      project,
      rows,
      visibility: Option.some(visibility),
    });

    expect(ledger.entries.map(({ seq }) => seq)).toStrictEqual([1, 2, 3, 4]);
    expect(ledger.entries.map(({ _tag }) => _tag)).toStrictEqual([
      "LayerDeclared",
      "CountChanged",
      "CommitmentPublished",
      "ValueSet",
    ]);
    expect(ledger).toStrictEqual({
      entries: rows.toSorted((left, right) => left.seq - right.seq),
      layers: visibility.layers,
      posture: "openWithSealedEvidence",
      postureLabel: "Open with sealed evidence · sealed checks in export",
      project,
    });
  });

  it("drops no row, even two under one number", () => {
    const twice = [...rows, ...rows];

    expect(
      ledgerOf({
        licence: mit,
        project,
        rows: twice,
        visibility: Option.none(),
      }).entries
    ).toHaveLength(8);
  });

  it("is Open and empty for a project with no config and no rows", () => {
    expect(
      ledgerOf({ licence: mit, project, rows: [], visibility: Option.none() })
    ).toStrictEqual({
      entries: [],
      layers: [],
      posture: "open",
      postureLabel: "Open",
      project,
    });
  });

  it("takes the licence into the posture", () => {
    const ledger = ledgerOf({
      licence: Option.some("BUSL-1.1"),
      project,
      rows,
      visibility: Option.some(policy([maintainers])),
    });

    expect([ledger.posture, ledger.postureLabel]).toStrictEqual([
      "sourceAvailable",
      "Source available",
    ]);
  });

  // A value set is recorded by who and when, never by the value: the schema
  // has no field for it, so even a row that carries one encodes without it.
  it("encodes a value set as who and when, and nothing more", () => {
    const smuggled = { ...valueSet, value: "hunter2-is-not-a-token" };

    const encoded = Schema.encodeSync(Ledger)(
      ledgerOf({
        licence: mit,
        project,
        rows: [smuggled],
        visibility: Option.none(),
      })
    );

    expect(
      encoded.entries.map((each) => Object.keys(each).toSorted())
    ).toStrictEqual([["_tag", "at", "by", "key", "seq"]]);
    expect(JSON.stringify(encoded)).not.toContain("hunter2");
  });
});

describe("the ledger entries a config change writes", () => {
  const security = layer("security", ["fix"], "counted");

  it("declares each new layer, sorted by name and numbered from the next sequence number", () => {
    expect(
      entriesForPolicy(
        Option.none(),
        Option.some(policy([security, maintainers])),
        5,
        at
      )
    ).toStrictEqual([
      LedgerEntry.cases.LayerDeclared.make({
        at,
        disclose: "sealed",
        kinds: ["checks", "notes"],
        layer: LayerName.make("maintainers"),
        seq: 5,
      }),
      LedgerEntry.cases.LayerDeclared.make({
        at,
        disclose: "counted",
        kinds: ["fix"],
        layer: LayerName.make("security"),
        seq: 6,
      }),
    ]);
  });

  it("declares only the layers the change adds", () => {
    expect(
      entriesForPolicy(
        Option.some(policy([maintainers])),
        Option.some(policy([maintainers, security])),
        9,
        at
      ).map((each) => [each._tag, each.seq, "layer" in each ? each.layer : ""])
    ).toStrictEqual([["LayerDeclared", 9, "security"]]);
  });

  it("declares a layer again when what it holds or discloses changes", () => {
    expect(
      entriesForPolicy(
        Option.some(policy([maintainers])),
        Option.some(
          policy([layer("maintainers", ["checks", "notes", "source"])])
        ),
        2,
        at
      ).map((each) => [each._tag, "kinds" in each ? each.kinds : []])
    ).toStrictEqual([["LayerDeclared", ["checks", "notes", "source"]]]);
    expect(
      entriesForPolicy(
        Option.some(policy([maintainers])),
        Option.some(
          policy([layer("maintainers", ["checks", "notes"], "counted")])
        ),
        2,
        at
      )
    ).toHaveLength(1);
  });

  it("writes nothing when the layers stay, or only leave", () => {
    expect(
      entriesForPolicy(
        Option.some(policy([maintainers, security])),
        Option.some(policy([security, maintainers])),
        2,
        at
      )
    ).toStrictEqual([]);
    expect(
      entriesForPolicy(Option.some(policy([maintainers])), Option.none(), 2, at)
    ).toStrictEqual([]);
    expect(entriesForPolicy(Option.none(), Option.none(), 1, at)).toStrictEqual(
      []
    );
  });
});
