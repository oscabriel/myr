import { Brand } from "@repo/brand";
import type { Policy } from "@repo/protocol/domain/policy";
import type { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { contentHash } from "./generated-file.ts";
import { contributeSkillName, contributeSkillPaths } from "./project-skill.ts";
import { lanesOf, loopSteps, unfencedNorms } from "./sections.ts";
import { code, listed, page } from "./text.ts";

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
    `It needs the ${Brand.name} CLI (the install script on the platform's ${code("/install")} page) signed in with ${code(`${Brand.cli} login --url <platform>`)}, and runs in a clone of the project, ${code(`git clone <platform>/${project}.git`)}, where ${code("<platform>")} is the host this project lives on: in such a clone, ${code("git remote get-url origin")} names it.`,
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

const written = (block: AgentsBlock) =>
  `${block.begin}\n${block.body}${block.body.endsWith("\n") ? "" : "\n"}${block.end}`;

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

const separator = (existing: string) => {
  if (existing === "" || existing.endsWith("\n\n")) {
    return "";
  }

  return existing.endsWith("\n") ? "\n" : "\n\n";
};

export const upsertAgentsBlock = (existing: string, block: AgentsBlock) =>
  Option.match(locate(existing, block.end), {
    onNone: () => `${existing}${separator(existing)}${written(block)}\n`,
    onSome: ({ from, to }) =>
      `${existing.slice(0, from)}${written(block)}${existing.slice(to)}`,
  });
