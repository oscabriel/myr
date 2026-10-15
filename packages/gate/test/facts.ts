import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import { Policy, PolicyInput } from "@repo/protocol/domain/policy";
import { CommitSha, Handle, LandedSha, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";

import { PushTarget } from "../src/facts.ts";
import type { AddedLine, Change, PushFacts } from "../src/facts.ts";

// The gate takes no brand dependency, so the tests read the
// config folder's name where protocol's policy defaults put the vouch file.
const { vouch } = Schema.decodeSync(
  Schema.Struct({ vouch: PolicyInput.fields.vouch })
)({});

export const configDir = vouch.file.slice(0, vouch.file.indexOf("/"));

export const alice = Handle.make("alice");

export const bob = Handle.make("bob");

export const carol = Handle.make("carol");

export const dana = Handle.make("dana");

export const mallory = Handle.make("mallory");

export const base = CommitSha.make("1111111111111111111111111111111111111111");

export const head = CommitSha.make("2222222222222222222222222222222222222222");

export const main = CommitSha.make("3333333333333333333333333333333333333333");

const landedSha = "4444444444444444444444444444444444444444";

export const landed = LandedSha.make(CommitSha.make(landedSha));

export const checkPath = "packages/parse/test/iso-week.test.ts";

const parseModule = {
  module: "@datekit/parse",
  paths: ["packages/parse/**"],
  publicFiles: ["packages/parse/src/index.ts"],
} as const;

const formatModule = {
  module: "@datekit/format",
  paths: ["packages/format/**"],
  publicFiles: ["packages/format/src/index.ts"],
} as const;

const askWire = {
  askedBy: alice,
  blockedBy: [],
  brief: { want: "An ISO week date parses to the Monday of that week." },
  check: Schema.encodeSync(CheckSpec)(
    CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(checkPath) })
  ),
  file: `${configDir}/asks/iso-week.ask.ts`,
  id: "iso-week",
  kind: "fix",
  openedAt: "2026-10-07T12:00:00.000Z",
  openedIn: landedSha,
  project: "datekit",
  state: "claimed",
  territory: { ...parseModule, paths: ["packages/parse/**", "/package.json"] },
} as const;

export const ask = Schema.decodeSync(Ask)(askWire);

export const claim = Schema.decodeSync(ClaimView)({
  ask: askWire.id,
  base,
  checkCommand: `bun test ${checkPath}`,
  claimant: bob,
  fork: "datekit--iso-week--bob",
  lapsesAt: "2026-10-08T12:00:00.000Z",
  openedAt: "2026-10-07T12:00:00.000Z",
  project: askWire.project,
  remote: "https://platform.example/datekit--iso-week--bob.git",
  state: "live",
  warnsAt: "2026-10-07T14:00:00.000Z",
});

export const policy = Schema.decodeSync(Policy)({
  agents: "trailer",
  asks: [askWire],
  at: landedSha,
  caps: { claimsPerPerson: 3 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: [alice], paths: "**" }],
  decisions: { expireDays: 14 },
  functions: { admit: false },
  judge: {
    paths: [
      `${configDir}/**`,
      ".github/workflows/**",
      "vitest.config.*",
      ".env.*",
      "!.env.*.local",
    ],
    pointers: ["package.json#/scripts"],
  },
  kinds: [
    {
      checkKind: "redThenGreen",
      claimers: "vouched",
      finish: "optional",
      name: "fix",
      oneWay: false,
      race: 1,
      requires: ["want", "check", "territory"],
      strength: "assertion",
    },
  ],
  modules: [parseModule, formatModule],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: {
    checks: { lint: "bun run lint", unit: "bun run test" },
    doctor: "bun run doctor",
    test: "bun test {path}",
  },
  source: "config",
  vouch: { file: vouch.file, mode: "forCode" },
  vouches: [
    { denounced: false, handle: bob },
    { denounced: false, handle: carol },
    { denounced: true, handle: mallory, note: "spam" },
  ],
  weakening: { markers: [] },
});

export const modified = (...paths: readonly string[]): readonly Change[] =>
  paths.map((path) => ({ path: RepoPath.make(path), status: "modified" }));

export const addedLines = (
  ...lines: readonly (readonly [string, number, string])[]
): ReadonlyMap<RepoPath, readonly AddedLine[]> => {
  const byPath = new Map<RepoPath, AddedLine[]>();

  for (const [path, line, text] of lines) {
    const key = RepoPath.make(path);

    byPath.set(key, [...(byPath.get(key) ?? []), { line, text }]);
  }

  return byPath;
};

export const testFacts = (overrides: Partial<PushFacts> = {}): PushFacts => ({
  addedLines: addedLines([
    "packages/parse/src/week.ts",
    3,
    "export const isoWeek = 1;",
  ]),
  ask: Option.some(ask),
  base,
  changes: modified("packages/parse/src/week.ts"),
  claim: Option.some(claim),
  claimsHeld: 1,
  head,
  landed,
  layerPaths: new Set(),
  opensAsk: false,
  policy,
  pusher: Person.make({ handle: bob }),
  ref: RefNameText.make("refs/heads/main"),
  scriptsChanged: false,
  target: PushTarget.ClaimFork({
    ask: ask.id,
    claimant: bob,
    project: ask.project,
  }),
  ...overrides,
});

export const wire = (refusals: readonly Refusal[]) =>
  refusals.map((refusal) => Schema.encodeSync(Refusal)(refusal));
