// Golden files hold the brand as placeholders (so `brand:check` passes) and
// each content hash as `__HASH__`. `UPDATE_GOLDEN=1` rewrites them.
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

export const branded = (golden: string) =>
  golden
    .replaceAll("__NAME__", Brand.name)
    .replaceAll("__CLI__", Brand.cli)
    .replaceAll("__SLUG__", Brand.slug);

// The hex of a frontmatter's `content-hash: "sha256:…"` or an AGENTS.md
// marker's `content-hash: sha256:…`.
const HASH = /(?<=content-hash: "?sha256:)[0-9a-f]{64}/gu;

const unhashed = (text: string) => text.replaceAll(HASH, "__HASH__");

const unbranded = (text: string) =>
  unhashed(text)
    .replaceAll(NAME, "__NAME__")
    .replaceAll(CLI, "__CLI__")
    .replaceAll(SLUG, "__SLUG__");

export const transcript = (files: readonly GeneratedFile[]) =>
  files.map(({ content, path }) => `==> ${path} <==\n${content}`).join("\n");

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
