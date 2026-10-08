/**
 * Generated agent files from a project's policy: the contribute skill, the
 * AGENTS.md block, the harness plugins and their hooks, and the well-known
 * skills index. Each module is its own subpath too
 * (`@repo/agent-kit/hook-events`).
 */
export { agentsBlock, upsertAgentsBlock } from "./agents-block.ts";

export type { AgentsBlock } from "./agents-block.ts";

export {
  CommandDoc,
  contractCommandDocs,
  localCommandDocs,
} from "./command-doc.ts";

export {
  contentHash,
  frontmatter,
  isStale,
  readManaged,
} from "./generated-file.ts";

export type { GeneratedFile, Managed } from "./generated-file.ts";

export { claudeEventOf, guardedTools, HookEvent } from "./hook-events.ts";

export { agentPluginsBundle, claudePlugin, platformSkill } from "./platform.ts";

export type { PlatformInput } from "./platform.ts";

export {
  contributeSkillName,
  contributeSkillPaths,
  projectSkill,
} from "./project-skill.ts";

export { wellKnownSkills } from "./well-known.ts";

export type { SkillEntry } from "./well-known.ts";
