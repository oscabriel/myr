/**
 * burrow's escape count. Every directive that switches a check off (a lint
 * disable, a TypeScript suppression) must say why after ` -- `, and their
 * number may only fall: raising `debt.baseline.json` is a decision for a
 * maintainer, made in review.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface Baseline {
  readonly escapes: number;
}

const ROOTS = ["packages", "scripts", "tools"];

// A directive opens a comment line, or ends a line of code (the `-line`
// forms).
const ESCAPE =
  /(?:\/\/|\/\*)\s*(?:(?:oxlint|eslint)-disable|@ts-(?:expect-error|ignore|nocheck)|biome-ignore)/u;

const escapes = ROOTS.flatMap((root) =>
  readdirSync(root, { encoding: "utf-8", recursive: true })
    .filter((file) => /\.tsx?$/u.test(file) && !file.includes("node_modules"))
    .flatMap((file) =>
      readFileSync(path.join(root, file), "utf-8")
        .split("\n")
        .flatMap((text, index) =>
          ESCAPE.test(text)
            ? [{ at: `${path.join(root, file)}:${index + 1}`, text }]
            : []
        )
    )
);

const baseline: Baseline = JSON.parse(
  readFileSync("debt.baseline.json", "utf-8")
);
const unreasoned = escapes.filter(({ text }) => !/ -- \S/u.test(text));

for (const { at, text } of unreasoned) {
  console.error(
    `${at}: an escape without a reason after " -- ": ${text.trim()}`
  );
}

console.log(`debt: ${escapes.length} escapes (baseline ${baseline.escapes})`);

if (unreasoned.length > 0 || escapes.length > baseline.escapes) {
  process.exitCode = 1;
}
