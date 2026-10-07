// Ported from joelhooks/rat-stack@fba26d8 `.pi/extensions/git-interceptor/index.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
/**
 * pi's side of the hook policy: before pi's bash tool runs a command, ask
 * `decide`, and block a refused command with its reason. pi's own `read`,
 * `edit` and `grep` tools are blocked from the closed env files the policy
 * keeps shell reads away from. The types below are
 * the slice of pi's extension API this file uses, checked against pi 1.0.4's
 * `dist/core/extensions/types.d.ts`; pi itself is not a dependency here.
 */
import { Option, Schema } from "effect";

import {
  Decision,
  decide,
  isClosedEnvPath,
  reasons,
} from "../../../scripts/hooks/lib/policy.ts";

/** pi's `ToolCallEvent`, as far as this extension reads it. */
interface ToolCall {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** pi's `ToolCallEventResult`: block the call, with a reason for the agent. */
interface Block {
  readonly block: true;
  readonly reason: string;
}

/** pi's `ExtensionAPI`, as far as this extension uses it. */
export interface PiApi {
  on(
    event: "tool_call",
    handler: (event: ToolCall) => Block | undefined
  ): unknown;
}

/** pi's `BashToolInput`, as far as the policy reads it. */
const BashInput = Schema.Struct({ command: Schema.String });

/** pi's `read`, `edit` and `grep` inputs, as far as the policy reads them. */
const PathInput = Schema.Struct({ path: Schema.optionalKey(Schema.String) });

/** pi's tools that open a file's contents at their `path`. */
const READERS: ReadonlySet<string> = new Set(["edit", "grep", "read"]);

const CLOSED_READ: Block = {
  block: true,
  reason: `vcs-policy refused this read (closed-env-read): ${reasons["closed-env-read"]}`,
};

const UNREADABLE: Block = {
  block: true,
  reason:
    "vcs-policy could not read a shell command from this bash call, so it refuses it.",
};

const blockFor = (command: string): Block | undefined => {
  const decision = decide(command);

  return Decision.$is("Deny")(decision)
    ? {
        block: true,
        reason: `vcs-policy refused this command (${decision.rule}): ${decision.reason}`,
      }
    : undefined;
};

const readBlockFor = (input: Readonly<Record<string, unknown>>) =>
  Option.match(Schema.decodeOption(PathInput)(input), {
    // pi decodes its own tool input; a path this can't read is pi's to refuse.
    onNone: () => undefined,
    onSome: ({ path }) =>
      path !== undefined && isClosedEnvPath(path) ? CLOSED_READ : undefined,
  });

const vcsPolicy = (pi: PiApi) => {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash") {
      return Option.match(Schema.decodeUnknownOption(BashInput)(event.input), {
        onNone: () => UNREADABLE,
        onSome: ({ command }) => blockFor(command),
      });
    }

    return READERS.has(event.toolName) ? readBlockFor(event.input) : undefined;
  });
};

export default vcsPolicy;
