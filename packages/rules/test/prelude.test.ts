import { describe, expect, it } from "@effect/vitest";

import {
  installFrozenGlobals,
  mainModule,
  preludeModule,
} from "../src/prelude.ts";
import type { FreezableScope, FrozenFacts } from "../src/prelude.ts";

const facts: FrozenFacts = { now: 1_791_374_400_000, seed: 7 };

/**
 * mulberry32 seeded with 7, worked out from the published algorithm apart
 * from the code under test: the first eight numbers it gives.
 */
const seven = [
  0.011704753153026104, 0.06195825757458806, 0.97690763277933,
  0.6990287057124078, 0.5214452685322613, 0.4055216880515218,
  0.4662326325196773, 0.23992518591694534,
];

/**
 * A scope of the test's own, so the test process keeps its real clock: its
 * `Date` has a prototype of its own, and its randomness answers 0.5.
 */
const scopeOf = (): FreezableScope => ({
  Date: class extends Date {},
  Math: { random: () => 0.5 },
  crypto: {
    getRandomValues: (array) => array,
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
  },
  performance: { now: () => 1 },
});

const draws = (seed: number) => {
  const scope = scopeOf();

  installFrozenGlobals(scope, { ...facts, seed });

  return {
    bytes: [...scope.crypto.getRandomValues(new Uint32Array(2))],
    uuid: scope.crypto.randomUUID(),
  };
};

const UUID_V4 =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

describe(installFrozenGlobals, () => {
  it("gives the scope the facts' clock", () => {
    const scope = scopeOf();

    installFrozenGlobals(scope, facts);

    expect({
      constructed: new scope.Date().toISOString(),
      dated: new scope.Date(0).toISOString(),
      now: scope.Date.now(),
      performance: scope.performance.now(),
      throughConstructor: new scope.Date().constructor === scope.Date,
    }).toStrictEqual({
      constructed: "2026-10-07T12:00:00.000Z",
      // A date that names its own time is left alone.
      dated: "1970-01-01T00:00:00.000Z",
      now: 1_791_374_400_000,
      performance: 0,
      // A date's own constructor leads back to the frozen clock.
      throughConstructor: true,
    });
  });

  it("leaves no way back to the scope's own clock", () => {
    const scope = scopeOf();
    const own = scope.Date;

    installFrozenGlobals(scope, facts);

    expect({
      // A date the runtime makes itself (`structuredClone` does) is the
      // scope's own Date's: its constructor is the frozen one too.
      madeByTheRuntime: new own(0).constructor === scope.Date,
      // The frozen Date shares its dates' prototype, so nothing of the
      // scope's own sits above it.
      oneDatePrototype: scope.Date.prototype === own.prototype,
      ownNow: own.now(),
    }).toStrictEqual({
      madeByTheRuntime: true,
      oneDatePrototype: true,
      ownNow: 1_791_374_400_000,
    });
  });

  it("gives the scope randomness seeded from the facts", () => {
    const scope = scopeOf();

    installFrozenGlobals(scope, facts);

    const numbers = [
      scope.Math.random(),
      scope.Math.random(),
      scope.Math.random(),
    ];

    // Each byte is the next number, times 256, rounded down.
    const bytes = [...scope.crypto.getRandomValues(new Uint8Array(4))];

    expect({ bytes, numbers }).toStrictEqual({
      bytes: [178, 133, 103, 119],
      numbers: seven.slice(0, 3),
    });
  });

  it("gives every install with the same seed the same randomness", () => {
    const first = draws(7);

    expect(draws(7)).toStrictEqual(first);
    expect(draws(8)).not.toStrictEqual(first);
    expect(first.uuid).toMatch(UUID_V4);
  });

  it("starts every job's code from where the first settled", () => {
    const scope = scopeOf();
    const frozen = installFrozenGlobals(scope, facts);

    // Loading the modules draws once; then each job starts from there.
    scope.Math.random();
    frozen.settle();
    const first = scope.Math.random();
    scope.Math.random();
    frozen.settle();
    const second = scope.Math.random();

    expect([first, second]).toStrictEqual([seven[1], seven[1]]);
  });
});

describe(preludeModule, () => {
  it("holds the installer and the facts as JSON, and nothing else", () => {
    const source = preludeModule(facts)
      .replace(String(installFrozenGlobals), "<installFrozenGlobals>")
      .replace('{"now":1791374400000,"seed":7}', "<facts>");

    expect(source).toBe(
      "export const frozen = (<installFrozenGlobals>)(globalThis, <facts>);\n"
    );
  });
});

describe(mainModule, () => {
  it("imports the prelude before anything else", () => {
    const source = mainModule({
      asks: [".cfg/asks/a.ask.ts"],
      project: ".cfg/project.ts",
    });

    const imports = [
      ...source.matchAll(
        /\bimport\s*(?:\(\s*|[^"'()]*?from\s*)(?<quote>["'])(?<specifier>[^"']+)\k<quote>/gu
      ),
    ].map((match) => match.groups?.specifier);

    expect(imports).toStrictEqual([
      "./prelude.js",
      "./.cfg/project.ts",
      "./.cfg/asks/a.ask.ts",
    ]);
  });
});
