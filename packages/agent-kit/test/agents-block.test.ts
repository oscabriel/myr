import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Effect } from "effect";

import { agentsBlock, upsertAgentsBlock } from "../src/agents-block.ts";
import { contentHash } from "../src/generated-file.ts";
import {
  landed,
  later,
  policy,
  policyWithNewLint,
  project,
} from "./fixtures.ts";

const end = `<!-- END ${Brand.slug} contribute -->`;

const beginWith = (digit: string) =>
  `<!-- BEGIN ${Brand.slug} contribute (generated; content-hash: sha256:${digit.repeat(64)}) -->`;

const block = {
  begin: beginWith("1"),
  body: "## Contributing\n\nNew text.\n",
  end,
};

const older = {
  begin: beginWith("0"),
  body: "## Contributing\n\nOld text,\nover two lines.\n",
  end,
};

/** The block as it sits in a file. */
const written = ({ begin, body }: typeof block) => `${begin}\n${body}${end}`;

describe(upsertAgentsBlock, () => {
  it("inserts the block at the end of an AGENTS.md without one", () => {
    const existing = "# Project\n\nOur own words.\n";

    expect(upsertAgentsBlock(existing, block)).toBe(
      `${existing}\n${written(block)}\n`
    );
  });

  it("starts an empty AGENTS.md with the block alone", () => {
    expect(upsertAgentsBlock("", block)).toBe(`${written(block)}\n`);
  });

  it("puts a blank line after a last line that has no newline", () => {
    expect(upsertAgentsBlock("# Project", block)).toBe(
      `# Project\n\n${written(block)}\n`
    );
  });

  it("replaces only the text between the markers, whatever the old hash", () => {
    const before = "# Project\n\nOur own words.\n\n";
    const after = "\n## Ours again\n\nMore of our words.\n";

    expect(upsertAgentsBlock(`${before}${written(older)}${after}`, block)).toBe(
      `${before}${written(block)}${after}`
    );
  });

  it("is a no-op when applied twice", () => {
    const appended = upsertAgentsBlock("# Project\n\nOur own words.\n", block);

    const replaced = upsertAgentsBlock(
      `# Project\n\n${written(older)}\n\nAfter.\n`,
      block
    );

    expect(upsertAgentsBlock(appended, block)).toBe(appended);
    expect(upsertAgentsBlock(replaced, block)).toBe(replaced);
  });

  it("leaves another tool's markers alone", () => {
    const existing =
      "# Project\n\n<!-- BEGIN other contribute -->\nTheirs.\n<!-- END other contribute -->\n";

    expect(upsertAgentsBlock(existing, block)).toBe(
      `${existing}\n${written(block)}\n`
    );
  });
});

describe(agentsBlock, () => {
  it.effect(
    "brackets its body between markers, the first carrying the body's hash",
    () =>
      Effect.gen(function* () {
        const generated = yield* agentsBlock({ landed, policy, project });
        const hash = yield* contentHash(generated.body);

        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(generated.begin).toBe(
          `<!-- BEGIN ${Brand.slug} contribute (generated; content-hash: ${hash}) -->`
        );
        expect(generated.end).toBe(end);
        expect(generated.body).toContain(`${Brand.cli} check`);
      })
  );

  it.effect(
    "changes its hash when the run block changes, not the landing",
    () =>
      Effect.gen(function* () {
        const first = yield* agentsBlock({ landed, policy, project });
        const again = yield* agentsBlock({ landed: later, policy, project });

        const changed = yield* agentsBlock({
          landed: later,
          policy: policyWithNewLint,
          project,
        });

        expect(again).toStrictEqual(first);
        expect(changed.begin).not.toBe(first.begin);
        expect(changed.body).toContain("bunx oxlint --deny-warnings");
      })
  );
});
