import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { Kind, LedgerEntry } from "../../../scripts/lib/debt.ts";
import {
  Baseline,
  judge,
  ledgerArgs,
  ledgerFromOxlintJson,
  lowered,
  renderBaseline,
  renderLowered,
  renderTable,
  renderVerdict,
  tally,
  Verdict,
} from "../../../scripts/lib/debt.ts";

// Vitest runs in the package's folder, two below the repo root.
const repoRoot = Effect.map(Path.Path, (path) => path.resolve("..", ".."));

const baseline: Baseline = {
  "@effect-diagnostics": 0,
  "@ts-expect-error": 0,
  "@ts-ignore": 0,
  "@ts-nocheck": 0,
  "oxlint-disable": 4,
};

/** A reasoned escape in one source file. */
const escape = (line: number): LedgerEntry => ({
  directive: "oxlint-disable-next-line no-console",
  kind: "oxlint-disable",
  line,
  path: "packages/x/src/a.ts",
  reason: "the CLI prints",
});

/** The same escape with nothing after ` -- `. */
const unreasoned = (line: number): LedgerEntry => ({
  directive: "oxlint-disable-next-line no-console",
  kind: "oxlint-disable",
  line,
  path: "packages/x/src/a.ts",
});

describe("the debt ratchet", () => {
  it("fails a planted extra escape, naming its kind and its count", () => {
    const verdict = judge(
      [escape(1), escape(2), escape(3), escape(4), escape(5)],
      baseline
    );

    expect(verdict).toStrictEqual(
      Verdict.Rose({
        rises: [{ baseline: 4, count: 5, kind: "oxlint-disable" }],
        unreasoned: [],
      })
    );
    expect(renderVerdict(verdict)).toContain(
      "debt: oxlint-disable rose to 5 escapes, above its baseline of 4."
    );
  });

  it("fails an escape with no reason, naming its path and line, even at the baseline", () => {
    const verdict = judge(
      [escape(1), escape(2), unreasoned(12), escape(30)],
      baseline
    );

    expect(verdict).toStrictEqual(
      Verdict.Rose({ rises: [], unreasoned: [unreasoned(12)] })
    );
    expect(renderVerdict(verdict)).toContain(
      'debt: packages/x/src/a.ts:12 oxlint-disable-next-line no-console has no reason after " -- ".'
    );
  });

  it("names principle 10 and the user's sign-off when it fails", () => {
    const rendered = renderVerdict(judge([unreasoned(1)], baseline));

    expect(rendered).toContain("AGENTS.md principle 10");
    expect(rendered).toContain("needs the user's sign-off");
  });

  it("passes a removed escape and suggests lowering the baseline", () => {
    const verdict = judge([escape(1), escape(2), escape(3)], baseline);

    expect(verdict).toStrictEqual(
      Verdict.Held({
        falls: [{ baseline: 4, count: 3, kind: "oxlint-disable" }],
        tally: { ...baseline, "oxlint-disable": 3 },
      })
    );
    expect(renderVerdict(verdict).split("\n")).toStrictEqual([
      "debt: oxlint-disable fell to 3 escapes, below its baseline of 4.",
      "debt: lower the baseline to match: bun run debt -- --lower",
    ]);
  });

  it("passes the count at its baseline, with nothing to lower", () => {
    const verdict = judge(
      [escape(1), escape(2), escape(3), escape(4)],
      baseline
    );

    expect(verdict).toStrictEqual(Verdict.Held({ falls: [], tally: baseline }));
    expect(renderVerdict(verdict)).not.toContain("--lower");
  });

  it("prints each kind's count over its baseline", () => {
    expect(
      renderTable(tally([escape(1), escape(2), escape(3)]), baseline).split(
        "\n"
      )
    ).toStrictEqual([
      "debt: escapes by kind, count/baseline",
      "       oxlint-disable 3/4",
      "  @effect-diagnostics 0/0",
      "     @ts-expect-error 0/0",
      "           @ts-ignore 0/0",
      "          @ts-nocheck 0/0",
    ]);
  });
});

describe("lowering the baseline", () => {
  it("lowers each kind that fell to its count, and keeps the rest", () => {
    expect(
      lowered(
        {
          "@effect-diagnostics": 0,
          "@ts-expect-error": 2,
          "@ts-ignore": 0,
          "@ts-nocheck": 0,
          "oxlint-disable": 1,
        },
        { ...baseline, "@effect-diagnostics": 3 }
      )
    ).toStrictEqual({
      "@effect-diagnostics": 0,
      "@ts-expect-error": 0,
      "@ts-ignore": 0,
      "@ts-nocheck": 0,
      "oxlint-disable": 1,
    });
  });

  it("says each kind's baseline before and after", () => {
    expect(
      renderLowered([
        { baseline: 4, count: 3, kind: "oxlint-disable" },
        { baseline: 2, count: 1, kind: "@ts-ignore" },
      ]).split("\n")
    ).toStrictEqual([
      "debt: lowered the oxlint-disable baseline from 4 to 3 escapes.",
      "debt: lowered the @ts-ignore baseline from 2 to 1 escape.",
    ]);
  });

  it.prop(
    "never raises a number",
    { before: Baseline, counted: Baseline },
    ({ before, counted }) => {
      const after = lowered(counted, before);

      for (const kind of Baseline.key.literals) {
        expect(after[kind]).toBeLessThanOrEqual(before[kind]);
      }
    }
  );

  it.live("writes JSON that oxfmt leaves as it is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* repoRoot;

      const onDisk = yield* fs.readFileString(
        path.join(root, "debt.baseline.json")
      );

      const decoded = yield* Schema.decodeEffect(
        Schema.fromJsonString(Baseline)
      )(onDisk);

      expect(renderBaseline(decoded)).toBe(onDisk);

      const rendered = renderBaseline({
        "@effect-diagnostics": 3,
        "@ts-expect-error": 0,
        "@ts-ignore": 2,
        "@ts-nocheck": 1,
        "oxlint-disable": 12,
      });

      expect(rendered).toBe(
        [
          "{",
          '  "@effect-diagnostics": 3,',
          '  "@ts-expect-error": 0,',
          '  "@ts-ignore": 2,',
          '  "@ts-nocheck": 1,',
          '  "oxlint-disable": 12',
          "}",
          "",
        ].join("\n")
      );

      const formatted = yield* spawner.string(
        ChildProcess.make(
          path.join(root, "node_modules/.bin/oxfmt"),
          ["--stdin-filepath=debt.baseline.json"],
          {
            cwd: root,
            stdin: Stream.make(rendered).pipe(Stream.encodeText),
          }
        )
      );

      expect(formatted).toBe(rendered);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

// Joined at run time: the Effect language service reads a whole directive
// anywhere in the source, string literals included.
const effectDirective = [
  "@effect-diagnostics-next-line",
  "floatingEffect:off",
].join(" ");

/** One escape in the fixture, as the ledger reads it. */
const at = (
  line: number,
  kind: Kind,
  directive: string,
  reason?: string
): LedgerEntry =>
  reason === undefined
    ? { directive, kind, line, path: "escapes.ts" }
    : { directive, kind, line, path: "escapes.ts", reason };

describe("the debt ledger rule", () => {
  // The fixture sits where the debt config ignores it, so the real count
  // never sees it. A copy outside the repo is linted with that same config.
  it.live(
    "reads every kind, and a reason only after ` -- ` on the directive's line",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = yield* repoRoot;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* fs.copyFile(
          path.join(root, "tools/oxlint/fence/fixtures/debt/escapes.ts"),
          path.join(dir, "escapes.ts")
        );

        // The same command `bun run debt` runs, from the root, over the copy.
        const report = yield* spawner.string(
          ChildProcess.make(
            path.join(root, "node_modules/.bin/oxlint"),
            [...ledgerArgs, path.join(dir, "escapes.ts")],
            { cwd: root }
          )
        );

        const ledger = (yield* ledgerFromOxlintJson(report)).map((entry) => ({
          ...entry,
          path: path.basename(entry.path),
        }));

        const without = [
          at(4, "@ts-nocheck", "@ts-nocheck"),
          at(9, "oxlint-disable", "oxlint-disable-next-line no-console"),
          at(14, "@effect-diagnostics", effectDirective),
          at(19, "@ts-expect-error", "@ts-expect-error --"),
          at(24, "@ts-ignore", "@ts-ignore"),
        ];

        expect(ledger).toStrictEqual([
          at(1, "@ts-nocheck", "@ts-nocheck", "a fixture, never typechecked"),
          without[0],
          at(
            6,
            "oxlint-disable",
            "oxlint-disable-next-line no-console",
            "the fixture prints"
          ),
          without[1],
          at(
            12,
            "@effect-diagnostics",
            effectDirective,
            "the fixture drops it"
          ),
          without[2],
          at(
            17,
            "@ts-expect-error",
            "@ts-expect-error",
            "a string is not a number"
          ),
          without[3],
          at(22, "@ts-ignore", "@ts-ignore", "the fixture ignores it"),
          without[4],
        ]);

        expect(
          judge(ledger, {
            "@effect-diagnostics": 2,
            "@ts-expect-error": 2,
            "@ts-ignore": 2,
            "@ts-nocheck": 2,
            "oxlint-disable": 2,
          })
        ).toStrictEqual(Verdict.Rose({ rises: [], unreasoned: without }));
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
