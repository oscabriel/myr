// Ported from joelhooks/rat-stack@fba26d8 `.pi/extensions/git-interceptor/index.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
/**
 * pi's side of the hook policy: before pi's bash tool runs a command, ask
 * `decide`, and block a refused command with its reason. The types below are
 * the slice of pi's extension API this file uses, checked against pi 1.0.4's
 * `dist/core/extensions/types.d.ts`; pi itself is not a dependency here.
 */
import { Option, Schema } from "effect";

import { Decision, decide } from "../../../scripts/hooks/lib/policy.ts";

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

const vcsPolicy = (pi: PiApi) => {
  pi.on("tool_call", (event) =>
    event.toolName === "bash"
      ? Option.match(Schema.decodeUnknownOption(BashInput)(event.input), {
          onNone: () => UNREADABLE,
          onSome: ({ command }) => blockFor(command),
        })
      : undefined
  );
};

export default vcsPolicy;
