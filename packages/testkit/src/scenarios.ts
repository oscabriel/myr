/**
 * Scenario builders: a project, its people and its policy as plain values,
 * built the same way every run. `aProject()` starts one; `withAsk`, `withKind`
 * and `withVouches` add to it in a pipe; `sixChildren()` is the migrate family
 * six agents claim at once (CAA §2.F).
 *
 * Values, not services: every builder is a pure function. None reads the
 * clock or randomness; time comes from `now` (default `2026-10-07T12:00:00Z`)
 * and ids from counters. Each value is decoded with the domain's own schema
 * as it is built, so a scenario the domain would refuse throws here.
 *
 * Like everything in `@repo/testkit`, this module is for `test/` directories
 * only: no `src/` imports it.
 */
import { Brand } from "@repo/brand";
import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import { AskKind } from "@repo/protocol/domain/kind";
import { Policy } from "@repo/protocol/domain/policy";
import { Territory } from "@repo/protocol/domain/territory";
import {
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProjectName,
  ProposalId,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { Array as Arr, DateTime, Pipeable, Schema } from "effect";
import type { Types } from "effect";

import { defaultNow } from "./clock.ts";

/** An ask kind as a test writes it, before decoding. */
export type AskKindEncoded = typeof AskKind.Encoded;

/** A project at one landed commit, with the people a test acts as. */
export interface Scenario extends Pipeable.Pipeable {
  readonly project: ProjectName;
  /** The person who made the project; the first decider. */
  readonly initializer: Handle;
  readonly policy: Policy;
  readonly landed: LandedSha;
  /** Everyone in the scenario by the name the test gave them, deciders first. */
  readonly people: ReadonlyMap<string, Handle>;
  /** When the scenario's asks opened. */
  readonly now: DateTime.Utc;
}

type ScenarioFields = Omit<Scenario, "pipe">;

// A class only for `pipe`: its fields are its own, so `Equal.equals` compares
// two scenarios by what they hold.
class Built extends Pipeable.Class implements Scenario {
  readonly project: ProjectName;
  readonly initializer: Handle;
  readonly policy: Policy;
  readonly landed: LandedSha;
  readonly people: ReadonlyMap<string, Handle>;
  readonly now: DateTime.Utc;

  constructor(fields: ScenarioFields) {
    super();
    this.project = fields.project;
    this.initializer = fields.initializer;
    this.policy = fields.policy;
    this.landed = fields.landed;
    this.people = fields.people;
    this.now = fields.now;
  }
}

const withPolicy = (scenario: Scenario, policy: Policy): Scenario =>
  new Built({ ...scenario, policy });

const WORD = 2 ** 32;

/**
 * `word` with its low byte exclusive-ored with `byte`, in arithmetic: lint
 * keeps bitwise operators out of the codebase, and FNV needs only this one.
 */
const xorLowByte = (word: number, byte: number) => {
  const low = word % 256;
  let mixed = 0;

  for (let place = 1; place < 256; place *= 2) {
    const ours = Math.floor(low / place) % 2;
    const theirs = Math.floor(byte / place) % 2;

    mixed += ours === theirs ? 0 : place;
  }

  return word - low + mixed;
};

/** FNV-1a (32-bit) over the UTF-8 bytes of `text`, as eight hex digits. */
const fnv1a = (text: string) => {
  let hash = 0x81_1c_9d_c5;

  for (const byte of new TextEncoder().encode(text)) {
    // `Math.imul` multiplies modulo 2^32, signed; the remainder makes it unsigned.
    hash = (Math.imul(xorLowByte(hash, byte), 0x01_00_01_93) + WORD) % WORD;
  }

  return hash.toString(16).padStart(8, "0");
};

/**
 * A commit id made from a seed: FNV-1a over `0:<seed>` … `4:<seed>`, so the
 * same seed always gives the same 40 hex digits (FNV, not crypto).
 */
export const sha = (seed: string): CommitSha =>
  CommitSha.make(
    [0, 1, 2, 3, 4].map((round) => fnv1a(`${round}:${seed}`)).join("")
  );

/** `prefix-000001`, `prefix-000002`, …: one counter per call of `ids()`. */
const counter = (prefix: string) => {
  let next = 0;

  return () => {
    next += 1;

    return `${prefix}-${String(next).padStart(6, "0")}`;
  };
};

/**
 * Fresh counters for the ids a project mints: `req-000001`, `prop-000001`,
 * `dec-000001`. Each call starts again at 1.
 */
export const ids = () => {
  const request = counter("req");
  const proposal = counter("prop");
  const decision = counter("dec");

  return {
    decision: () => DecisionId.make(decision()),
    proposal: () => ProposalId.make(proposal()),
    request: () => RequestId.make(request()),
  };
};

const fix: AskKindEncoded = {
  checkKind: "redThenGreen",
  claimers: "vouched",
  finish: "optional",
  name: "fix",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
};

const migrate: AskKindEncoded = {
  checkKind: "migrate",
  claimers: "vouched",
  finish: "never",
  name: "migrate",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
};

const decodePolicy = Schema.decodeSync(Policy);

const decodeAsk = Schema.decodeSync(Ask);

const decodeKind = Schema.decodeSync(AskKind);

const decodeTerritory = Schema.decodeSync(Territory);

const encodeTerritory = Schema.encodeSync(Territory);

const encodeCheck = Schema.encodeSync(CheckSpec);

/**
 * A project at its first landed commit: the defaults the config folder
 * leaves out (spec §2.5), the kinds `fix` and `migrate`, and its deciders
 * (default `alice`) deciding everything (D20). `people` are everyone else.
 */
export const aProject = (
  options: {
    readonly name?: string;
    readonly now?: DateTime.Utc;
    readonly deciders?: readonly string[];
    readonly people?: readonly string[];
  } = {}
): Scenario => {
  const name = options.name ?? "datekit";
  const [first = "alice", ...more] = options.deciders ?? [];
  const deciders = [first, ...more] as const;
  const landed = LandedSha.make(sha(`${name}:landed`));

  const policy = decodePolicy({
    agents: "trailer",
    asks: [],
    at: landed,
    budget: { decisionsPerDay: 5, expireDays: 14 },
    caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
    claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
    deciders: [{ handles: deciders, paths: "**" }],
    functions: { admit: false, opensAlone: false },
    judge: {
      paths: [`${Brand.configDir}/**`],
      pointers: ["package.json#/scripts"],
    },
    kinds: [fix, migrate],
    modules: [],
    ratchets: [],
    record: { countsAfterDays: 30, windowDays: 365 },
    run: {
      checks: { lint: "bun run lint", types: "bun run typecheck" },
      test: "bun test {path}",
    },
    source: "config",
    vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
    vouches: [],
    weakening: { markers: [".skip(", ".only(", ".todo("] },
  });

  const names = [...deciders, ...(options.people ?? [])];

  return new Built({
    initializer: Handle.make(first),
    landed,
    now: options.now ?? defaultNow,
    people: new Map(names.map((person) => [person, Handle.make(person)])),
    policy,
    project: ProjectName.make(name),
  });
};

/** `packages/parser` → its module `parser` and its paths `packages/parser/**`; `.` → the whole repo. */
const territoryOf = (folder: string) =>
  decodeTerritory(
    folder === "."
      ? { module: ".", paths: ["**"] }
      : {
          module: folder.split("/").at(-1) ?? folder,
          paths: [`${folder}/**`],
        }
  );

/** An ask as `withAsk` takes it. */
interface AskOptions {
  readonly id: string;
  readonly territory: string;
  readonly kind?: string;
  /** Built with the domain's constructors: `CheckSpec.cases.LintToZero.make(…)`. */
  readonly check?: CheckSpec;
  readonly blockedBy?: readonly string[];
  readonly reserve?: "newcomers" | "people";
  /** The migrate ask this one is a step of. */
  readonly parent?: string;
  readonly want?: string;
}

/**
 * Opens `ask` over `territory` in the scenario, and records the territory as
 * a module when `module` says it is one.
 */
const openAsk = (
  scenario: Scenario,
  ask: AskOptions,
  territory: Territory,
  module: boolean
): Scenario => {
  const tests = ask.territory === "." ? "test" : `${ask.territory}/test`;

  const encoded: Types.Mutable<typeof Ask.Encoded> = {
    askedBy: scenario.initializer,
    blockedBy: ask.blockedBy ?? [],
    brief: {
      want: ask.want ?? `${ask.id}: its check passes in ${ask.territory}`,
    },
    check: encodeCheck(
      ask.check ??
        CheckSpec.cases.RedThenGreen.make({
          path: RepoPath.make(`${tests}/${ask.id}.test.ts`),
        })
    ),
    file: `${Brand.configDir}/asks/${ask.id}.ask.ts`,
    id: ask.id,
    kind: ask.kind ?? "fix",
    openedAt: DateTime.formatIso(scenario.now),
    openedIn: scenario.landed,
    project: scenario.project,
    state: "open",
    territory: encodeTerritory(territory),
  };

  if (ask.parent !== undefined) {
    encoded.parent = ask.parent;
  }

  if (ask.reserve !== undefined) {
    encoded.reserve = ask.reserve;
  }

  const { modules } = scenario.policy;
  const known = modules.some((each) => each.module === territory.module);

  return withPolicy(scenario, {
    ...scenario.policy,
    asks: [...scenario.policy.asks, decodeAsk(encoded)],
    modules: module && !known ? [...modules, territory] : modules,
  });
};

/**
 * Adds an open ask, asked by the initializer in the landed commit, and its
 * territory's module. The territory is a folder (`packages/parser`) or `.`
 * (the whole repo, which is no module: modules are workspaces); the kind
 * defaults to `fix`, the check to a `RedThenGreen` file in the territory, the
 * want to a sentence naming both.
 */
export const withAsk =
  (ask: AskOptions) =>
  (scenario: Scenario): Scenario =>
    openAsk(scenario, ask, territoryOf(ask.territory), ask.territory !== ".");

/** Adds an ask kind, in place of one with the same name. */
export const withKind =
  (kind: AskKindEncoded) =>
  (scenario: Scenario): Scenario => {
    const added = decodeKind(kind);
    const { kinds } = scenario.policy;

    return withPolicy(scenario, {
      ...scenario.policy,
      kinds: kinds.some(({ name }) => name === added.name)
        ? kinds.map((each) => (each.name === added.name ? added : each))
        : [...kinds, added],
    });
  };

/** Adds the vouch file's lines: `handles` vouched for, then `denounced`. */
export const withVouches =
  (handles: readonly string[], denounced: readonly string[] = []) =>
  (scenario: Scenario): Scenario =>
    withPolicy(scenario, {
      ...scenario.policy,
      vouches: [
        ...scenario.policy.vouches,
        ...handles.map((handle) => ({
          denounced: false,
          handle: Handle.make(handle),
        })),
        ...denounced.map((handle) => ({
          denounced: true,
          handle: Handle.make(handle),
        })),
      ],
    });

/** `legacyFetch` → `legacy-fetch`, `http.get` → `http-get`: a name an ask id can carry. */
const words = (symbol: string) =>
  symbol
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const packages = Arr.makeBy(6, (n) => `packages/p${n + 1}`);

/** The six packages together: where a family's parent and delete child reach. */
const allSix = decodeTerritory({
  module: ".",
  paths: Arr.map(packages, (folder) => `${folder}/**`),
});

/**
 * "Six agents claim six children" (CAA §2.F): the project `burrow` with a
 * migrate ask `drop-<symbol>` over `packages/p1` … `packages/p6`, a child per
 * package (`drop-<symbol>-p1` …), each moving the symbol in its own package,
 * and a delete child (`drop-<symbol>-delete`) blocked by all six. The six
 * packages are the project's modules.
 */
export const sixChildren = (
  options: { readonly symbol?: string; readonly to?: string } = {}
): Scenario => {
  const symbol = options.symbol ?? "legacyFetch";
  const to = options.to ?? "http.get";
  const parent = `drop-${words(symbol)}`;
  const count = `node scripts/count-callers.mjs ${symbol} --json`;

  const check = CheckSpec.cases.Migrate.make({
    count: Command.make(count),
    from: SymbolName.make(symbol),
    to: SymbolName.make(to),
  });

  const children = packages.map((folder) => ({
    check,
    id: `${parent}-${folder.split("/").at(-1) ?? folder}`,
    kind: "migrate",
    parent,
    territory: folder,
    want: `${folder}: move every use of ${symbol} to ${to}`,
  }));

  const opened = openAsk(
    aProject({ name: "burrow" }),
    {
      check,
      id: parent,
      kind: "migrate",
      territory: ".",
      want: `Move every use of ${symbol} to ${to}, then delete ${symbol}`,
    },
    allSix,
    false
  );

  let split = opened;

  for (const child of children) {
    split = withAsk(child)(split);
  }

  return openAsk(
    split,
    {
      blockedBy: children.map(({ id }) => id),
      check: CheckSpec.cases.SymbolAbsent.make({
        count: Command.make(count),
        symbol: SymbolName.make(symbol),
      }),
      id: `${parent}-delete`,
      kind: "migrate",
      parent,
      territory: ".",
      want: `Delete ${symbol}: nothing uses it any more`,
    },
    allSix,
    false
  );
};
