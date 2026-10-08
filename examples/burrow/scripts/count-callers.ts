/**
 * Counts the calls to a function in each workspace package's `src/`:
 *
 *   bun scripts/count-callers.ts legacyFetch          a table
 *   bun scripts/count-callers.ts legacyFetch --json   {"byModule": {"@burrow/kit": n, …}, "total": n}
 *
 * A plain text scan: a call is the name followed by `(`, so the function's
 * own definition, an import or a property of another name (`x.legacyFetch`)
 * is not one. Dotted names work too: `http.get`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface Manifest {
  readonly name: string;
}

const [symbol, ...flags] = process.argv.slice(2);

if (symbol === undefined || symbol.startsWith("-")) {
  throw new Error("usage: bun scripts/count-callers.ts <symbol> [--json]");
}

const escaped = symbol.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
const call = new RegExp(String.raw`(?<![\w.$])${escaped}\s*\(`, "gu");

const callsIn = (dir: string) =>
  readdirSync(dir, { encoding: "utf-8", recursive: true })
    .filter((file) => /\.tsx?$/u.test(file))
    .map(
      (file) =>
        readFileSync(path.join(dir, file), "utf-8").match(call)?.length ?? 0
    )
    .reduce((sum, count) => sum + count, 0);

const byModule = Object.fromEntries(
  readdirSync("packages", { encoding: "utf-8" })
    .toSorted()
    .map((dir) => {
      const manifest: Manifest = JSON.parse(
        readFileSync(path.join("packages", dir, "package.json"), "utf-8")
      );

      return [
        manifest.name,
        callsIn(path.join("packages", dir, "src")),
      ] as const;
    })
);

const total = Object.values(byModule).reduce((sum, count) => sum + count, 0);

if (flags.includes("--json")) {
  console.log(JSON.stringify({ byModule, total }));
} else {
  for (const [module, count] of Object.entries(byModule)) {
    console.log(`${module.padEnd(20)} ${count}`);
  }

  console.log(`${"total".padEnd(20)} ${total}`);
}
