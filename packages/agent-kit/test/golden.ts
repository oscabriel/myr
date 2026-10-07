/**
 * Golden files for the generators: each generator's files in one
 * `test/golden/<name>.txt`, with the product's name as placeholders so no
 * golden file spells it (`brand:check`) and a renamed brand still matches.
 * A `content-hash` covers text that spells the name, so it changes with the
 * brand: the golden file holds `__HASH__` there, and the generator tests
 * hold each recorded hash to its body instead. `UPDATE_GOLDEN=1` rewrites
 * them; read the diff before committing it.
 */
import { expect } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Config, Effect, FileSystem } from "effect";

import type { GeneratedFile } from "../src/generated-file.ts";

const DIR = "test/golden";

const escaped = (text: string) =>
  text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

// Letters on either side make it another word, not the name.
const NAME = new RegExp(`(?<![A-Za-z])${escaped(Brand.name)}(?![a-z])`, "gu");

// The CLI where a command starts: in a code span or a JSON string, before a
// subcommand.
const CLI = new RegExp(`(?<=^|[\`"])${escaped(Brand.cli)}(?= [a-z])`, "gmu");

const SLUG = new RegExp(`(?<![A-Za-z])${escaped(Brand.slug)}(?![a-z])`, "gu");

/** A golden file's text with its placeholders filled in from `Brand`. */
export const branded = (golden: string) =>
  golden
    .replaceAll("__NAME__", Brand.name)
    .replaceAll("__CLI__", Brand.cli)
    .replaceAll("__SLUG__", Brand.slug);

// The hex of a frontmatter's `content-hash: "sha256:…"` or an AGENTS.md
// marker's `content-hash: sha256:…`.
const HASH = /(?<=content-hash: "?sha256:)[0-9a-f]{64}/gu;

/** Generated text with each content hash as `__HASH__`. */
const unhashed = (text: string) => text.replaceAll(HASH, "__HASH__");

/** Generated text as a golden file holds it: the brand and hashes as placeholders. */
const unbranded = (text: string) =>
  unhashed(text)
    .replaceAll(NAME, "__NAME__")
    .replaceAll(CLI, "__CLI__")
    .replaceAll(SLUG, "__SLUG__");

/** Several files as one text: each under a `==> <path> <==` line. */
export const transcript = (files: readonly GeneratedFile[]) =>
  files.map(({ content, path }) => `==> ${path} <==\n${content}`).join("\n");

/**
 * Asserts that `actual`, with its content hashes as `__HASH__`, is
 * `test/golden/<name>.txt` with its brand placeholders filled in, byte for
 * byte. Under `UPDATE_GOLDEN=1` it writes the file.
 */
export const expectGolden = (name: string, actual: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = `${DIR}/${name}.txt`;

    const update = yield* Config.Boolean("UPDATE_GOLDEN").pipe(
      Config.withDefault(false)
    );

    if (update) {
      yield* fs.makeDirectory(DIR, { recursive: true });
      yield* fs.writeFileString(file, unbranded(actual));

      return;
    }

    const exists = yield* fs.exists(file);

    expect(
      exists,
      `no golden file ${file} yet: run this package's tests with UPDATE_GOLDEN=1, then read it`
    ).toBe(true);

    const golden = yield* fs.readFileString(file);

    expect(unhashed(actual)).toBe(branded(golden));
  }).pipe(Effect.orDie);
