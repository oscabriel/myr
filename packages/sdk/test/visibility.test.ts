import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import {
  LayerManifest,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import { Schema } from "effect";

import {
  deciders,
  defaults,
  embargo,
  flows,
  layer,
  layerManifest,
  personal,
  sealedChecks,
  visibility,
} from "../src/index.ts";
import type { AreaOf, SealedCheckInput } from "../src/index.ts";

const decodePolicy = Schema.decodeUnknownSync(VisibilityPolicy);

const decodeManifest = Schema.decodeUnknownSync(LayerManifest);

// One held-back check as a layer's manifest lists it.
const exportCheck = {
  area: "export",
  author: "alice",
  clause: {
    quote: "Every export format escapes a title it writes.",
    ref: "export-escapes-titles",
    source: "ask",
  },
  path: "checks/export/escapes-titles.test.ts",
} as const;

// OSR §4.1's `visibility.ts` as the platform reads it: every default the
// example leaves unsaid is filled, and nothing names a path or a check.
const osrPolicy = {
  checks: {
    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
    areas: { export: "src/export/**", parser: "src/parser/**" },
    attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
    canary: true,
    commit: "salted-sha256-merkle",
    layer: "maintainers",
    pin: "claim",
    result: "area-bit",
  },
  env: { setters: "deciders" },
  flows: { noWriteDown: true, release: "deciders" },
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks", "agent-config", "notes", "experiment"],
      name: "maintainers",
      readers: "deciders",
      reason:
        "Held-back checks for parser and export; maintainers' review rubrics",
      sunsetDays: 30,
      writers: "deciders",
    },
    {
      audience: "personal",
      disclose: "hidden",
      holds: ["personal"],
      name: "personal",
      readers: "deciders",
      reason:
        "Each person's own agent and tool configuration, for them and their agents only",
      writers: "deciders",
    },
    {
      audience: "security",
      disclose: "counted",
      holds: ["fix"],
      maxDays: 14,
      name: "security",
      readers: ["alice", "bob"],
      reason: "Embargoed fixes, released with their advisory",
      writers: "deciders",
    },
  ],
  notice: { narrowingDays: 7 },
};

describe("the config folder's visibility file", () => {
  it("encodes OSR's example to the policy the platform reads", () => {
    const definition = visibility({
      checks: sealedChecks({
        admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
        areas: { export: "src/export/**", parser: "src/parser/**" },
        attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
        canary: true,
      }),
      flows: flows.noWriteDown({ release: deciders }),
      layers: {
        maintainers: layer({
          disclose: "sealed",
          holds: ["checks", "agent-config", "notes", "experiment"],
          readers: deciders,
          reason:
            "Held-back checks for parser and export; maintainers' review rubrics",
          sunset: { experiment: "30 days" },
          writers: deciders,
        }),
        personal: personal(),
        security: embargo({
          disclose: "counted",
          maxDays: 14,
          readers: ["alice", "bob"],
        }),
      },
      notice: { narrowing: "7 days" },
    });

    expect(definition).toStrictEqual(osrPolicy);
    expect(decodePolicy(definition)).toStrictEqual(osrPolicy);
  });

  it("fills every default OSR's example spells out", () => {
    const definition = visibility({
      checks: sealedChecks({
        areas: { export: "src/export/**", parser: "src/parser/**" },
        canary: true,
      }),
      layers: {
        maintainers: layer({
          disclose: "sealed",
          holds: ["checks", "agent-config", "notes", "experiment"],
          reason:
            "Held-back checks for parser and export; maintainers' review rubrics",
          sunset: { experiment: "30 days" },
        }),
        personal: personal(),
        security: embargo({
          disclose: "counted",
          maxDays: 14,
          readers: ["alice", "bob"],
        }),
      },
    });

    expect(definition).toStrictEqual(osrPolicy);
  });

  it("declares an embargo and the personal layer as config alone: no repo, no held-back checks", () => {
    const definition = visibility({
      layers: {
        personal: personal(),
        security: embargo({
          disclose: "counted",
          maxDays: 14,
          readers: ["alice"],
        }),
      },
    });

    expect(decodePolicy(definition)).toStrictEqual({
      env: { setters: "deciders" },
      flows: { noWriteDown: true, release: "deciders" },
      layers: [
        {
          audience: "personal",
          disclose: "hidden",
          holds: ["personal"],
          name: "personal",
          readers: "deciders",
          reason:
            "Each person's own agent and tool configuration, for them and their agents only",
          writers: "deciders",
        },
        {
          audience: "security",
          disclose: "counted",
          holds: ["fix"],
          maxDays: 14,
          name: "security",
          readers: ["alice"],
          reason: "Embargoed fixes, released with their advisory",
          writers: "deciders",
        },
      ],
      notice: { narrowingDays: 7 },
    });
  });

  it("writes plain data: JSON carries it whole", () => {
    const definition = visibility({
      checks: sealedChecks({ areas: { export: "src/export/**" } }),
      layers: {
        maintainers: layer({
          disclose: "sealed",
          holds: ["checks"],
          reason: "Held-back checks for export",
        }),
      },
    });

    // The rules evaluator hands a module's default export back as JSON.
    const carried = JSON.stringify(definition);

    expect(JSON.parse(carried)).toStrictEqual(definition);
    expect(Object.getOwnPropertySymbols(definition)).toStrictEqual([]);
  });

  it("fails at the call when the held-back checks' layer is not declared, or holds no checks", () => {
    const checks = sealedChecks({ areas: { export: "src/export/**" } });

    const notes = layer({
      disclose: "declared",
      holds: ["notes"],
      reason: "Maintainers' notes on asks",
    });

    expect(() => visibility({ checks, layers: {} })).toThrow(
      /no declared layer "maintainers" holds checks/u
    );
    expect(() =>
      visibility({ checks, layers: { maintainers: notes } })
    ).toThrow(/no declared layer "maintainers" holds checks/u);
  });

  it("fails at the call with a Schema issue when an area's name is no area name", () => {
    expect(() =>
      sealedChecks({ areas: { "Export Formats": "src/export/**" } })
    ).toThrow(Schema.SchemaError);
  });

  it("leaves the no-folder defaults without visibility: Open", () => {
    expect(defaults).not.toHaveProperty("visibility");
  });
});

describe("a layer's manifest", () => {
  it("encodes each held-back check with its area, clause and author", () => {
    const definition = layerManifest({
      checks: [exportCheck],
      knownBad: [],
      layer: "maintainers",
    });

    const expected = {
      checks: [exportCheck],
      knownBad: [],
      layer: "maintainers",
    };

    expect(definition).toStrictEqual(expected);
    expect(decodeManifest(definition)).toStrictEqual(expected);
  });

  it("names no known-bad commit unless told", () => {
    expect(
      layerManifest({ checks: [exportCheck], layer: "maintainers" })
    ).toStrictEqual({
      checks: [exportCheck],
      knownBad: [],
      layer: "maintainers",
    });
  });
});

// What the maintainer's editor refuses before anything runs.
describe("the builders' types", () => {
  it("holds a manifest's checks to the areas the held-back checks name", () => {
    const checks = sealedChecks({ areas: { export: "src/export/**" } });

    const policy = visibility({
      checks,
      layers: {
        maintainers: layer({
          disclose: "sealed",
          holds: ["checks"],
          reason: "Held-back checks for export",
        }),
      },
    });

    expectTypeOf<AreaOf<typeof checks>>().toEqualTypeOf<"export">();
    expectTypeOf<AreaOf<typeof policy>>().toEqualTypeOf<"export">();

    type Manifest = Parameters<typeof layerManifest<AreaOf<typeof policy>>>[0];

    expectTypeOf({
      checks: [exportCheck],
      layer: "maintainers",
    } as const).toExtend<Manifest>();
    expectTypeOf({
      checks: [{ ...exportCheck, area: "parser" }],
      layer: "maintainers",
    } as const).not.toExtend<Manifest>();
  });

  it("requires each held-back check to cite a clause", () => {
    expectTypeOf(exportCheck).toExtend<SealedCheckInput<"export">>();
    expectTypeOf<Omit<typeof exportCheck, "clause">>().not.toExtend<
      SealedCheckInput<"export">
    >();
  });

  it("takes only the kinds a layer can hold", () => {
    type Holds = Parameters<typeof layer>[0]["holds"];

    expectTypeOf<readonly ["checks", "notes"]>().toExtend<Holds>();
    expectTypeOf<readonly ["nonsense"]>().not.toExtend<Holds>();
  });
});
