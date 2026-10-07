// Ported from joelhooks/rat-stack@fba26d8 `scripts/hooks/block-git-no-verify.mjs`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
/**
 * vcs-policy: the hook Claude Code (PreToolUse on Bash, `.claude/settings.json`)
 * and Cursor (beforeShellExecution, `.cursor/hooks.json`) run before every shell
 * command. It reads the harness's JSON on stdin, asks `decide`, and answers in
 * that harness's shape:
 *
 * - Claude Code, or a bare `{"command": …}`: a refusal exits 2 with its reason
 *   on stderr; an allowed command exits 0 and prints nothing.
 * - Cursor: prints `{"permission": "allow" | "deny", …}` and exits 0.
 *
 * Input it cannot read, or any failure of its own, is a refusal: it fails
 * closed, so a broken hook never lets a command through.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Data,
  Effect,
  Match,
  Option,
  Runtime,
  Schema,
  Stdio,
  Stream,
} from "effect";

import { Decision, decide } from "./lib/policy.ts";

/** Tags each payload with its harness, which its JSON doesn't carry. */
const harness = <const Name extends string>(name: Name) =>
  Schema.tag(name).pipe(Schema.withDecodingDefaultKey(Effect.succeed(name)));

/** Claude Code's PreToolUse payload for the Bash tool. */
const ClaudePreToolUse = Schema.Struct({
  _tag: harness("Claude"),
  tool_input: Schema.Struct({ command: Schema.String }),
});

/** Cursor's beforeShellExecution payload. */
const CursorShell = Schema.Struct({
  _tag: harness("Cursor"),
  command: Schema.String,
  hook_event_name: Schema.Literal("beforeShellExecution"),
});

/** Any other caller: `{"command": "…"}`. */
const Bare = Schema.Struct({ _tag: harness("Bare"), command: Schema.String });

const HookInput = Schema.fromJsonString(
  Schema.Union([ClaudePreToolUse, CursorShell, Bare])
);

type HookInput = typeof HookInput.Type;

const CANNOT_READ =
  'vcs-policy could not read a shell command from the hook\'s input, so it refuses it. It reads Claude Code\'s PreToolUse JSON, Cursor\'s beforeShellExecution JSON or {"command": "…"}.';

/** A refusal this hook has already printed; it only sets the exit code. */
class Refused extends Data.TaggedError("Refused")<{
  readonly reason: string;
}> {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;
}

/** Who answers, and the refusal, if any, in words for the agent. */
interface Verdict {
  readonly harness: HookInput["_tag"];
  readonly refusal: Option.Option<string>;
}

const commandOf = (input: HookInput) =>
  Match.valueTags(input, {
    Bare: ({ command }) => command,
    Claude: ({ tool_input }) => tool_input.command,
    Cursor: ({ command }) => command,
  });

const explain = (decision: Decision): Option.Option<string> =>
  Decision.$match(decision, {
    Allow: () => Option.none(),
    Deny: ({ reason, rule }) =>
      Option.some(`vcs-policy refused this command (${rule}): ${reason}`),
  });

const UNREADABLE: Verdict = {
  harness: "Bare",
  refusal: Option.some(CANNOT_READ),
};

const judged: Effect.Effect<Verdict, never, Stdio.Stdio> = Effect.gen(
  function* () {
    const stdio = yield* Stdio.Stdio;
    const raw = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
    const input = yield* Schema.decodeEffect(HookInput)(raw);

    return {
      harness: input._tag,
      refusal: explain(decide(commandOf(input))),
    };
  }
).pipe(
  // Unreadable stdin, a payload of no known shape, or a defect: refuse.
  Effect.catchCause(() => Effect.succeed(UNREADABLE))
);

/** Cursor reads its answer, allow or deny, from stdout. */
const answerCursor = (refusal: Option.Option<string>) => {
  const reply = Option.match(refusal, {
    onNone: () => ({ permission: "allow" }),
    onSome: (message) => ({
      agent_message: message,
      permission: "deny",
      user_message: message,
    }),
  });

  return Effect.flatMap(Stdio.Stdio, (stdio) =>
    Stream.run(Stream.make(`${JSON.stringify(reply)}\n`), stdio.stdout())
  );
};

/** Claude Code and a bare caller read a refusal from exit 2 and stderr. */
const answerByExit = (refusal: Option.Option<string>) =>
  Option.match(refusal, {
    onNone: () => Effect.void,
    onSome: (message) =>
      Effect.flatMap(Stdio.Stdio, (stdio) =>
        Stream.run(Stream.make(`${message}\n`), stdio.stderr())
      ).pipe(Effect.andThen(Effect.fail(new Refused({ reason: message })))),
  });

const main = Effect.flatMap(judged, ({ harness: answerer, refusal }) =>
  answerer === "Cursor" ? answerCursor(refusal) : answerByExit(refusal)
);

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
