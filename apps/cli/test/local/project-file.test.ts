import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { projectFile } from "../../src/local/project-file.ts";

/**
 * What the finder reads from a repo whose CI installs with Bun and whose
 * scripts test, lint and type-check. Lanes come in the order found, which
 * the file keeps.
 */
const found = {
  run: {
    checks: Object.fromEntries(
      new Map([
        ["unit", "bun run test"],
        ["lint", "bun run lint"],
        ["types", "bun run typecheck"],
      ])
    ),
    setup: "bun install --frozen-lockfile",
    test: "vitest run {path}",
  },
  sources: [
    "setup from .github/workflows/ci.yml",
    "test from package.json",
    "checks.unit from package.json",
    "checks.lint from package.json",
    "checks.types from package.json",
  ],
} as const;

/** What the finder reads from a repo with scripts but no test runner it knows. */
const noTest = {
  run: {
    checks: { lint: "npm run lint" },
    setup: "npm install",
  },
  sources: [
    "setup inferred from package.json",
    "checks.lint from package.json",
    "skipped .github/workflows/broken.yml: not YAML",
  ],
} as const;

describe("the proposed project file", () => {
  it("writes each command the finder found, with where it was found", () => {
    expect(projectFile(found.run, found.sources)).toBe(
      [
        `import { project } from "${Brand.cliPackage}/rules";`,
        "",
        `// The run block \`${Brand.cli} init\` found in this repo's own files, each`,
        "// command with where it was found. Every other setting takes its default.",
        "export default project({",
        "  run: {",
        "    // setup from .github/workflows/ci.yml",
        `    setup: "bun install --frozen-lockfile",`,
        "    // test from package.json",
        `    test: "vitest run {path}",`,
        "    checks: {",
        "      // checks.unit from package.json",
        `      unit: "bun run test",`,
        "      // checks.lint from package.json",
        `      lint: "bun run lint",`,
        "      // checks.types from package.json",
        `      types: "bun run typecheck",`,
        "    },",
        "  },",
        "});",
        "",
      ].join("\n")
    );
  });

  it("is the same text for the same commands, in whatever order the keys come", () => {
    // `checks` moves from first to last.
    const { checks, ...rest } = found.run;
    const reordered = { ...rest, checks };

    expect(projectFile(reordered, found.sources)).toBe(
      projectFile(found.run, found.sources)
    );
  });

  it("falls back to the run block found from CI when no command runs one test file, listing what it found", () => {
    expect(projectFile(noTest.run, noTest.sources)).toBe(
      [
        `import { project, run } from "${Brand.cliPackage}/rules";`,
        "",
        `// \`${Brand.cli} init\` found no command that runs one test file ({path}), so`,
        "// the platform reads the run block from CI at each landing. It found:",
        `//   setup: "npm install" (setup inferred from package.json)`,
        `//   checks.lint: "npm run lint" (checks.lint from package.json)`,
        "// skipped .github/workflows/broken.yml: not YAML",
        "export default project({",
        "  run: run.fromCI,",
        "});",
        "",
      ].join("\n")
    );
  });

  it("quotes a lane name that is no identifier, and a command's quotes", () => {
    const text = projectFile(
      {
        checks: { "test-e2e": `bun run e2e -- --grep "slow"` },
        test: "bun test {path}",
      },
      []
    );

    expect(text).toContain(
      `      "test-e2e": "bun run e2e -- --grep \\"slow\\"",`
    );
  });
});

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/**
 * Type-checks `files` (name → content) as a maintainer's repo would, with
 * the published CLI's `/rules` mapped to the workspace SDK: tsc's exit code
 * and what it printed.
 */
const typeCheck = (files: Readonly<Record<string, string>>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();

      const sdk = yield* path.fromFileUrl(
        new URL(import.meta.resolve("@repo/sdk"))
      );

      const tsc = path.join(
        path.dirname(
          yield* path.fromFileUrl(
            new URL(import.meta.resolve("typescript/package.json"))
          )
        ),
        "bin",
        "tsc"
      );

      yield* fs.writeFileString(
        path.join(dir, "package.json"),
        JSON.stringify({ type: "module" })
      );

      yield* fs.writeFileString(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            allowImportingTsExtensions: true,
            exactOptionalPropertyTypes: true,
            lib: ["ES2023"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            noUncheckedIndexedAccess: true,
            paths: { [`${Brand.cliPackage}/rules`]: [sdk] },
            skipLibCheck: true,
            strict: true,
            target: "ES2023",
            types: [],
          },
          files: Object.keys(files),
        })
      );

      for (const [name, content] of Object.entries(files)) {
        yield* fs.writeFileString(path.join(dir, name), content);
      }

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make(tsc, ["--noEmit", "-p", "tsconfig.json"], {
          cwd: dir,
          stdin: "ignore",
        })
      );

      const [stdout, exitCode] = yield* Effect.all(
        [text(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stdout };
    })
  ).pipe(Effect.provide(NodeServices.layer));

describe("the proposed project file, compiled", () => {
  it.live(
    "type-checks against the SDK's project signature, explicit or from CI; a test without {path} does not",
    () =>
      Effect.gen(function* () {
        const proposed = yield* typeCheck({
          "explicit.ts": projectFile(found.run, found.sources),
          "from-ci.ts": projectFile(noTest.run, noTest.sources),
          "quoted.ts": projectFile(
            {
              checks: { "test-e2e": `bun run e2e -- --grep "slow"` },
              test: "bun test {path}",
            },
            []
          ),
        });

        expect(proposed).toStrictEqual({ exitCode: 0, stdout: "" });

        // The compile is a real check: a run block whose test names no file fails it.
        const broken = yield* typeCheck({
          "broken.ts": projectFile(found.run, found.sources).replace(
            "vitest run {path}",
            "vitest run"
          ),
        });

        expect(broken.exitCode).not.toBe(0);
        expect(broken.stdout).toContain("broken.ts");
      }),
    { timeout: 60_000 }
  );
});
