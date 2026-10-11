/**
 * A project's contribute skill: what a stranger's agent reads to answer one
 * of its asks, generated from the policy at a landing and nothing else. One
 * file, written to `.agents/skills/` and `.claude/skills/`, which between
 * them reach every harness that reads skills.
 */
import { Brand } from "@repo/brand";
import type { Policy } from "@repo/protocol/domain/policy";
import { keyOf } from "@repo/protocol/ids";
import type { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { frontmatter } from "./generated-file.ts";
import type { GeneratedFile } from "./generated-file.ts";
import { refusalSection } from "./refusals.ts";
import {
  changeSection,
  claimTerms,
  kindsSection,
  loopSteps,
  runSection,
  unfencedSection,
} from "./sections.ts";
import { code, page } from "./text.ts";

/**
 * The skill's name: `<key>-contribute`, by the project's key
 * (`datekit-contribute`, `oscabriel_foo-contribute`), its folder's name too,
 * so the forty's skills keep their names and a name reads back to its
 * project (ADR 0032).
 */
export const contributeSkillName = (project: ProjectName) =>
  `${keyOf(project)}-contribute`;

/** Where the skill goes: the folders harnesses read project skills from, `.agents` first. */
export const contributeSkillPaths = (project: ProjectName) => {
  const skill = `skills/${contributeSkillName(project)}/SKILL.md`;

  return [`.agents/${skill}`, `.claude/${skill}`] as const;
};

/** What the skill's frontmatter says it is for. */
export const contributeDescription = (project: ProjectName) =>
  `Answer one of ${project}'s asks on ${Brand.name}: claim it, change only its territory, run \`${Brand.cli} check\`, push it to your fork, and read the verdict. Use when working on ${project}, or when a push to it was refused.`;

/** The skill's body: the loop, then the rules from the policy, then what nothing checks yet. */
export const contributeBody = (project: ProjectName, policy: Policy) =>
  page([
    `# Contribute to ${project}`,
    "",
    `How to answer ${project}'s asks on ${Brand.name}. It is generated from ${project}'s config folder: the gate decides what lands, and where this text and the gate differ, the gate wins. Don't edit it by hand; it is regenerated when the config changes.`,
    "",
    "## The loop",
    "",
    ...loopSteps(),
    "",
    claimTerms(policy),
    "",
    `List the open asks with ${code(`${Brand.cli} asks`)}. Add \`--json\` to any command for one JSON envelope instead of Markdown.`,
    "",
    ...changeSection(policy),
    ...runSection(policy.run),
    ...kindsSection(policy),
    ...refusalSection(),
    ...unfencedSection(policy.agents),
  ]);

/**
 * `.agents/skills/<project>-contribute/SKILL.md` and its `.claude/skills/`
 * copy, the same bytes, with frontmatter naming the landing it came from.
 */
export const projectSkill = (input: {
  readonly project: ProjectName;
  readonly policy: Policy;
  readonly landed: LandedSha;
}): Effect.Effect<readonly GeneratedFile[]> =>
  frontmatter({
    body: contributeBody(input.project, input.policy),
    description: contributeDescription(input.project),
    landed: Option.some(input.landed),
    name: contributeSkillName(input.project),
  }).pipe(
    Effect.map((content) =>
      contributeSkillPaths(input.project).map((path) => ({ content, path }))
    )
  );
