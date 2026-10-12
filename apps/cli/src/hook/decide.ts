// A hook is early feedback and the gateway stays the authority, so anything it cannot judge it allows.
import { claudeEventOf } from "@repo/agent-kit/hook-events";
import type { HookEvent } from "@repo/agent-kit/hook-events";
import { Brand } from "@repo/brand";
import { matchAny } from "@repo/gate/glob";
import type { Policy } from "@repo/protocol/domain/policy";
import { Territory } from "@repo/protocol/domain/territory";
import { AskId, CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { OutOfScope, TouchedJudge } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Array, Option, Predicate, Schema } from "effect";

import type { HookInput } from "./input.ts";

export const HookClaim = Schema.Struct({
  ask: AskId,
  base: CommitSha,
  checkCommand: Schema.NonEmptyString,
  project: ProjectName,
  territory: Territory,
  want: Schema.NonEmptyString,
});

export type HookClaim = typeof HookClaim.Type;

export interface HookFacts {
  readonly root: string;
  readonly claim: Option.Option<HookClaim>;
  readonly judge: Policy["judge"];
  readonly refusals: readonly Refusal[];
  readonly holds: number;
}

type GoOn = Readonly<Record<string, never>>;

interface Deny {
  readonly hookSpecificOutput: {
    readonly hookEventName: (typeof claudeEventOf)["pre-tool-use"];
    readonly permissionDecision: "deny";
    readonly permissionDecisionReason: string;
  };
}

interface Brief {
  readonly hookSpecificOutput: {
    readonly additionalContext: string;
    readonly hookEventName: (typeof claudeEventOf)["session-start"];
  };
}

interface Hold {
  readonly decision: "block";
  readonly reason: string;
}

export type HookOutput = GoOn | Deny | Brief | Hold;

export interface HookDecision {
  readonly output: HookOutput;
  readonly holds: number;
  readonly note: Option.Option<string>;
}

const NO_CLAIM =
  "no claim in this session's repo, so the hook allows everything; the gateway still judges every push";

const allow = (holds: number, note?: string): HookDecision => ({
  holds,
  note: Option.fromUndefinedOr(note),
  output: {},
});


const normalize = (path: string) => {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return `/${parts.join("/")}`;
};

const repoPathOf = (
  root: string,
  cwd: string,
  file: string
): Option.Option<RepoPath> => {
  const top = normalize(root);
  const absolute = normalize(file.startsWith("/") ? file : `${cwd}/${file}`);
  const prefix = top === "/" ? "/" : `${top}/`;

  return absolute.startsWith(prefix) && absolute.length > prefix.length
    ? Option.some(RepoPath.make(absolute.slice(prefix.length)))
    : Option.none();
};

const WRITERS = new Map([
  ["Edit", "file_path"],
  ["MultiEdit", "file_path"],
  ["NotebookEdit", "notebook_path"],
  ["Write", "file_path"],
]);

const fileOf = (input: HookInput): Option.Option<string> =>
  Option.flatMap(Option.fromUndefinedOr(input.tool_name), (name) =>
    Option.flatMap(Option.fromUndefinedOr(WRITERS.get(name)), (key) =>
      Option.filter(
        Option.fromNullishOr(input.tool_input?.[key]),
        Predicate.isString
      )
    )
  );

const pathRefusals = (
  claim: HookClaim,
  judge: Policy["judge"],
  path: RepoPath
): readonly Refusal[] => {
  if (matchAny(judge.paths, path)) {
    return [new TouchedJudge({ paths: [path] })];
  }

  return matchAny(claim.territory.paths, path)
    ? []
    : [new OutOfScope({ paths: [path] })];
};

export const toolRefusals = (
  input: HookInput,
  facts: Pick<HookFacts, "claim" | "judge" | "root">
): readonly Refusal[] =>
  Option.match(facts.claim, {
    onNone: () => [],
    onSome: (claim) =>
      Option.match(
        Option.flatMap(fileOf(input), (file) =>
          repoPathOf(facts.root, input.cwd, file)
        ),
        {
          onNone: () => [],
          onSome: (path) => pathRefusals(claim, facts.judge, path),
        }
      ),
  });

const preToolUse = (input: HookInput, facts: HookFacts): HookDecision =>
  Option.match(facts.claim, {
    onNone: () => allow(facts.holds, NO_CLAIM),
    onSome: () => {
      const refusals = toolRefusals(input, facts);

      return Array.isReadonlyArrayNonEmpty(refusals)
        ? {
            holds: facts.holds,
            note: Option.none(),
            output: {
              hookSpecificOutput: {
                hookEventName: claudeEventOf["pre-tool-use"],
                permissionDecision: "deny",
                permissionDecisionReason: explain(refusals).join("\n"),
              },
            },
          }
        : allow(facts.holds);
    },
  });


const bullets = (items: readonly string[]) =>
  items.map((item) => `- \`${item}\``);

const brief = ({ ask, checkCommand, project, territory, want }: HookClaim) =>
  [
    `# Your claim: ${ask} in ${project}`,
    "",
    `**Want:** ${want}`,
    "",
    // A paths territory (module `.`) reads as its paths alone.
    territory.module === "."
      ? "**Territory:** these paths. Change only these:"
      : `**Territory:** the module \`${territory.module}\`. Change only these paths:`,
    ...bullets(territory.paths),
    ...(territory.publicFiles === undefined ||
    territory.publicFiles.length === 0
      ? []
      : [
          "",
          `**Public files:** what \`${territory.module}\` exports; other modules import only these:`,
          ...bullets(territory.publicFiles),
        ]),
    "",
    `**Check:** \`${checkCommand}\``,
    "",
    "Files that decide what the checks do (the config folder, test and lint config, CI and hook files, the ask's own check) are not yours to change. An edit outside the territory or to one of those files is refused at push; this session's hooks deny it before it is made, with the same text.",
    "",
    `Run \`${Brand.cli} check\` before you push.`,
  ].join("\n");

const sessionStart = (facts: HookFacts): HookDecision =>
  Option.match(facts.claim, {
    onNone: () => allow(facts.holds, NO_CLAIM),
    onSome: (claim) => ({
      holds: facts.holds,
      note: Option.none(),
      output: {
        hookSpecificOutput: {
          additionalContext: brief(claim),
          hookEventName: claudeEventOf["session-start"],
        },
      },
    }),
  });


export const MAX_HOLDS = 3;

/** A retryable refusal never holds. `stop_hook_active` counts as at least one hold even if the session's count was lost. */
const stopHook = (input: HookInput, facts: HookFacts): HookDecision => {
  const before =
    input.stop_hook_active === true ? Math.max(facts.holds, 1) : facts.holds;

  const fixable = facts.refusals.filter((refusal) => !refusal.retryable);

  if (Option.isNone(facts.claim)) {
    return allow(0, NO_CLAIM);
  }

  if (!Array.isReadonlyArrayNonEmpty(fixable)) {
    return allow(0);
  }

  if (before >= MAX_HOLDS) {
    return allow(
      0,
      `held ${MAX_HOLDS} times in a row; letting the agent stop, though ${Brand.cli} check still refuses its work (${fixable.map((refusal) => refusal._tag).join(", ")})`
    );
  }

  return {
    holds: before + 1,
    note: Option.none(),
    output: { decision: "block", reason: explain(fixable).join("\n") },
  };
};

const policies = {
  "pre-tool-use": preToolUse,
  "session-start": (_input, facts) => sessionStart(facts),
  stop: stopHook,
} as const satisfies Record<
  HookEvent,
  (input: HookInput, facts: HookFacts) => HookDecision
>;

export const decideHook = (
  event: HookEvent,
  input: HookInput,
  facts: HookFacts
): HookDecision => policies[event](input, facts);
