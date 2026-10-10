/**
 * The one hook policy: what `<cli> hook <event>` answers a harness, from
 * facts gathered elsewhere. Pure, so every harness adapter (Claude Code's
 * hook format here; pi's events in `../pi.ts`) asks the same function.
 *
 * It writes no second policy: a path's refusal is the gate's own reading of
 * the territory and the judge closure (`@repo/gate/glob`, over the closure
 * `@repo/checks` computes), and its text is `@repo/protocol/render`'s
 * `explain`, the very lines the gateway sends. The gateway stays the
 * authority; a hook is early feedback, so anything it cannot judge it allows.
 */
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

/** The claim this session works on, as the hook needs it. */
export const HookClaim = Schema.Struct({
  ask: AskId,
  /** Main when the claim was made: where the gateway's diff of an answer starts. */
  base: CommitSha,
  /** What `<cli> check` runs locally for the ask: the claim's own. */
  checkCommand: Schema.NonEmptyString,
  project: ProjectName,
  territory: Territory,
  want: Schema.NonEmptyString,
});

export type HookClaim = typeof HookClaim.Type;

/** What the policy decides over. */
export interface HookFacts {
  /** The repo's top folder. */
  readonly root: string;
  readonly claim: Option.Option<HookClaim>;
  /** The judge closure at the claim's base, with the ask's own files. */
  readonly judge: Policy["judge"];
  /** Stop only: what `<cli> check --shape-only` refuses now; none when it passes. */
  readonly refusals: readonly Refusal[];
  /** Stop holds in a row this session, before this event. */
  readonly holds: number;
}

/** Go on, as the harness would without the hook: `{}`, with no field at all. */
type GoOn = Readonly<Record<string, never>>;

/** Claude Code's PreToolUse denial: the tool does not run, and the agent reads the reason. */
interface Deny {
  readonly hookSpecificOutput: {
    readonly hookEventName: (typeof claudeEventOf)["pre-tool-use"];
    readonly permissionDecision: "deny";
    readonly permissionDecisionReason: string;
  };
}

/** Claude Code's SessionStart context: Markdown the agent reads first. */
interface Brief {
  readonly hookSpecificOutput: {
    readonly additionalContext: string;
    readonly hookEventName: (typeof claudeEventOf)["session-start"];
  };
}

/** Claude Code's Stop hold: the agent goes on, with the reason as its next prompt. */
interface Hold {
  readonly decision: "block";
  readonly reason: string;
}

/** The exact JSON written to stdout. */
export type HookOutput = GoOn | Deny | Brief | Hold;

/** The answer, the holds in a row after it, and a line for stderr. */
export interface HookDecision {
  readonly output: HookOutput;
  readonly holds: number;
  readonly note: Option.Option<string>;
}

const NO_CLAIM =
  "no claim in this session's repo, so the hook allows everything; the gateway still judges every push";

/** Go on, as the harness would without the hook. */
const allow = (holds: number, note?: string): HookDecision => ({
  holds,
  note: Option.fromUndefinedOr(note),
  output: {},
});

// ------------------------------------------------------------ paths

/** `path` with `.` and `..` resolved and no empty segments: `/a/b`. */
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

/**
 * The repo path a tool's file names: absolute, or relative to the
 * harness's cwd. A file outside the repo, or the root itself, is none.
 */
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

/** The tools that write a file, and the input key that names it. */
const WRITERS = new Map([
  ["Edit", "file_path"],
  ["MultiEdit", "file_path"],
  ["NotebookEdit", "notebook_path"],
  ["Write", "file_path"],
]);

/** The file a writing tool is about to change, if the call is one. */
const fileOf = (input: HookInput): Option.Option<string> =>
  Option.flatMap(Option.fromUndefinedOr(input.tool_name), (name) =>
    Option.flatMap(Option.fromUndefinedOr(WRITERS.get(name)), (key) =>
      Option.filter(
        Option.fromNullishOr(input.tool_input?.[key]),
        Predicate.isString
      )
    )
  );

/**
 * What the gate's shape stage says of one changed path: a judged path is
 * `TouchedJudge` wherever it is, any other path outside the territory is
 * `OutOfScope`, as `@repo/gate/stages/shape` reads them.
 */
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

/**
 * What the gate's shape stage would refuse of the file a writing tool is
 * about to change: none without a claim, for a tool that writes no file, or
 * for a file outside the repo. Every harness's edit guard asks this (Claude
 * Code's pre-tool-use below; pi's `edit` and `write` in `../pi.ts`).
 */
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

// ------------------------------------------------------------ brief

const bullets = (items: readonly string[]) =>
  items.map((item) => `- \`${item}\``);

/** The claim as the agent reads it first, in Markdown. */
const brief = ({ ask, checkCommand, project, territory, want }: HookClaim) =>
  [
    `# Your claim: ${ask} in ${project}`,
    "",
    `**Want:** ${want}`,
    "",
    // A paths territory (module `.`) is no module a reader would know: it
    // reads as its paths alone, as the project's own brief does.
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

// ------------------------------------------------------------ stop

/** The most Stop holds in a row; the next stop goes through. */
export const MAX_HOLDS = 3;

/**
 * Stop holds the agent while `<cli> check --shape-only` refuses its work
 * with a refusal it can fix, at most `MAX_HOLDS` times in a row. A retryable
 * refusal is a wait (the repo was busy, a lane flaked), not the agent's to
 * fix, so it never holds. Claude Code's `stop_hook_active` says this stop
 * follows a hold, so it counts as at least one even when the session's own
 * count was lost; nothing but an allowed stop resets the count, so the cap
 * holds whatever a harness sends.
 */
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

/** Each event's policy. */
const policies = {
  "pre-tool-use": preToolUse,
  "session-start": (_input, facts) => sessionStart(facts),
  stop: stopHook,
} as const satisfies Record<
  HookEvent,
  (input: HookInput, facts: HookFacts) => HookDecision
>;

/**
 * What the hook answers `event`: `{}` to let the harness go on, or Claude
 * Code's own form of a brief, a denial or a hold.
 */
export const decideHook = (
  event: HookEvent,
  input: HookInput,
  facts: HookFacts
): HookDecision => policies[event](input, facts);
