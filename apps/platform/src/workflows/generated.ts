/**
 * The platform's generator for a project's own agent files (spec D12, W4
 * 410): the contribute skill (`.agents/skills/<project>-contribute/SKILL.md`
 * and its `.claude/skills/` copy) and the block in the project's AGENTS.md,
 * from `@repo/agent-kit`, which `@repo/project` may not import (spec §4.1).
 *
 * The Project DO runs it after any landing that moved its landed SHA
 * (`@repo/project/generated`): when the policy read there changes what the
 * files say, the DO lands them as a separate platform commit, composed onto
 * main and landed through the Lander like every platform landing, with the
 * request id `gen-<landed>`. `ProjectSkillGenerator` is the layer a DO's
 * ports carry it in; a project whose ports leave it out generates nothing.
 */
import { agentsBlock, upsertAgentsBlock } from "@repo/agent-kit/agents-block";
import { projectSkill } from "@repo/agent-kit/project-skill";
import { ProjectGenerator } from "@repo/project/generated";
import type { Generate } from "@repo/project/generated";
import { Effect, Layer, Option } from "effect";

/** The project's own AGENTS.md: only the block between the platform's markers is written. */
const agentsFile = "AGENTS.md";

/**
 * The skill, in both places harnesses read it, and AGENTS.md as the landed
 * tree has it with the block put in (appended after a blank line when the
 * file has none; made when there is no file).
 */
export const generate: Generate = ({ landed, policy, project, read }) =>
  Effect.gen(function* () {
    const skills = yield* projectSkill({ landed, policy, project });
    const block = yield* agentsBlock({ landed, policy, project });
    const existing = Option.getOrElse(yield* read(agentsFile), () => "");

    return [
      ...skills,
      { content: upsertAgentsBlock(existing, block), path: agentsFile },
    ];
  });

/** The generator, for a Project DO's ports. */
export const ProjectSkillGenerator = Layer.succeed(ProjectGenerator, generate);
