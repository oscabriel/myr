/**
 * The pi adapter: what `pi install npm:<package>` loads, at user level,
 * through the published package's `"pi"` key (`dist/pi.js`), never from a
 * project's `.pi/extensions/` (a stranger's repo runs no code in your
 * harness). It is thin: three pi events, each answered by the one hook
 * policy behind `<cli> hook` (`./hook/decide.ts`), through `PiDeps`.
 */
import type {
  AgentBeforeSettleEvent,
  AgentBeforeSettleEventResult,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  CustomMessageEntryDraft,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import {
  BunChildProcessSpawner,
  BunFileSystem,
  BunPath,
} from "@effect/platform-bun";
import { claudeEventOf } from "@repo/agent-kit/hook-events";
import type { HookEvent } from "@repo/agent-kit/hook-events";
import { Brand } from "@repo/brand";
import type { Client } from "@repo/protocol/contracts";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array,
  Cause,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import type { FileSystem, Path } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { CredentialsFile } from "./credentials.ts";
import { decideHook, MAX_HOLDS } from "./hook/decide.ts";
import type { HookFacts } from "./hook/decide.ts";
import { gatherFacts } from "./hook/facts.ts";
import type { HookInput } from "./hook/input.ts";
import { PushCheck, pushCheckWith } from "./hook/push-check.ts";
import { loadSession, saveSession } from "./hook/session.ts";
import type { SessionState } from "./hook/session.ts";
import { RemoteClient } from "./remote.ts";

/** The policy could not answer; the adapter allows, and says why. */
export class HookFailed extends Schema.TaggedError<HookFailed>()("HookFailed", {
  reason: Schema.String,
}) {
  override get message() {
    return `the hook policy gave no answer: ${this.reason}`;
  }
}

/** One pi session: its id, and the folder its agent runs in. */
export interface PiSession {
  readonly cwd: string;
  readonly id: string;
}

/** A tool call the policy judges before it runs, read from pi's own. */
export type GuardedCall =
  /** pi's `edit` or `write`: the file it is about to change, as the tool names it. */
  | { readonly _tag: "Write"; readonly file: string }
  /** pi's `bash`, running `git push`. */
  | { readonly _tag: "Push" };

export const GuardedCall = Data.taggedEnum<GuardedCall>();

/** Where the session's answer stands when its agent is about to stop. */
export type SettleVerdict =
  | { readonly _tag: "Landed" }
  | { readonly _tag: "Waiting" }
  | {
      readonly _tag: "Refused";
      readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
      /** Whether the agent can act on them now (the policy's call). */
      readonly actionable: boolean;
    };

export const SettleVerdict = Data.taggedEnum<SettleVerdict>();

/** The boundary to the hook policy: what the adapter asks it, per session. */
export interface PiDeps {
  /** The claim's brief for the session's repo; none without a claim. */
  readonly brief: (
    session: PiSession
  ) => Effect.Effect<Option.Option<string>, HookFailed>;
  /** What the gate would refuse of the call; none when it would pass. */
  readonly guardTool: (
    session: PiSession,
    call: GuardedCall
  ) => Effect.Effect<
    Option.Option<Array.NonEmptyReadonlyArray<Refusal>>,
    HookFailed
  >;
  readonly settle: (
    session: PiSession
  ) => Effect.Effect<SettleVerdict, HookFailed>;
}

/** What the adapter reads of a handler's context. */
export type PiContext = Pick<ExtensionContext, "cwd"> & {
  readonly sessionManager: Pick<
    ExtensionContext["sessionManager"],
    "getSessionId"
  >;
  readonly ui?: Pick<ExtensionUIContext, "notify">;
};

/** The adapter's handlers, by pi event, as pi 1.0.3 types each event. */
export interface PiHandlers {
  readonly agent_before_settle: (
    event: AgentBeforeSettleEvent,
    ctx: PiContext
  ) => Promise<AgentBeforeSettleEventResult | undefined>;
  readonly before_agent_start: (
    event: BeforeAgentStartEvent,
    ctx: PiContext
  ) => Promise<BeforeAgentStartEventResult | undefined>;
  readonly tool_call: (
    event: ToolCallEvent,
    ctx: PiContext
  ) => Promise<ToolCallEventResult | undefined>;
}

/** The part of pi's `ExtensionAPI` the adapter uses: `on`, for three events. */
export interface PiEvents {
  readonly on: {
    (
      event: "agent_before_settle",
      handler: PiHandlers["agent_before_settle"]
    ): () => void;
    (
      event: "before_agent_start",
      handler: PiHandlers["before_agent_start"]
    ): () => void;
    (event: "tool_call", handler: PiHandlers["tool_call"]): () => void;
  };
}

export interface PiOptions {
  /**
   * The most times one session is sent back to work: the hook policy's
   * `MAX_HOLDS` (3) unless given. pi has no cap of its own.
   */
  readonly maxContinuations?: number;
}

/** The custom type of the brief pi shows before the agent starts. */
const BRIEF = `${Brand.slug}-brief`;

/** The custom type of the verdict a settle sends the agent back with. */
const VERDICT = `${Brand.slug}-verdict`;

/** What the agent reads when it is sent back: why, then the gateway's own text. */
const verdictEntry = (
  refusals: Array.NonEmptyReadonlyArray<Refusal>
): CustomMessageEntryDraft => ({
  content: [
    `The gate refuses this answer as it stands, so you are not done. Fix what follows, then run \`${Brand.cli} check\` before you push again:`,
    ...explain(refusals),
  ].join("\n"),
  customType: VERDICT,
  display: true,
  type: "custom_message",
});

/** pi's `edit` and `write` name the file they change as `path`. */
const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({ path: Schema.String })
);

/** pi's `bash` runs `command`. */
const decodeCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.String })
);

/**
 * git running `push`, wherever it starts in the command line and after any
 * of git's own options: `git push`, `cd a && git push`, `git -C dir push`.
 * A false match only runs the preflight, which blocks nothing a real push
 * would not be refused.
 */
const GIT_PUSH =
  /(?:^|[\s;&|(`])git(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+push(?![\w-])/u;

/**
 * The call the policy judges, read from pi's tool call at the boundary:
 * `edit` and `write` change a file, and `bash` may push. Every other call
 * runs unjudged. The adapter never changes a call, only blocks one.
 */
const guardedCall = (event: ToolCallEvent): Option.Option<GuardedCall> =>
  Match.value(event.toolName).pipe(
    Match.when(Match.is("edit", "write"), () =>
      Option.map(decodeFile(event.input), ({ path }) =>
        GuardedCall.Write({ file: path })
      )
    ),
    Match.when("bash", () =>
      Option.flatMap(decodeCommand(event.input), ({ command }) =>
        GIT_PUSH.test(command) ? Option.some(GuardedCall.Push()) : Option.none()
      )
    ),
    Match.orElse(() => Option.none())
  );

/**
 * The refusals retrying cannot help: the ones the agent must fix. A
 * retryable refusal is a wait (the repo was busy), as the stop hook reads it.
 */
const fixable = (refusals: readonly Refusal[]) =>
  refusals.filter((refusal) => !refusal.retryable);

/**
 * pi's block for what the gate would refuse that retrying cannot help, with
 * the gateway's own text; a retryable refusal is a wait, never a block.
 */
const blockFor = (
  refusals: Option.Option<Array.NonEmptyReadonlyArray<Refusal>>
): Option.Option<ToolCallEventResult> => {
  const final = fixable(Option.getOrElse(refusals, () => []));

  return Array.isReadonlyArrayNonEmpty(final)
    ? Option.some({ block: true, reason: explain(final).join("\n") })
    : Option.none();
};

/**
 * What a verdict tells the agent to act on: the refusals it can fix, as the
 * stop hook's hold names them, or every refusal when the policy holds on
 * retryable ones alone.
 */
const toActOn = (refusals: Array.NonEmptyReadonlyArray<Refusal>) =>
  Array.match(fixable(refusals), {
    onEmpty: () => refusals,
    onNonEmpty: (final) => final,
  });

/** The session a handler runs in. */
const sessionOf = (ctx: PiContext): PiSession => ({
  cwd: ctx.cwd,
  id: ctx.sessionManager.getSessionId(),
});

/** A failure's first line, for the note. */
const firstLine = (cause: Cause.Cause<unknown>) =>
  String(Cause.squash(cause)).split("\n")[0] ?? "unknown failure";

/**
 * Runs one handler's reply for pi, which awaits a promise. The gate stays
 * the authority, so a policy that fails, or any defect, lets pi go on as it
 * would without the adapter (a `tool_call` handler that rejects would block
 * the tool), and says why through `ctx.ui.notify` when pi gives one.
 */
const reply = <A>(
  ctx: PiContext,
  event: keyof PiHandlers,
  decided: Effect.Effect<Option.Option<A>, HookFailed>
): Promise<A | undefined> =>
  Effect.runPromise(
    decided.pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          Effect.sync(() =>
            ctx.ui?.notify(
              `${Brand.cli} ${event}: ${firstLine(cause)}; allowing, and the gateway still judges every push`,
              "warning"
            )
          ),
          Option.none<A>()
        )
      ),
      Effect.map(Option.getOrUndefined)
    )
  );

/**
 * The adapter over `deps`: registers its three handlers on `pi`, and no
 * other event or tool. Each pi load counts its own continuations, by
 * session, so no state outlives the extension.
 */
export const piAdapter =
  (deps: PiDeps, options: PiOptions = {}) =>
  (pi: PiEvents): void => {
    const most = options.maxContinuations ?? MAX_HOLDS;
    const continued = new Map<string, number>();
    const briefed = new Set<string>();

    // pi starts the agent on every prompt; the brief stays in the session,
    // so each session gets it once, at its first prompt with a claim.
    pi.on("before_agent_start", (_event, ctx) => {
      const session = sessionOf(ctx);

      return reply(
        ctx,
        "before_agent_start",
        briefed.has(session.id)
          ? Effect.succeedNone
          : deps.brief(session).pipe(
              Effect.tap((brief) =>
                Effect.sync(() => {
                  if (Option.isSome(brief)) {
                    briefed.add(session.id);
                  }
                })
              ),
              Effect.map(
                Option.map((content): BeforeAgentStartEventResult => ({
                  message: { content, customType: BRIEF, display: true },
                }))
              )
            )
      );
    });

    pi.on("tool_call", (event, ctx) =>
      reply(
        ctx,
        "tool_call",
        Option.match(guardedCall(event), {
          onNone: () => Effect.succeedNone,
          onSome: (call) =>
            Effect.map(deps.guardTool(sessionOf(ctx), call), blockFor),
        })
      )
    );

    // Only a verdict the agent can act on sends it back, at most `most`
    // times a session, and only a run that completed: a run the person
    // stopped, or one that failed, stays stopped. Otherwise the policy is
    // not even asked. `event.context.canContinue` is no guide: pi computes
    // it before this handler's entry, and a run that ends on the agent's own
    // reply reads false until the verdict is appended.
    pi.on("agent_before_settle", (event, ctx) => {
      const session = sessionOf(ctx);
      const used = continued.get(session.id) ?? 0;

      return reply(
        ctx,
        "agent_before_settle",
        event.outcome !== "completed" || used >= most
          ? Effect.succeedNone
          : Effect.flatMap(deps.settle(session), (verdict) =>
              SettleVerdict.$is("Refused")(verdict) && verdict.actionable
                ? Effect.sync(() => {
                    continued.set(session.id, used + 1);

                    return Option.some<AgentBeforeSettleEventResult>({
                      continue: true,
                      entries: [
                        ...event.entries,
                        verdictEntry(toActOn(verdict.refusals)),
                      ],
                    });
                  })
                : Effect.succeedNone
            )
      );
    });
  };

// ------------------------------------------------------------ live

/**
 * The session's facts, kept in the hook's own session file under pi's
 * session id: gathered once, and again by the brief and the settle
 * (`look`) while they hold no claim, so a claim taken mid-session is found
 * at the next prompt or stop, and a tool call never waits on the platform.
 * As `<cli> hook` keeps them (its `sessionFacts`).
 */
const factsOf = (session: PiSession, look: boolean) =>
  Effect.gen(function* () {
    const kept = yield* loadSession(session.id);

    if (Option.isSome(kept) && (kept.value.claim !== undefined || !look)) {
      return kept.value;
    }

    const gathered = yield* gatherFacts(session.cwd);

    // A cache: facts that cannot be kept are gathered again next time.
    yield* Effect.ignore(saveSession(session.id, gathered));

    return gathered;
  });

/**
 * What the policy decides over. Holds are 0: the adapter counts pi's
 * continuations itself, so the policy only says whether a stop would hold.
 */
const hookFacts = (
  state: SessionState,
  refusals: readonly Refusal[]
): HookFacts => ({
  claim: Option.fromUndefinedOr(state.claim),
  holds: 0,
  judge: state.judge,
  refusals,
  root: state.root,
});

/** The policy's input for `event`, in the hook format it reads. */
const hookInput = (event: HookEvent, session: PiSession): HookInput => ({
  cwd: session.cwd,
  hook_event_name: claudeEventOf[event],
  session_id: session.id,
});

/**
 * What `<cli> check --shape-only` refuses of the work as it stands, by the
 * policy's own `PushCheck`; nothing is asked without a claim.
 */
const localCheck = (state: SessionState) =>
  state.claim === undefined
    ? Effect.succeed<readonly Refusal[]>([])
    : Effect.flatMap(Effect.service(PushCheck), (check) =>
        check.run(state.root)
      );

/** What the hook policy runs on. */
export type PolicyServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | Client
  | FileSystem.FileSystem
  | Path.Path
  | PushCheck;

/** The hook policy, in process, as `PiDeps`, over `services`. */
export const policyDeps = (services: Layer.Layer<PolicyServices>): PiDeps => ({
  brief: (session) =>
    Effect.gen(function* () {
      const state = yield* factsOf(session, true);

      const { output } = decideHook(
        "session-start",
        hookInput("session-start", session),
        hookFacts(state, [])
      );

      return "hookSpecificOutput" in output &&
        "additionalContext" in output.hookSpecificOutput
        ? Option.some(output.hookSpecificOutput.additionalContext)
        : Option.none();
    }).pipe(Effect.provide(services)),

  guardTool: (session, call) =>
    GuardedCall.$match(call, {
      Push: () =>
        Effect.gen(function* () {
          const refusals = yield* localCheck(yield* factsOf(session, false));

          return Array.isReadonlyArrayNonEmpty(refusals)
            ? Option.some(refusals)
            : Option.none();
        }).pipe(
          Effect.mapError(
            (failed) => new HookFailed({ reason: failed.message })
          ),
          Effect.provide(services)
        ),
      // The policy decides an edit (`decideHook`'s pre-tool-use) but hands
      // back only its text, not the refusals; until it hands them back, a
      // pi edit is left to the gateway.
      Write: () => Effect.succeedNone,
    }),

  settle: (session) =>
    Effect.gen(function* () {
      const state = yield* factsOf(session, true);
      const refusals = yield* localCheck(state);

      if (!Array.isReadonlyArrayNonEmpty(refusals)) {
        return SettleVerdict.Waiting();
      }

      const { output } = decideHook(
        "stop",
        hookInput("stop", session),
        hookFacts(state, refusals)
      );

      // The policy holds a stop on a refusal the agent can fix.
      return SettleVerdict.Refused({
        actionable: "decision" in output,
        refusals,
      });
    }).pipe(
      Effect.mapError((failed) => new HookFailed({ reason: failed.message })),
      Effect.provide(services)
    ),
});

/**
 * The policy's services in pi's process: the stored credentials and the
 * platform over HTTP, and the local check run as the CLI on `PATH` (the
 * same package's bin, where git finds its credential helper too). Node's
 * own file system, paths and processes, which Bun's layers are.
 */
const LiveServices = Layer.mergeAll(
  RemoteClient.pipe(Layer.provide(CredentialsFile)),
  pushCheckWith([Brand.cli])
).pipe(
  Layer.provideMerge(BunChildProcessSpawner.layer),
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
);

/** The hook policy as pi's process runs it. */
export const livePiDeps = policyDeps(LiveServices);

/** What `pi install npm:<package>` loads: the adapter over the live policy. */
export default piAdapter(livePiDeps) satisfies ExtensionFactory;
