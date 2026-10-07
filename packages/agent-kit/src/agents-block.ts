/**
 * The AGENTS.md block: the brief every harness reads without installing
 * anything, between markers the platform owns. The first marker carries the
 * body's hash, so a hand-edited block is detectable; everything outside the
 * markers belongs to the project and is never touched.
 */
import { Brand } from "@repo/brand";
import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { contentHash } from "./generated-file.ts";
import { contributeSkillName, contributeSkillPaths } from "./project-skill.ts";
import { lanesOf, loopSteps, unfencedNorms } from "./sections.ts";
import { code, listed, page } from "./text.ts";

/** The block: its two marker lines and the text between them. */
export interface AgentsBlock {
  readonly begin: string;
  readonly end: string;
  readonly body: string;
}

const BEGIN = `<!-- BEGIN ${Brand.slug} contribute`;

const END = `<!-- END ${Brand.slug} contribute -->`;

const rules = (policy: Policy) => {
  const { judge, run, weakening } = policy;
  const closure = [...judge.paths, ...judge.pointers];

  return [
    "- Change only files in the ask's territory; a push that changes anything else is refused with `OutOfScope`.",
    ...(closure.length === 0
      ? []
      : [
          `- Never change the judge closure (${closure.map(code).join(", ")}); a push that does is refused with \`TouchedJudge\`.`,
        ]),
    ...(weakening.markers.length === 0
      ? []
      : [
          `- Never add a marker that turns a check off (${weakening.markers.map(code).join(", ")}); one without a reason is refused with \`Weakened\`.`,
        ]),
    `- Test one file with ${code(run.test)}. The lanes are ${listed(lanesOf(run).map(([lane, command]) => `${code(lane)} (${code(command)})`))}.`,
    "- Every refusal has a `_tag`, `retryable` and `next`: run `next`. Add `--json` to any command for JSON.",
  ];
};

const bodyOf = (project: ProjectName, policy: Policy) => {
  const [agentsPath] = contributeSkillPaths(project);

  return page([
    `## Contributing to ${project}`,
    "",
    `This project takes changes through ${Brand.name}: an answer to one of its asks lands only by passing the gate. This block is generated from the config folder, and the gate decides what lands. The full guide is the ${code(contributeSkillName(project))} skill (${code(agentsPath)}).`,
    "",
    ...loopSteps(),
    "",
    ...rules(policy),
    "",
    "No fence yet: nothing checks these, so the gate won't refuse you for them.",
    "",
    ...unfencedNorms(policy.agents),
  ]);
};

/**
 * The block for a project's AGENTS.md, from its policy alone: the landing
 * changes nothing in it, so a landing that leaves the policy's text alone
 * leaves the block, and its hash, as they were.
 */
export const agentsBlock = (input: {
  readonly project: ProjectName;
  readonly policy: Policy;
  readonly landed: LandedSha;
}): Effect.Effect<AgentsBlock> => {
  const body = bodyOf(input.project, input.policy);

  return contentHash(body).pipe(
    Effect.map((hash) => ({
      begin: `${BEGIN} (generated; content-hash: ${hash}) -->`,
      body,
      end: END,
    }))
  );
};

/** The block as a file holds it: the markers on lines of their own. */
const written = (block: AgentsBlock) =>
  `${block.begin}\n${block.body}${block.body.endsWith("\n") ? "" : "\n"}${block.end}`;

/** Where an existing block starts and ends, whatever hash its first marker carries. */
const locate = (
  existing: string,
  end: string
): Option.Option<{ readonly from: number; readonly to: number }> => {
  const to = existing.indexOf(end);

  if (to === -1) {
    return Option.none();
  }

  const from = existing.lastIndexOf(BEGIN, to);

  const marker =
    from !== -1 &&
    (from === 0 || existing[from - 1] === "\n") &&
    existing[from + BEGIN.length] === " ";

  return marker ? Option.some({ from, to: to + end.length }) : Option.none();
};

/** What goes between a file's last text and an appended block: one blank line. */
const separator = (existing: string) => {
  if (existing === "" || existing.endsWith("\n\n")) {
    return "";
  }

  return existing.endsWith("\n") ? "\n" : "\n\n";
};

/**
 * `existing` with the block in it: replacing the text from the first marker
 * to the last where a block is, appending it after a blank line where none
 * is. Every other byte stays as it was, and a second call changes nothing.
 */
export const upsertAgentsBlock = (existing: string, block: AgentsBlock) =>
  Option.match(locate(existing, block.end), {
    onNone: () => `${existing}${separator(existing)}${written(block)}\n`,
    onSome: ({ from, to }) =>
      `${existing.slice(0, from)}${written(block)}${existing.slice(to)}`,
  });
