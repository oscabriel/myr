import { agentsBlock, upsertAgentsBlock } from "@repo/agent-kit/agents-block";
import { projectSkill } from "@repo/agent-kit/project-skill";
import { ProjectGenerator } from "@repo/project/generated";
import type { Generate } from "@repo/project/generated";
import { Effect, Layer, Option } from "effect";

const agentsFile = "AGENTS.md";

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

export const ProjectSkillGenerator = Layer.succeed(ProjectGenerator, generate);
