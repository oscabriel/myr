import { flows, layer, sealedChecks, visibility } from "@myr/cli/rules";

/**
 * What datekit keeps out of its public tree, and why. The maintainers hold
 * checks for how dates are shown (export) and read (parser) in a layer of
 * their own, beside their review rubric. Every answer is judged by those
 * checks too, and learns only which area failed. Everything else is open.
 */
export default visibility({
  checks: sealedChecks({
    // A new check joins only after it passes main three times and fails on
    // at least one known-bad tree.
    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
    areas: { export: "src/format.ts", parser: "src/parse.ts" },
    canary: true,
  }),
  flows: flows.noWriteDown(),
  layers: {
    maintainers: layer({
      disclose: "sealed",
      holds: ["checks", "notes"],
      reason: "Held-back checks for export and parser, and the maintainers' review rubric",
    }),
  },
  notice: { narrowing: "7 days" },
});
