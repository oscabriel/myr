import { describe, expect, it } from "@effect/vitest";
import { creditsOf, parseTrailers } from "@repo/git/trailers";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import { Handle, LandedSha } from "@repo/protocol/ids";
import { aProject } from "@repo/testkit/scenarios";
import { DateTime, Effect, Option, Schema } from "effect";

import { platformHandle } from "../src/attention/effects.ts";
import { generatedFollowUp, generatedRequestId } from "../src/generated.ts";
import type { Generate } from "../src/generated.ts";

const scenario = aProject({ deciders: ["alice", "dora"], people: ["bob"] });

const { initializer, project } = scenario;

const alice = initializer;

const dora = Handle.make("dora");

const bob = Handle.make("bob");

const parent = LandedSha.make("1".repeat(40));

const landed = LandedSha.make("2".repeat(40));

/** The policy before the landing: lint and types. */
const before: Policy = { ...scenario.policy, at: parent };

/** The same policy at the landing, read again there: nothing it says changed. */
const unchanged: Policy = { ...scenario.policy, at: landed };

/** The policy at the landing, with a unit lane added to the run block. */
const withUnit: Policy = {
  ...unchanged,
  run: Schema.decodeSync(RunBlock)({
    checks: {
      lint: "bun run lint",
      types: "bun run typecheck",
      unit: "bun run test",
    },
    test: "bun test {path}",
  }),
};

const skill = `.agents/skills/${project}-contribute/SKILL.md`;

const claudeSkill = `.claude/skills/${project}-contribute/SKILL.md`;

/**
 * A generator as `@repo/agent-kit` is one, in miniature: the skill, twice,
 * naming the landing and the run block's lanes, and AGENTS.md with only the
 * text between its markers written over (appended when there are none).
 */
const generate: Generate = ({ landed: at, policy, read }) =>
  Effect.gen(function* () {
    const lanes = Object.entries(policy.run.checks)
      .map(([lane, command]) => `${lane}: ${command}`)
      .join(", ");

    const content = `---\nlanded: ${at}\n---\nLanes: ${lanes}\n`;
    const block = `<!-- BEGIN -->\nLanes: ${lanes}\n<!-- END -->`;
    const existing = Option.getOrElse(yield* read("AGENTS.md"), () => "");
    const begin = existing.indexOf("<!-- BEGIN -->");
    const end = existing.indexOf("<!-- END -->");

    const agents =
      begin === -1 || end === -1
        ? `${existing}${block}\n`
        : `${existing.slice(0, begin)}${block}${existing.slice(end + "<!-- END -->".length)}`;

    return [
      { content, path: skill },
      { content, path: claudeSkill },
      { content: agents, path: "AGENTS.md" },
    ];
  });

/** The project's own AGENTS.md, with a block the platform wrote before. */
const ownAgents = [
  "# Datekit",
  "",
  "Our notes.",
  "",
  "<!-- BEGIN -->",
  "Lanes: lint: bun run lint",
  "<!-- END -->",
  "",
  "More notes.",
  "",
].join("\n");

/** A tree that holds `files` and nothing else. */
const treeOf =
  (files: Readonly<Record<string, string>>) =>
  (path: string): Effect.Effect<Option.Option<string>> =>
    Effect.succeed(Option.fromUndefinedOr(files[path]));

const at = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

/** alice's own landing from her working fork, which changed the config. */
const aliceLands: LandingView = {
  assisted: [],
  author: alice,
  credits: [{ handle: alice, role: "Signed-off-by" }],
  landedAt: at,
  parent,
  project,
  sha: landed,
};

/** The first adoption: the initializer's first push, crediting no one. */
const firstPush: LandingView = {
  assisted: [],
  author: alice,
  credits: [],
  landedAt: at,
  project,
  sha: landed,
};

const followUp = (input: {
  readonly before: Option.Option<Policy>;
  readonly after: Policy;
  readonly landing: LandingView;
  readonly tree?: Readonly<Record<string, string>>;
}) =>
  generatedFollowUp(
    {
      after: input.after,
      before: input.before,
      initializer,
      landing: input.landing,
      project,
      read: treeOf(input.tree ?? { "AGENTS.md": ownAgents }),
    },
    generate
  );

const subjectOf = (message: string) => message.split("\n")[0] ?? "";

/** Whom the follow-up of `landing`, after the run block changed, credits. */
const creditOf = (landing: LandingView) =>
  Effect.map(
    followUp({ after: withUnit, before: Option.some(before), landing }),
    Option.map(({ credits }) => credits)
  );

describe(generatedFollowUp, () => {
  it.effect(
    "follows a landing that changed the run block with the regenerated files alone, credited to its decider",
    () =>
      Effect.gen(function* () {
        const made = yield* followUp({
          after: withUnit,
          before: Option.some(before),
          landing: aliceLands,
        });

        const lanes =
          "Lanes: lint: bun run lint, types: bun run typecheck, unit: bun run test";

        const skillText = `---\nlanded: ${landed}\n---\n${lanes}\n`;

        expect(Option.map(made, ({ files }) => files)).toStrictEqual(
          Option.some([
            { content: skillText, path: skill },
            { content: skillText, path: claudeSkill },
            {
              content: [
                "# Datekit",
                "",
                "Our notes.",
                "",
                "<!-- BEGIN -->",
                lanes,
                "<!-- END -->",
                "",
                "More notes.",
                "",
              ].join("\n"),
              path: "AGENTS.md",
            },
          ])
        );

        const { author, credits, message, requestId } = Option.getOrThrow(made);

        expect({
          author,
          credits,
          requestId,
          subject: subjectOf(message),
          trailers: creditsOf(message).credits,
          trailersRequest: parseTrailers(message).find(
            ({ key }) => key === "Request-Id"
          )?.value,
        }).toStrictEqual({
          author: platformHandle,
          credits: [{ handle: alice, role: "Decided-by" }],
          requestId: `gen-${landed}`,
          subject: "Regenerate the contribute skill and the AGENTS.md block",
          trailers: [{ handle: alice, role: "Decided-by" }],
          trailersRequest: `gen-${landed}`,
        });
      })
  );

  it.effect("lands nothing after a landing that changed only src/", () =>
    Effect.gen(function* () {
      expect(
        yield* followUp({
          after: unchanged,
          before: Option.some(before),
          landing: aliceLands,
          tree: {},
        })
      ).toStrictEqual(Option.none());
    })
  );

  it.effect("makes the same files from the same input", () =>
    Effect.gen(function* () {
      const input = {
        after: withUnit,
        before: Option.some(before),
        landing: aliceLands,
      };

      expect(yield* followUp(input)).toStrictEqual(yield* followUp(input));
    })
  );

  it.effect(
    "lands nothing when the tree already holds the regenerated files, as after a replay",
    () =>
      Effect.gen(function* () {
        const made = Option.getOrThrow(
          yield* followUp({
            after: withUnit,
            before: Option.some(before),
            landing: aliceLands,
          })
        );

        const regenerated = Object.fromEntries(
          made.files.map(({ content, path }) => [path, content])
        );

        expect(
          yield* followUp({
            after: withUnit,
            before: Option.some(before),
            landing: aliceLands,
            tree: regenerated,
          })
        ).toStrictEqual(Option.none());
      })
  );

  it.effect(
    "follows the first adoption, which had no policy before, crediting the initializer",
    () =>
      Effect.gen(function* () {
        const made = yield* followUp({
          after: unchanged,
          before: Option.none(),
          landing: firstPush,
          tree: {},
        });

        expect(
          Option.map(made, ({ credits, files }) => ({
            credits,
            paths: files.map(({ path }) => path),
          }))
        ).toStrictEqual(
          Option.some({
            credits: [{ handle: alice, role: "Decided-by" }],
            paths: [skill, claudeSkill, "AGENTS.md"],
          })
        );
      })
  );

  it.effect(
    "credits the landing's Decided-by first, then its author if they decide the config, else the initializer",
    () =>
      Effect.gen(function* () {
        const decidedByDora: LandingView = {
          ...aliceLands,
          author: bob,
          credits: [
            { handle: bob, role: "Signed-off-by" },
            { handle: dora, role: "Decided-by" },
          ],
        };

        const bobAlone: LandingView = {
          ...aliceLands,
          author: bob,
          credits: [{ handle: bob, role: "Signed-off-by" }],
        };

        expect({
          bob: yield* creditOf(bobAlone),
          dora: yield* creditOf(decidedByDora),
        }).toStrictEqual({
          bob: Option.some([{ handle: alice, role: "Decided-by" }]),
          dora: Option.some([{ handle: dora, role: "Decided-by" }]),
        });
      })
  );

  it("names its request for the landing it follows", () => {
    expect(generatedRequestId(landed)).toBe(`gen-${landed}`);
  });
});
