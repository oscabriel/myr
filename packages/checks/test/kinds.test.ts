import { describe, expect, it } from "@effect/vitest";
import {
  CheckSpec,
  RatchetMeasure,
  RatchetSpec,
} from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import { RunBlock } from "@repo/protocol/domain/run";
import { RatchetName, RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { checkKindOf, checkVersion, commandFor } from "../src/kinds.ts";

const runBlock = Schema.decodeUnknownSync(RunBlock);

const encodedRun = {
  checks: { lint: "bun run lint", types: "bun run typecheck" },
  setup: "bun install --frozen-lockfile",
  test: "bun test {path}",
};

const run = runBlock(encodedRun);

const redThenGreenOn = (path: string) =>
  CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(path) });

const redThenGreen = redThenGreenOn("packages/parse/test/week.test.ts");

const lintToZero = CheckSpec.cases.LintToZero.make({
  command: Command.make("oxlint --format json"),
  rule: "no-console",
});

const migrate = CheckSpec.cases.Migrate.make({
  count: Command.make("bun scripts/count.ts dayjs"),
  from: SymbolName.make("dayjs"),
});

const symbolAbsent = CheckSpec.cases.SymbolAbsent.make({
  count: Command.make("bun scripts/count.ts dayjs"),
  symbol: SymbolName.make("dayjs"),
});

const ratchet = CheckSpec.cases.Ratchet.make({
  ratchet: RatchetName.make("anyCount"),
});

const countingRule = (rule: string) => [
  RatchetSpec.make({
    measure: RatchetMeasure.cases.Count.make({
      command: Command.make("oxlint --format json"),
      rule,
    }),
    name: RatchetName.make("anyCount"),
  }),
];

const ratchets = countingRule("typescript/no-explicit-any");

const reversed = <V>(record: Readonly<Record<string, V>>) =>
  Object.fromEntries(Object.entries(record).toReversed());

describe(checkVersion, () => {
  it("has the form <checkKind>@<sdkVersion>+<runHash>", () => {
    expect(checkVersion(redThenGreen, "0.3.1", run)).toMatch(
      /^redThenGreen@0\.3\.1\+[0-9a-f]{16}$/u
    );
  });

  it("is equal for equal inputs, whatever their key order", () => {
    const reordered = runBlock({
      ...reversed(encodedRun),
      checks: reversed(encodedRun.checks),
    });

    expect(Object.keys(reordered.checks)).toStrictEqual(["types", "lint"]);
    expect(checkVersion(redThenGreen, "0.3.1", reordered)).toBe(
      checkVersion(redThenGreen, "0.3.1", run)
    );
  });

  it("stays the same across releases, since cached verdicts are keyed by it", () => {
    // Pinned: a change here makes every cached verdict miss once. Computed
    // apart from this code: FNV-1a 64 over the sorted-key JSON
    // {"check":{"_tag":"RedThenGreen","path":"packages/parse/test/week.test.ts"},
    //  "checks":{"lint":"bun run lint","types":"bun run typecheck"},
    //  "command":"bun test packages/parse/test/week.test.ts","image":null,
    //  "measure":null,"setup":"bun install --frozen-lockfile","setupEgress":null}
    expect(checkVersion(redThenGreen, "0.3.1", run)).toBe(
      "redThenGreen@0.3.1+6cf6757a65e87235"
    );
  });

  it("hashes a non-ASCII command by its UTF-8 bytes", () => {
    // Computed the same way, with "command": "bun test packages/parse/test/week.test.ts # é→✓ 🦀".
    expect(
      checkVersion(
        redThenGreen,
        "0.3.1",
        runBlock({ ...encodedRun, test: "bun test {path} # é→✓ 🦀" })
      )
    ).toBe("redThenGreen@0.3.1+3f7420049367e696");
  });

  it.each([
    ["the test command", { ...encodedRun, test: "bun test --bail {path}" }],
    ["the setup command", { ...encodedRun, setup: "bun install" }],
    [
      "a lane's command",
      {
        ...encodedRun,
        checks: { ...encodedRun.checks, lint: "oxlint -D all" },
      },
    ],
    [
      "a new lane",
      {
        ...encodedRun,
        checks: { ...encodedRun.checks, build: "bun run build" },
      },
    ],
    ["the image", { ...encodedRun, image: "node:24-trixie-slim" }],
    [
      "the setup egress",
      { ...encodedRun, setupEgress: ["registry.npmjs.org"] },
    ],
  ])("differs when %s changes", (_what, changed) => {
    expect(checkVersion(redThenGreen, "0.3.1", runBlock(changed))).not.toBe(
      checkVersion(redThenGreen, "0.3.1", run)
    );
  });

  it("differs by the check file, the SDK version and the check kind", () => {
    const version = checkVersion(redThenGreen, "0.3.1", run);
    const otherFile = redThenGreenOn("packages/parse/test/day.test.ts");

    expect(checkVersion(otherFile, "0.3.1", run)).not.toBe(version);
    expect(checkVersion(redThenGreen, "0.3.2", run)).not.toBe(version);
    expect(checkVersion(lintToZero, "0.3.1", run)).not.toBe(version);
  });

  it("is unchanged by the doctor command, which judges nothing", () => {
    const withDoctor = runBlock({ ...encodedRun, doctor: "bun --version" });

    expect(checkVersion(redThenGreen, "0.3.1", withDoctor)).toBe(
      checkVersion(redThenGreen, "0.3.1", run)
    );
  });

  it("follows a ratchet's measure, not just its name", () => {
    expect(
      checkVersion(ratchet, "0.3.1", run, countingRule("no-console"))
    ).not.toBe(checkVersion(ratchet, "0.3.1", run, ratchets));
  });
});

describe(commandFor, () => {
  it("runs the run block's test on the ask's check file for redThenGreen", () => {
    expect(commandFor(redThenGreen, run)).toStrictEqual(
      Option.some({
        command: "bun test packages/parse/test/week.test.ts",
        lane: "redThenGreen",
      })
    );
  });

  it("quotes a check file whose path the shell would split", () => {
    expect(
      commandFor(redThenGreenOn("test/it's a week.test.ts"), run)
    ).toStrictEqual(
      Option.some({
        command: String.raw`bun test 'test/it'\''s a week.test.ts'`,
        lane: "redThenGreen",
      })
    );
  });

  it("can't run redThenGreen when the test command has no {path}", () => {
    expect(
      commandFor(redThenGreen, runBlock({ ...encodedRun, test: "make test" }))
    ).toStrictEqual(Option.none());
  });

  it.each([
    [lintToZero, "oxlint --format json", "lintToZero"],
    [migrate, "bun scripts/count.ts dayjs", "migrate"],
    [symbolAbsent, "bun scripts/count.ts dayjs", "symbolAbsent"],
  ])("runs %o's own command", (spec, command, lane) => {
    expect(commandFor(spec, run)).toStrictEqual(Option.some({ command, lane }));
  });

  it("runs a ratchet's measure command, and nothing for a ratchet the policy doesn't declare", () => {
    expect(commandFor(ratchet, run, ratchets)).toStrictEqual(
      Option.some({ command: "oxlint --format json", lane: "ratchet" })
    );
    expect(commandFor(ratchet, run)).toStrictEqual(Option.none());
  });
});

describe(checkKindOf, () => {
  it.each([
    [redThenGreen, "redThenGreen"],
    [lintToZero, "lintToZero"],
    [ratchet, "ratchet"],
    [migrate, "migrate"],
    [symbolAbsent, "symbolAbsent"],
  ])("names %o's check kind %s", (spec, kind) => {
    expect(checkKindOf(spec)).toBe(kind);
  });
});
