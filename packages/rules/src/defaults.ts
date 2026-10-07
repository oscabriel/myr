import { FromCI, PolicyInput } from "@repo/protocol/domain/policy";
import { Schema } from "effect";

// The Effect language service reads its directive's name anywhere in a
// source, string literals included, so the marker is joined at run time.
const effectDirective = ["@effect", "diagnostics"].join("-");

/**
 * The markers that disable a check when an answer adds them (spec §4.2
 * `packages/gate`); a project may add its own.
 */
const weakeningMarkers = [
  ".skip(",
  ".only(",
  ".todo(",
  "eslint-disable",
  "oxlint-disable",
  "biome-ignore",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  effectDirective,
  "# noqa",
  "# type: ignore",
  "#[allow(",
  "//nolint",
  "istanbul ignore",
  "c8 ignore",
];

/**
 * The policy a project with no config folder runs on (convex-merged design
 * §3, "no folder means defaults"): one `fix` kind whose asks a vouched person
 * claims, the run block found in the project's CI, the initializer deciding
 * everything (spec D20), and the default weakening markers. The rest is
 * `PolicyInput`'s own defaults: five decisions a day that wait 14 days, two
 * proposals and three claims per person, a claim warned after 2 hours and
 * lapsed after 24, a vouch for code in the config folder's `vouched.td`,
 * `Assisted-by` trailers, and a record that counts after 30 days for a year.
 */
export const defaultPolicyInput: PolicyInput = Schema.decodeSync(PolicyInput)({
  asks: [],
  deciders: [{ handles: "owners", paths: "**" }],
  functions: { admit: false, opensAlone: false },
  kinds: [
    {
      checkKind: "redThenGreen",
      claimers: "vouched",
      finish: "optional",
      name: "fix",
      oneWay: false,
      race: 1,
      requires: ["want", "check"],
      strength: "assertion",
    },
  ],
  ratchets: [],
  run: FromCI.make({}),
  source: "defaults",
  weakening: { markers: weakeningMarkers },
});
