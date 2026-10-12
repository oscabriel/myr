// A skill copy without the platform's frontmatter is stale: its path is the platform's, so the frontmatter was taken off.
import { agentsBlock, upsertAgentsBlock } from "@repo/agent-kit/agents-block";
import { isStale } from "@repo/agent-kit/generated-file";
import { projectSkill } from "@repo/agent-kit/project-skill";
import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, FileSystem, Option, Path } from "effect";

export interface StaleCopy {
  readonly path: string;
  readonly landed: Option.Option<LandedSha>;
}

const agentsFile = "AGENTS.md";

export const staleGenerated = (input: {
  readonly root: string;
  readonly project: ProjectName;
  readonly policy: Policy;
  readonly landed: LandedSha;
}): Effect.Effect<
  readonly StaleCopy[],
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { landed, policy, project } = input;

    const onDisk = (file: string) =>
      Effect.option(fs.readFileString(path.join(input.root, file)));

    const skills = yield* projectSkill({ landed, policy, project });

    const staleSkills = yield* Effect.forEach(skills, (current) =>
      Effect.gen(function* () {
        const copy = yield* onDisk(current.path);

        if (Option.isNone(copy)) {
          return [];
        }

        const stale = yield* isStale(copy.value, current);

        return Option.match(stale, {
          onNone: (): readonly StaleCopy[] => [],
          onSome: (found) => [{ landed: found.landed, path: current.path }],
        });
      })
    );

    const block = yield* agentsBlock({ landed, policy, project });
    const agents = yield* onDisk(agentsFile);

    const blockStale = Option.exists(
      agents,
      (text) =>
        text.includes(block.end) && upsertAgentsBlock(text, block) !== text
    );

    return [
      ...staleSkills.flat(),
      ...(blockStale ? [{ landed: Option.none(), path: agentsFile }] : []),
    ];
  });
