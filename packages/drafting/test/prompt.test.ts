/**
 * What the model is told: a system prompt from the project's public policy
 * (never its layers), and a user prompt that carries, from attempt 2 on,
 * the last attempt's refusal and the tail of its output.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { Policy } from "@repo/protocol/domain/policy";
import { VisibilityPolicy } from "@repo/protocol/domain/visibility";
import { LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { NotRedFirst } from "@repo/protocol/refusal";
import { aProject } from "@repo/testkit/scenarios";
import { Option, Schema } from "effect";

import type { DraftInput } from "../src/drafted.ts";
import {
  feedbackText,
  policyDigest,
  systemPrompt,
  userPrompt,
} from "../src/prompt.ts";

const { policy } = aProject();

/** Layer facts no prompt may carry. */
const visibility = Schema.decodeSync(VisibilityPolicy)({
  checks: {
    areas: { export: "src/sealed-area/**" },
    attempts: { perClaim: 3, perPersonPerAreaPerWeek: 5 },
    canary: true,
    commit: "salted-sha256-merkle",
    layer: "keepers",
    pin: "claim",
    result: "area-bit",
  },
  env: { setters: "deciders" },
  flows: { noWriteDown: true, release: "deciders" },
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks"],
      name: "keepers",
      readers: "deciders",
      reason: "The sealed-rubric for exports",
      repo: "datekit--keepers",
      writers: "deciders",
    },
  ],
  notice: { narrowingDays: 7 },
});

const firstInput = (attempt: number): DraftInput => ({
  attempt,
  context: {
    at: LandedSha.make("4".repeat(40)),
    files: [
      {
        content: "export const parseISO = () => 0;\n",
        path: RepoPath.make("src/parse.ts"),
      },
    ],
    policy: policyDigest(policy, Option.some("test/asks")),
    project: ProjectName.make("datekit"),
  },
  want: "Parse ISO week dates.",
});

const input = (attempt: number, feedback?: string): DraftInput =>
  feedback === undefined
    ? firstInput(attempt)
    : { ...firstInput(attempt), feedback };

describe("the prompts", () => {
  it("never carry a layer's name, repo, reason or paths", () => {
    // A whole policy is a PublicPolicy too; the digest reads only its public fields.
    const withLayers: Policy = { ...policy, visibility };
    const digest = policyDigest(withLayers, Option.some("test/asks"));

    const system = systemPrompt(digest);

    for (const secret of [
      "keepers",
      "datekit--keepers",
      "sealed-rubric",
      "src/sealed-area",
    ]) {
      expect(system).not.toContain(secret);
    }

    expect(system).toContain(Brand.name);
    expect(system).toContain("bun test {path}");
    expect(system).toContain("test/asks");
    expect(system).toContain("fix");
  });

  it("give attempt 2 the rendered refusal and the output's tail, cut at 4 KB", () => {
    const stdout = `${"early line\n".repeat(1000)}expected 2 to be 3\n`;

    const feedback = feedbackText({
      diagnosis: "Passed",
      excerpt: stdout,
      refusal: new NotRedFirst({}),
    });

    const prompt = userPrompt(input(2, feedback));

    expect(prompt).toContain(
      "NotRedFirst: the ask's check must fail on main twice in the same way, by an assertion"
    );
    expect(prompt).toContain("diagnosis: Passed");

    const tail = feedback.slice(feedback.indexOf("output (its end):\n") + 18);

    expect(new TextEncoder().encode(tail).length).toBeLessThanOrEqual(4 * 1024);
    expect(tail.endsWith("early line\nexpected 2 to be 3\n")).toBeTruthy();
    expect(tail.startsWith("early line\n")).toBeTruthy();
  });

  it("give attempt 1 the want and the files, and no feedback", () => {
    const prompt = userPrompt(input(1));

    expect(prompt).toContain("Parse ISO week dates.");
    expect(prompt).toContain("src/parse.ts");
    expect(prompt).toContain("export const parseISO = () => 0;");
    expect(prompt).not.toContain("NotRedFirst");
  });
});
