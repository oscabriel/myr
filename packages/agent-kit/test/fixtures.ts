import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command } from "@repo/protocol/domain/common";
import type { AskKind } from "@repo/protocol/domain/kind";
import { Policy } from "@repo/protocol/domain/policy";
import { LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Schema } from "effect";

import type { CommandDoc } from "../src/command-doc.ts";

export const project = ProjectName.make("oscabriel/datekit");

export const landed = LandedSha.make("a".repeat(40));

export const later = LandedSha.make("b".repeat(40));

const encodeCheck = Schema.encodeSync(CheckSpec);

const fix: typeof AskKind.Encoded = {
  checkKind: "redThenGreen",
  claimers: "vouched",
  finish: "optional",
  name: "fix",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
};

const lint: typeof AskKind.Encoded = {
  checkKind: "lintToZero",
  claimers: "anyone",
  finish: "never",
  name: "lint",
  oneWay: false,
  race: 2,
  requires: ["want", "check"],
  strength: "assertion",
};

const parse = { module: "parse", paths: ["packages/parse/**"] } as const;

const format = { module: "format", paths: ["packages/format/**"] } as const;

const askedBy = "alice";

const openedAt = "2026-10-07T12:00:00.000Z";

const encoded: typeof Policy.Encoded = {
  agents: "trailer",
  asks: [
    {
      askedBy,
      blockedBy: [],
      brief: { want: "Parsing an ISO week date gives that week's Monday." },
      check: encodeCheck(
        CheckSpec.cases.RedThenGreen.make({
          path: RepoPath.make("packages/parse/test/iso-week.test.ts"),
        })
      ),
      file: `${Brand.configDir}/asks/iso-week.ask.ts`,
      id: "iso-week",
      kind: "fix",
      openedAt,
      openedIn: landed,
      project,
      state: "open",
      territory: parse,
    },
    {
      askedBy,
      blockedBy: [],
      brief: {
        want: "Formatting a day of the month gives its English ordinal.",
      },
      check: encodeCheck(
        CheckSpec.cases.RedThenGreen.make({
          path: RepoPath.make("packages/format/test/ordinal.test.ts"),
        })
      ),
      file: `${Brand.configDir}/asks/ordinals.ask.ts`,
      id: "ordinals",
      kind: "fix",
      openedAt,
      openedIn: landed,
      project,
      state: "claimed",
      territory: format,
    },
    {
      askedBy,
      blockedBy: [],
      brief: { want: "The format module has no explicit any." },
      check: encodeCheck(
        CheckSpec.cases.LintToZero.make({
          command: Command.make("bunx oxlint --format json"),
          rule: "typescript/no-explicit-any",
          territory: "format",
        })
      ),
      file: `${Brand.configDir}/asks/no-any.ask.ts`,
      id: "no-any",
      kind: "lint",
      openedAt,
      openedIn: landed,
      project,
      state: "open",
      territory: format,
    },
  ],
  at: landed,
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: [askedBy], paths: "**" }],
  functions: { admit: false, opensAlone: false },
  judge: {
    paths: [`${Brand.configDir}/**`, "bunfig.toml", "tsconfig.json"],
    pointers: ["package.json#/scripts"],
  },
  kinds: [fix, lint],
  modules: [
    { ...parse, publicFiles: ["packages/parse/src/index.ts"] },
    { ...format, publicFiles: ["packages/format/src/index.ts"] },
  ],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: {
    checks: {
      lint: "bun run lint",
      types: "bun run typecheck",
      unit: "bun test",
    },
    test: "bun test {path}",
  },
  source: "config",
  vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
  vouches: [],
  weakening: { markers: [".skip(", ".only(", "@ts-ignore"] },
};

export const policy = Schema.decodeSync(Policy)(encoded);

export const policyWithNewLint = Schema.decodeSync(Policy)({
  ...encoded,
  run: {
    ...encoded.run,
    checks: { ...encoded.run.checks, lint: "bunx oxlint --deny-warnings" },
  },
});

// Hand-written, so a contract's wording changing elsewhere leaves the golden files alone.
export const commands: readonly CommandDoc[] = [
  {
    contract: "listAsks",
    flags: ["--project", "--json"],
    needsApproval: false,
    path: ["asks"],
    positional: [],
    readOnly: true,
    source: "contract",
    summary: "List a project's open asks.",
  },
  {
    contract: "claim",
    flags: ["--project", "--json", "--dry-run"],
    needsApproval: false,
    path: ["claim"],
    positional: ["ask"],
    readOnly: false,
    source: "contract",
    summary:
      "Claim an ask: an exclusive, expiring right to answer it, with a fork to push to; claiming it again returns the same claim.",
  },
  {
    contract: "vouch",
    flags: [
      "--project",
      "--handle",
      "--verdict",
      "--note",
      "--json",
      "--yes",
      "--dry-run",
    ],
    needsApproval: true,
    path: ["vouch"],
    positional: [],
    readOnly: false,
    source: "contract",
    summary:
      "Vouch for a person, or denounce them, by landing a line in the project's vouch file.",
  },
  {
    flags: ["--ask", "--project", "--base", "--json"],
    needsApproval: false,
    path: ["check"],
    positional: [],
    readOnly: true,
    source: "local",
    summary: "Run the gate's checks on your answer locally, before you push.",
  },
];

export const platformUrl = `https://${Brand.domain}`;
