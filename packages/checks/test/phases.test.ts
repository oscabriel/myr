import { describe, expect, it } from "@effect/vitest";
import { Command, Hostname } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import { AreaName, EnvKey, LaneName } from "@repo/protocol/ids";
import { Array, Option } from "effect";

import { Phase, phasePlan } from "../src/phases.ts";
import type { PlanInput } from "../src/phases.ts";

const unit = { command: "bun run test", lane: LaneName.make("unit") };

const lint = { command: "bun run lint", lane: LaneName.make("lint") };

const setup = Command.make("bun install --frozen-lockfile --ignore-scripts");

const registry = Hostname.make("registry.npmjs.org");

const run: RunBlock = {
  checks: { [unit.lane]: Command.make(unit.command) },
  setup,
  setupEgress: [registry],
  test: Command.make("bun test {path}"),
};

const parse = AreaName.make("parse");

const token = EnvKey.make("PAYMENTS_KEY");

const input: PlanInput = {
  heldBack: Option.none(),
  lanes: [unit],
  lockfileHash: "sha256:9f86d081",
  placeholders: [token],
  run,
};

const tags = (phases: readonly Phase[]) => phases.map(({ _tag }) => _tag);

const keyOf = (phases: readonly Phase[]) =>
  phases.flatMap((phase) => (Phase.$is("Snapshot")(phase) ? [phase.key] : []));

// Every input combination: setup or none, extra setup hosts or none,
// held-back or none, placeholders or none, and zero, one or two lanes.
const { setup: _setup, setupEgress: _egress, ...bare } = run;

const runBlocks: readonly RunBlock[] = [
  bare,
  { ...bare, setup },
  { ...bare, setupEgress: [registry] },
  { ...bare, setup, setupEgress: [registry] },
];

const heldBacks = [Option.none(), Option.some({ areas: [parse] })];

const combinations = Array.flatMap(runBlocks, (runBlock) =>
  Array.flatMap(heldBacks, (heldBack) =>
    Array.flatMap([[], [token]], (placeholders) =>
      Array.map([0, 1, 2], (laneCount): PlanInput => ({
        heldBack,
        lanes: [unit, lint].slice(0, laneCount),
        lockfileHash: "sha256:9f86d081",
        placeholders,
        run: runBlock,
      }))
    )
  )
);

describe(phasePlan, () => {
  it("is setup, snapshot, egress off, run, report without held-back checks", () => {
    const phases = phasePlan(input);

    expect(tags(phases)).toStrictEqual([
      "Setup",
      "Snapshot",
      "EgressOff",
      "Run",
      "Report",
    ]);
    expect(phases[0]).toStrictEqual(
      Phase.Setup({ command: setup, egress: [registry] })
    );
    expect(phases[3]).toStrictEqual(
      Phase.Run({ lanes: [unit], placeholders: [token] })
    );
  });

  it("writes held-back files after egress is off and before the run", () => {
    const phases = phasePlan({
      ...input,
      heldBack: Option.some({ areas: [parse] }),
    });

    expect(tags(phases)).toStrictEqual([
      "Setup",
      "Snapshot",
      "EgressOff",
      "WriteHeldBack",
      "Run",
      "Report",
    ]);
    expect(phases[3]).toStrictEqual(Phase.WriteHeldBack({ areas: [parse] }));
  });

  it("has no setup and nothing to snapshot when the run block declares no setup", () => {
    expect(tags(phasePlan({ ...input, run: bare }))).toStrictEqual([
      "EgressOff",
      "Run",
      "Report",
    ]);
  });

  it("keys the snapshot by what setup installs from: the lockfile, the command and its hosts", () => {
    const key = keyOf(phasePlan(input));

    expect(key).toHaveLength(1);
    expect(keyOf(phasePlan(input))).toStrictEqual(key);
    expect(
      keyOf(phasePlan({ ...input, lockfileHash: "sha256:60303ae2" }))
    ).not.toStrictEqual(key);
    expect(
      keyOf(
        phasePlan({
          ...input,
          run: { ...run, setup: Command.make("bun install") },
        })
      )
    ).not.toStrictEqual(key);
    expect(
      keyOf(phasePlan({ ...input, run: { ...run, setupEgress: [] } }))
    ).not.toStrictEqual(key);
  });

  it("holds the Checker's order over every input combination", () => {
    expect(combinations).toHaveLength(48);

    for (const each of combinations) {
      const order = tags(phasePlan(each));
      const at = (tag: Phase["_tag"]) => order.indexOf(tag);

      // A snapshot taken after held-back files are written would carry them
      // into the next Sandbox.
      const afterWrite =
        at("WriteHeldBack") === -1 ? [] : order.slice(at("WriteHeldBack"));

      expect(afterWrite).not.toContain("Snapshot");

      // Egress is off before the run, and the report comes last.
      expect(
        order.filter((tag) => ["EgressOff", "Run", "Report"].includes(tag))
      ).toStrictEqual(["EgressOff", "Run", "Report"]);
      expect(order.at(-1)).toBe("Report");
      expect(at("WriteHeldBack") !== -1).toBe(Option.isSome(each.heldBack));
    }
  });

  it("lists placeholders in the run phase only, over every input combination", () => {
    for (const each of combinations) {
      const phases = phasePlan(each);
      const running = phases.filter(Phase.$is("Run"));
      const others = phases.filter((phase) => !Phase.$is("Run")(phase));

      expect(JSON.stringify(others)).not.toContain(token);
      expect(running).toStrictEqual([
        Phase.Run({ lanes: each.lanes, placeholders: each.placeholders }),
      ]);
    }
  });
});
