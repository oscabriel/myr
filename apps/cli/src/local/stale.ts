/**
 * Stale generated files in a working copy (W4 410): the project's
 * contribute skill (`.agents/skills/<project>-contribute/SKILL.md` and its
 * `.claude/skills/` copy) and the block in its AGENTS.md, regenerated here
 * with `@repo/agent-kit` from the policy at `main` and compared with what is
 * on disk. The platform lands them again whenever the config changes what
 * they say, so a copy that differs was generated for an older config, or
 * was edited by hand; `<cli> check` warns about each one and lists it.
 *
 * Read only: nothing here writes a file. A file that is missing, or one the
 * platform does not manage (a skill with no frontmatter of ours, an
 * AGENTS.md with no block), is no copy, and never stale.
 */
import { agentsBlock, upsertAgentsBlock } from "@repo/agent-kit/agents-block";
import { isStale } from "@repo/agent-kit/generated-file";
import { projectSkill } from "@repo/agent-kit/project-skill";
import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, FileSystem, Option, Path } from "effect";

/** A generated file on disk that is not what main's policy gives, and the landing its copy names. */
export interface StaleCopy {
  readonly path: string;
  /** The landing the copy says it came from; none for the AGENTS.md block, which names none. */
  readonly landed: Option.Option<LandedSha>;
}

const agentsFile = "AGENTS.md";

/**
 * Every generated file in the working copy at `root` that differs from the
 * one `policy` (read at the landing `landed`) gives: the skill's copies by
 * their recorded hash (`isStale`), the AGENTS.md block by its text.
 */
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
