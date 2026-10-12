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

export const contributeSkillName = (project: ProjectName) =>
  `${keyOf(project)}-contribute`;

export const contributeSkillPaths = (project: ProjectName) => {
  const skill = `skills/${contributeSkillName(project)}/SKILL.md`;

  return [`.agents/${skill}`, `.claude/${skill}`] as const;
};

export const contributeDescription = (project: ProjectName) =>
  `Answer one of ${project}'s asks on ${Brand.name}: claim it, change only its territory, run \`${Brand.cli} check\`, push it to your fork, and read the verdict. Use when working on ${project}, or when a push to it was refused.`;

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
