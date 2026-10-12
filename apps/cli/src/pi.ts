// Loaded at user level through the package's "pi" key, never from a project's `.pi/extensions/`: a stranger's repo runs no code in your harness.
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
import { decideHook, MAX_HOLDS, toolRefusals } from "./hook/decide.ts";
import type { HookFacts } from "./hook/decide.ts";
import { gatherFacts } from "./hook/facts.ts";
import type { HookInput } from "./hook/input.ts";
import { PushCheck, pushCheckWith } from "./hook/push-check.ts";
import { loadSession, saveSession } from "./hook/session.ts";
import type { SessionState } from "./hook/session.ts";
import { RemoteClient } from "./remote.ts";

export class HookFailed extends Schema.TaggedError<HookFailed>()("HookFailed", {
  reason: Schema.String,
}) {
  override get message() {
    return `the hook policy gave no answer: ${this.reason}`;
  }
}

export interface PiSession {
  readonly cwd: string;
  readonly id: string;
}

export type GuardedCall =
  | { readonly _tag: "Write"; readonly file: string }
  | { readonly _tag: "Push" };

export const GuardedCall = Data.taggedEnum<GuardedCall>();

export type SettleVerdict =
  | { readonly _tag: "Landed" }
  | { readonly _tag: "Waiting" }
  | {
      readonly _tag: "Refused";
      readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
      readonly actionable: boolean;
    };

export const SettleVerdict = Data.taggedEnum<SettleVerdict>();

export interface PiDeps {
  readonly brief: (
    session: PiSession
  ) => Effect.Effect<Option.Option<string>, HookFailed>;
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

export type PiContext = Pick<ExtensionContext, "cwd"> & {
  readonly sessionManager: Pick<
    ExtensionContext["sessionManager"],
    "getSessionId"
  >;
  readonly ui?: Pick<ExtensionUIContext, "notify">;
};

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
  readonly maxContinuations?: number;
}

const BRIEF = `${Brand.slug}-brief`;

const VERDICT = `${Brand.slug}-verdict`;

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

const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({ path: Schema.String })
);

const decodeCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.String })
);

/** Matches a push after any git options; a false match only runs the preflight. */
const GIT_PUSH =
  /(?:^|[\s;&|(`])git(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+push(?![\w-])/u;

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

const fixable = (refusals: readonly Refusal[]) =>
  refusals.filter((refusal) => !refusal.retryable);

const blockFor = (
  refusals: Option.Option<Array.NonEmptyReadonlyArray<Refusal>>
): Option.Option<ToolCallEventResult> => {
  const final = fixable(Option.getOrElse(refusals, () => []));

  return Array.isReadonlyArrayNonEmpty(final)
    ? Option.some({ block: true, reason: explain(final).join("\n") })
    : Option.none();
};

const toActOn = (refusals: Array.NonEmptyReadonlyArray<Refusal>) =>
  Array.match(fixable(refusals), {
    onEmpty: () => refusals,
    onNonEmpty: (final) => final,
  });

const sessionOf = (ctx: PiContext): PiSession => ({
  cwd: ctx.cwd,
  id: ctx.sessionManager.getSessionId(),
});

const firstLine = (cause: Cause.Cause<unknown>) =>
  String(Cause.squash(cause)).split("\n")[0] ?? "unknown failure";

/** A rejecting `tool_call` handler would block the tool, so a failing policy or defect lets pi go on. */
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

export const piAdapter =
  (deps: PiDeps, options: PiOptions = {}) =>
  (pi: PiEvents): void => {
    const most = options.maxContinuations ?? MAX_HOLDS;
    const continued = new Map<string, number>();
    const briefed = new Set<string>();

    // pi starts the agent on every prompt; each session gets the brief once.
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

    // Only a completed run with an actionable verdict is sent back, at most `most` times.
    // `event.context.canContinue` is no guide: pi computes it before this handler's entry.
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

/** Holds are 0: the adapter counts pi's continuations itself. */
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

const hookInput = (event: HookEvent, session: PiSession): HookInput => ({
  cwd: session.cwd,
  hook_event_name: claudeEventOf[event],
  session_id: session.id,
});

const localCheck = ({ claim, root }: SessionState) =>
  claim === undefined
    ? Effect.succeed<readonly Refusal[]>([])
    : Effect.flatMap(Effect.service(PushCheck), (check) =>
        check.run(root, claim.base)
      );

export type PolicyServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | Client
  | FileSystem.FileSystem
  | Path.Path
  | PushCheck;

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
      Write: ({ file }) =>
        Effect.map(factsOf(session, false), (state) =>
          Array.match(
            toolRefusals(
              {
                ...hookInput("pre-tool-use", session),
                tool_input: { file_path: file },
                tool_name: "Write",
              },
              hookFacts(state, [])
            ),
            {
              onEmpty: () => Option.none(),
              onNonEmpty: (refusals) => Option.some(refusals),
            }
          )
        ).pipe(Effect.provide(services)),
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

      return SettleVerdict.Refused({
        actionable: "decision" in output,
        refusals,
      });
    }).pipe(
      Effect.mapError((failed) => new HookFailed({ reason: failed.message })),
      Effect.provide(services)
    ),
});

const LiveServices = Layer.mergeAll(
  RemoteClient.pipe(Layer.provide(CredentialsFile)),
  pushCheckWith([Brand.cli])
).pipe(
  Layer.provideMerge(BunChildProcessSpawner.layer),
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
);

export const livePiDeps = policyDeps(LiveServices);

export default piAdapter(livePiDeps) satisfies ExtensionFactory;
