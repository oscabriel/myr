import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts, PolicyOf } from "@repo/protocol/contracts";
import type { PublicPolicy } from "@repo/protocol/domain/policy";
import { Envelope } from "@repo/protocol/envelope";
import { unanswered } from "@repo/protocol/testing";
import { Effect, Layer, Option, Schema } from "effect";

import { views } from "../src/render.ts";
import { runProgram } from "./remote-server.ts";

const sha = "4c2e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c";

const decodeSuccess = Schema.decodeSync(PolicyOf.successSchema);

const datekitPolicy = {
  agents: "trailer",
  at: sha,
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [
    { handles: ["ines-v"], paths: "**" },
    { handles: ["okonkwo", "bram"], paths: "src/tz.ts" },
  ],
  judge: { paths: [`${Brand.configDir}/**`], pointers: [] },
  kinds: [],
  modules: [],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: { checks: { unit: "bun test" }, test: "bun test {path}" },
  source: "config",
  vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
  vouches: [
    { denounced: false, handle: "bram", note: "first answer landed" },
    { denounced: false, handle: "ines-v" },
    { denounced: true, handle: "spam-bot" },
  ],
  weakening: { markers: [] },
} as const satisfies typeof PublicPolicy.Encoded;

const datekit = decodeSuccess({ policy: datekitPolicy });

const noConfig = decodeSuccess({
  unevaluated: { at: sha, reason: "noConfig" },
});

const configFailed = decodeSuccess({
  unevaluated: { at: sha, reason: "configFailed" },
});

const textOf = (success: typeof PolicyOf.successSchema.Type) =>
  Option.match(views.projectPolicy(success), {
    onNone: () => "",
    onSome: ({ markdown, text }) => text ?? markdown,
  });

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replaceAll(/\s+/gu, " ").trim())
    .filter((line) => line !== "");

describe("policy's text view", () => {
  it("lists each decider glob with its handles, in the policy's order", () => {
    const lines = linesOf(textOf(datekit));

    expect(lines).toContain("** ines-v");
    expect(lines).toContain("src/tz.ts okonkwo, bram");
    expect(lines.indexOf("** ines-v")).toBeLessThan(
      lines.indexOf("src/tz.ts okonkwo, bram")
    );
  });

  it("writes each decider glob as code in Markdown, so `**` reads as a glob, not emphasis", () => {
    const markdown = Option.match(views.projectPolicy(datekit), {
      onNone: () => "",
      onSome: (view) => view.markdown,
    });

    expect(markdown).toContain("| `**` | ines-v |");
    expect(markdown).toContain("| `src/tz.ts` | okonkwo, bram |");
  });

  it("says which commit it is as of, and where it comes from", () => {
    const text = textOf(datekit);

    expect(text).toContain(`As of ${sha.slice(0, 7)}, the landed commit`);
    expect(text).toContain(`${Brand.configDir}/project.ts`);
  });

  it("states the vouch rule in words, with how many are vouched for and denounced", () => {
    const text = textOf(datekit);

    expect(text).toContain(
      "For code: claiming an ask or offering a sealed answer needs a vouch"
    );
    expect(text).toContain(
      `${Brand.configDir}/vouched.td vouches for 2 and denounces 1`
    );
  });

  it("says a vouch file that names nobody vouches for nobody and denounces nobody, as the people page does", () => {
    const text = textOf(
      decodeSuccess({ policy: { ...datekitPolicy, vouches: [] } })
    );

    expect(text).toContain(
      `${Brand.configDir}/vouched.td vouches for nobody and denounces nobody`
    );
  });

  it("shows the caps, the budget, the claim timing and the record window", () => {
    const lines = linesOf(textOf(datekit));

    for (const line of [
      "Claims 3 claims per person at once",
      "Proposals 2 proposals per person at once",
      "Budget 5 decisions a day per decider; an undecided one takes its default after 14 days",
      "Claim timing warned after 2 hours without a push; lapses after 24 hours",
      "Record a landing counts once it has stood 30 days, for 365 days",
    ]) {
      expect(lines).toContain(line);
    }
  });

  // The view sees only the success, which names no project: the next step
  // names it as a placeholder, in the terminal's own short lines.
  it("says a project with no config folder has not been evaluated, why, and the command that makes it evaluate", () => {
    const lines = linesOf(textOf(noConfig));

    expect(lines).toStrictEqual([
      `The config at the landed commit ${sha.slice(0, 7)} has not been evaluated: there is no ${Brand.configDir}/ folder, and no test command in the project's CI or package files.`,
      `Run \`${Brand.cli} init --project <owner>/<name> --dry-run\` in the project's repo to see the ${Brand.configDir}/project.ts it proposes, then have a decider land it.`,
    ]);
  });

  it("names init with --project in the Markdown form too, without the page's clone sentence", () => {
    const view = Option.getOrThrow(views.projectPolicy(noConfig));

    for (const form of [view.markdown, view.text ?? ""]) {
      expect(form).toContain(
        `\`${Brand.cli} init --project <owner>/<name> --dry-run\``
      );
      expect(form.toLowerCase()).not.toContain("in a clone");
    }
  });

  it("says a config folder that did not evaluate has not been evaluated, and to land a fix", () => {
    expect(linesOf(textOf(configFailed))).toStrictEqual([
      `The config at the landed commit ${sha.slice(0, 7)} has not been evaluated: ${Brand.configDir}/ at ${sha.slice(0, 7)} did not evaluate.`,
      `Fix it by landing a change to ${Brand.configDir}/; it is evaluated again at every landing.`,
    ]);
  });

  it("says nothing has landed yet when there is neither a policy nor a reason", () => {
    expect(textOf(decodeSuccess({}))).toContain("Nothing has landed yet");
  });
});

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

const answering = (success: typeof PolicyOf.successSchema.Type) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("projectPolicy", () => Effect.succeed(success))
  );

describe("policy's view of an imported project", () => {
  const imported = decodeSuccess({
    importedFrom: {
      branch: "master",
      url: "https://github.com/dtolnay/anyhow",
    },
    unevaluated: { at: sha, reason: "noConfig" },
  });

  it("leads with where it came from and its branch, as a copy read-only here, then the policy", () => {
    const lines = linesOf(textOf(imported));

    expect(lines[0]).toBe(
      "Imported from https://github.com/dtolnay/anyhow (branch master): this project is a copy of a public repo, read-only here and not run by its maintainers."
    );
    expect(
      lines.some((line) => line.includes("has not been evaluated"))
    ).toBeTruthy();
  });

  it("names no branch when the import named none, and no source for a project that started empty", () => {
    expect(
      textOf(
        decodeSuccess({
          importedFrom: { url: "https://codeberg.org/dnkl/fuzzel" },
        })
      )
    ).toContain("Imported from https://codeberg.org/dnkl/fuzzel: this project");
    expect(textOf(noConfig)).not.toContain("Imported from");
  });
});

describe("policy on the command line", () => {
  it.effect("prints the text view for a person", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(["policy", "--project", "datekit"], {
        handlers: answering(noConfig),
      });

      expect(run.code).toBe(0);
      expect(run.out.join("\n")).toContain("has not been evaluated");
    })
  );

  it.effect("prints the success as JSON under --json", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(
        ["policy", "--project", "datekit", "--json"],
        { handlers: answering(noConfig) }
      );

      expect(run.code).toBe(0);
      expect(run.out).toHaveLength(1);
      expect(yield* decodeEnvelope(run.out[0] ?? "")).toStrictEqual({
        command: "policy",
        data: { unevaluated: { at: sha, reason: "noConfig" } },
        ok: true,
        v: 1,
      });
    })
  );
});
