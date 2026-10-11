/**
 * The pi adapter on a fake pi: a registry that records each `pi.on` handler,
 * and events shaped as pi 1.0.3 types them, fired at those handlers. The
 * policy behind `PiDeps` is a fake for the adapter's own tests; the last
 * group runs the live deps over the hook policy's modules, with a stand-in
 * local check (`hook.test.ts` tests the policy itself).
 */
import type {
  AgentBeforeSettleEvent,
  BeforeAgentStartEvent,
  SessionBoundaryDraft,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { Glob } from "@repo/protocol/domain/common";
import { AskId, CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import {
  ChecksFailed,
  OutOfScope,
  RepoBusy,
  TouchedJudge,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
} from "effect";

import { PushCheck, PushCheckFailed } from "../src/hook/push-check.ts";
import { saveSession } from "../src/hook/session.ts";
import type { SessionState } from "../src/hook/session.ts";
import extension, {
  GuardedCall,
  HookFailed,
  piAdapter,
  policyDeps,
  SettleVerdict,
} from "../src/pi.ts";
import type { PiContext, PiDeps, PiEvents, PiHandlers } from "../src/pi.ts";

const cwd = "/work/datekit";

/** The brief the fake policy gives a session that holds a claim. */
const briefText = "# Your claim: fix-week in datekit";

/** The config folder's project file: in every judge closure. */
const projectFile = RepoPath.make(`${Brand.configDir}/project.ts`);

/** A change outside the claim's territory. */
const outside = new OutOfScope({ paths: [RepoPath.make("README.md")] });

/** What the fake policy answers. */
interface Policy {
  readonly brief?: Option.Option<string>;
  readonly guard?: (
    call: GuardedCall
  ) => Option.Option<Array.NonEmptyReadonlyArray<Refusal>>;
  readonly settle?: () => SettleVerdict;
}

/** The fake policy, and what the adapter asked it. */
const fakeDeps = (policy: Policy) => {
  const asked: string[] = [];

  const deps: PiDeps = {
    brief: (session) =>
      Effect.sync(() => {
        asked.push(`brief ${session.id} ${session.cwd}`);

        return policy.brief ?? Option.none();
      }),
    guardTool: (session, call) =>
      Effect.sync(() => {
        asked.push(`guardTool ${session.id} ${call._tag}`);

        return policy.guard?.(call) ?? Option.none();
      }),
    settle: (session) =>
      Effect.sync(() => {
        asked.push(`settle ${session.id}`);

        return policy.settle?.() ?? SettleVerdict.Waiting();
      }),
  };

  return { asked, deps };
};

/** A policy whose every call fails as `failure` does. */
const broken = (failure: Effect.Effect<never, HookFailed>): PiDeps => ({
  brief: () => failure,
  guardTool: () => failure,
  settle: () => failure,
});

/** The fake policy's judge: the config folder's project file is in its closure. */
const judging = (call: GuardedCall) =>
  GuardedCall.$is("Write")(call) && call.file === projectFile
    ? Option.some(Array.of(new TouchedJudge({ paths: [projectFile] })))
    : Option.none();

/** A fake preflight: what `<cli> check` refuses of the work as it stands. */
const preflight =
  (...refusals: readonly Refusal[]) =>
  (call: GuardedCall) =>
    GuardedCall.$is("Push")(call) && Array.isReadonlyArrayNonEmpty(refusals)
      ? Option.some(refusals)
      : Option.none();

/** A fake pi: it records each handler the adapter registers, by event. */
const fakePi = () => {
  const handlers: { -readonly [K in keyof PiHandlers]?: PiHandlers[K] } = {};
  const events: string[] = [];

  const pi: PiEvents = {
    on: <K extends keyof PiHandlers>(event: K, handler: PiHandlers[K]) => {
      events.push(event);
      handlers[event] = handler;

      return () => {};
    },
  };

  return { events, handlers, pi };
};

/** A handler's context in session `id`, with the notes `ui.notify` got. */
const contextOf = (id: string, withUi = true) => {
  const notes: string[] = [];
  const bare: PiContext = { cwd, sessionManager: { getSessionId: () => id } };

  const ui = {
    notify: (note: string) => {
      notes.push(note);
    },
  };

  return { ctx: withUi ? { ...bare, ui } : bare, notes };
};

/** pi set up with `policy` behind the adapter. */
const loaded = (policy: Policy) => {
  const { asked, deps } = fakeDeps(policy);
  const { events, handlers, pi } = fakePi();

  piAdapter(deps)(pi);

  return { asked, events, handlers };
};

/** Fires one recorded handler at `event`, as pi does, and awaits it. */
const fire = <E, R>(
  handler: ((event: E, ctx: PiContext) => Promise<R>) | undefined,
  event: E,
  ctx: PiContext
) =>
  handler === undefined
    ? Effect.sync(() =>
        expect.unreachable("the adapter registered no handler for this event")
      )
    : Effect.promise(() => handler(event, ctx));

const startEvent: BeforeAgentStartEvent = {
  prompt: "Answer the ask you claimed.",
  systemPrompt: "You are pi.",
  systemPromptOptions: {
    appendSystemPrompt: "",
    contextFiles: [],
    cwd,
    promptGuidelines: [],
    sections: {},
    selectedTools: ["read", "bash", "edit", "write"],
    skills: [],
    toolGuidelines: {},
    toolSnippets: {},
  },
  type: "before_agent_start",
};

const editOf = (path: string): ToolCallEvent => ({
  input: { edits: [{ newText: "export default {};", oldText: "" }], path },
  toolCallId: "call-1",
  toolName: "edit",
  type: "tool_call",
});

const bashOf = (command: string): ToolCallEvent => ({
  input: { command },
  toolCallId: "call-2",
  toolName: "bash",
  type: "tool_call",
});

/**
 * A completed run's settle with `entries` already proposed by earlier
 * handlers, as pi 1.0.3 hands it over: the run ended on the agent's own
 * reply, so the preview says it cannot go on (`canContinue` is false while
 * the last message is the assistant's, `_buildBoundaryContext` in
 * `dist/core/agent-session.js`) until a handler appends a message.
 */
const settleOf = (entries: SessionBoundaryDraft[]): AgentBeforeSettleEvent => ({
  context: {
    canContinue: false,
    contextEntries: [],
    contextMessages: [],
    llmMessages: [],
    pendingMessages: [],
  },
  continue: false,
  entries,
  outcome: "completed",
  type: "agent_before_settle",
});

const failing = new ChecksFailed({
  lane: "test",
  logRef: "logs/test",
  next: `${Brand.cli} check`,
});

const refused = (actionable: boolean) => () =>
  SettleVerdict.Refused({ actionable, refusals: [failing] });

const unreachable = Effect.fail(
  new HookFailed({ reason: "the platform did not answer within 10s" })
);

describe("the pi adapter", () => {
  describe("before_agent_start", () => {
    it.effect("gives the agent the policy's brief when a claim exists", () =>
      Effect.gen(function* () {
        const { handlers } = loaded({ brief: Option.some(briefText) });
        const { ctx } = contextOf("s1");

        const result = yield* fire(
          handlers.before_agent_start,
          startEvent,
          ctx
        );

        expect(result).toStrictEqual({
          message: {
            content: briefText,
            customType: `${Brand.slug}-brief`,
            display: true,
          },
        });
      })
    );

    it.effect("gives nothing without a claim", () =>
      Effect.gen(function* () {
        const { asked, handlers } = loaded({ brief: Option.none() });
        const { ctx } = contextOf("s1");

        const result = yield* fire(
          handlers.before_agent_start,
          startEvent,
          ctx
        );

        expect(result).toBeUndefined();
        expect(asked).toStrictEqual([`brief s1 ${cwd}`]);
      })
    );

    it.effect(
      "briefs a session once, at its first prompt that has a claim",
      () =>
        Effect.gen(function* () {
          const briefs = [Option.none(), Option.some(briefText)];
          const { deps } = fakeDeps({});
          const { handlers, pi } = fakePi();
          const one = contextOf("s1").ctx;
          const other = contextOf("s2").ctx;
          const given: string[] = [];

          // No claim at the first prompt; one is taken before the second.
          piAdapter({
            ...deps,
            brief: () =>
              Effect.succeed(briefs.shift() ?? Option.some(briefText)),
          })(pi);

          for (const ctx of [one, one, one, other]) {
            const result = yield* fire(
              handlers.before_agent_start,
              startEvent,
              ctx
            );

            given.push(result === undefined ? "nothing" : "the brief");
          }

          expect(given).toStrictEqual([
            "nothing",
            "the brief",
            "nothing",
            "the brief",
          ]);
        })
    );
  });

  describe("tool_call", () => {
    it.effect(
      "blocks an edit to the judge closure with the refusal's rendered text",
      () =>
        Effect.gen(function* () {
          const { handlers } = loaded({ guard: judging });
          const { ctx } = contextOf("s1");

          const result = yield* fire(
            handlers.tool_call,
            editOf(projectFile),
            ctx
          );

          expect(result).toStrictEqual({
            block: true,
            reason: explain([new TouchedJudge({ paths: [projectFile] })]).join(
              "\n"
            ),
          });

          expect(result?.reason?.split("\n")[0]).toMatch(/^TouchedJudge: /u);
        })
    );

    it.effect("lets a write the policy passes run", () =>
      Effect.gen(function* () {
        const { asked, handlers } = loaded({ guard: judging });
        const { ctx } = contextOf("s1");

        const result = yield* fire(
          handlers.tool_call,
          {
            input: { content: "export const week = 1;", path: "src/week.ts" },
            toolCallId: "call-3",
            toolName: "write",
            type: "tool_call",
          },
          ctx
        );

        expect(result).toBeUndefined();
        expect(asked).toStrictEqual(["guardTool s1 Write"]);
      })
    );

    it.effect("never asks the policy about a tool that changes nothing", () =>
      Effect.gen(function* () {
        const { asked, handlers } = loaded({ guard: judging });
        const { ctx } = contextOf("s1");

        const result = yield* fire(
          handlers.tool_call,
          {
            input: { path: projectFile },
            toolCallId: "call-4",
            toolName: "read",
            type: "tool_call",
          },
          ctx
        );

        expect(result).toBeUndefined();
        expect(asked).toStrictEqual([]);
      })
    );

    it.effect(
      "blocks a git push whose preflight has a refusal retrying cannot help",
      () =>
        Effect.gen(function* () {
          const { handlers } = loaded({
            guard: preflight(new RepoBusy(), outside),
          });

          const { ctx } = contextOf("s1");

          const result = yield* fire(
            handlers.tool_call,
            bashOf("git push origin HEAD"),
            ctx
          );

          expect(result).toStrictEqual({
            block: true,
            reason: explain([outside]).join("\n"),
          });
        })
    );

    it.effect(
      "lets a git push run when its preflight is clean or only retryable",
      () =>
        Effect.gen(function* () {
          for (const refusals of [[], [new RepoBusy()]]) {
            const { asked, handlers } = loaded({
              guard: preflight(...refusals),
            });

            const { ctx } = contextOf("s1");

            const result = yield* fire(
              handlers.tool_call,
              bashOf("git push"),
              ctx
            );

            expect(result).toBeUndefined();
            expect(asked).toStrictEqual(["guardTool s1 Push"]);
          }
        })
    );

    it.effect("reads a push however the command spells it", () =>
      Effect.gen(function* () {
        const pushes = [
          "git push",
          "git push -u origin HEAD",
          "cd packages/a && git push",
          `git -C ${cwd} push origin`,
          "git --no-pager push;",
          "bun test && git commit -am wip && git push",
        ];

        const others = [
          "git status",
          "git log --grep push",
          "echo pushed",
          "bun run push",
          "git pushd",
        ];

        for (const command of [...pushes, ...others]) {
          const { handlers } = loaded({ guard: preflight(outside) });
          const { ctx } = contextOf("s1");
          const result = yield* fire(handlers.tool_call, bashOf(command), ctx);

          expect({ blocked: result?.block === true, command }).toStrictEqual({
            blocked: pushes.includes(command),
            command,
          });
        }
      })
    );
  });

  describe("agent_before_settle", () => {
    /** What another handler already appended at this boundary. */
    const earlier: SessionBoundaryDraft = {
      customType: "other-extension",
      type: "custom",
    };

    it.effect(
      "sends the agent back with the refusal while the verdict is one it can act on",
      () =>
        Effect.gen(function* () {
          const { handlers } = loaded({ settle: refused(true) });
          const { ctx } = contextOf("s1");

          const result = yield* fire(
            handlers.agent_before_settle,
            settleOf([earlier]),
            ctx
          );

          expect(result).toStrictEqual({
            continue: true,
            entries: [
              earlier,
              {
                content: [
                  `The gate refuses this answer as it stands, so you are not done. Fix what follows, then run \`${Brand.cli} check\` before you push again:`,
                  ...explain([failing]),
                ].join("\n"),
                customType: `${Brand.slug}-verdict`,
                display: true,
                type: "custom_message",
              },
            ],
          });
        })
    );

    it.effect(
      "continues at most three times in one session, and lets the fourth settle stand",
      () =>
        Effect.gen(function* () {
          const { asked, handlers } = loaded({ settle: refused(true) });
          const one = contextOf("s1").ctx;
          const other = contextOf("s2").ctx;
          const continued: (boolean | undefined)[] = [];

          for (const ctx of [one, one, one, one, other]) {
            const result = yield* fire(
              handlers.agent_before_settle,
              settleOf([]),
              ctx
            );

            continued.push(result?.continue);
          }

          expect(continued).toStrictEqual([true, true, true, undefined, true]);

          // Past the cap, the policy is not even asked.
          expect(asked).toStrictEqual([
            "settle s1",
            "settle s1",
            "settle s1",
            "settle s2",
          ]);
        })
    );

    it.effect("takes its cap from the options", () =>
      Effect.gen(function* () {
        const { deps } = fakeDeps({ settle: refused(true) });
        const { handlers, pi } = fakePi();
        const { ctx } = contextOf("s1");

        piAdapter(deps, { maxContinuations: 1 })(pi);

        const first = yield* fire(
          handlers.agent_before_settle,
          settleOf([]),
          ctx
        );

        const second = yield* fire(
          handlers.agent_before_settle,
          settleOf([]),
          ctx
        );

        expect([first?.continue, second]).toStrictEqual([true, undefined]);
      })
    );

    it.effect(
      "sends back a completed run whose context ends on the agent's own reply",
      () =>
        Effect.gen(function* () {
          const { asked, handlers } = loaded({ settle: refused(true) });
          const { ctx } = contextOf("s1");
          const event = settleOf([]);

          const result = yield* fire(handlers.agent_before_settle, event, ctx);

          // The verdict the adapter appends is what lets the run go on.
          expect({
            asked,
            canContinue: event.context.canContinue,
            continued: result?.continue,
            entries: result?.entries?.length,
          }).toStrictEqual({
            asked: ["settle s1"],
            canContinue: false,
            continued: true,
            entries: 1,
          });
        })
    );

    it.effect(
      "lists only the refusals the agent can fix, as the stop hook does",
      () =>
        Effect.gen(function* () {
          const { handlers } = loaded({
            settle: () =>
              SettleVerdict.Refused({
                actionable: true,
                refusals: [new RepoBusy(), outside],
              }),
          });

          const { ctx } = contextOf("s1");

          const result = yield* fire(
            handlers.agent_before_settle,
            settleOf([]),
            ctx
          );

          expect(result?.entries).toStrictEqual([
            {
              content: [
                `The gate refuses this answer as it stands, so you are not done. Fix what follows, then run \`${Brand.cli} check\` before you push again:`,
                ...explain([outside]),
              ].join("\n"),
              customType: `${Brand.slug}-verdict`,
              display: true,
              type: "custom_message",
            },
          ]);
        })
    );

    it.effect("never sends back a run the person stopped or that failed", () =>
      Effect.gen(function* () {
        const ended: readonly AgentBeforeSettleEvent[] = [
          { ...settleOf([]), outcome: "aborted" },
          { ...settleOf([]), outcome: "error" },
        ];

        for (const event of ended) {
          const { asked, handlers } = loaded({ settle: refused(true) });
          const { ctx } = contextOf("s1");

          const result = yield* fire(handlers.agent_before_settle, event, ctx);

          expect({ asked, result }).toStrictEqual({
            asked: [],
            result: undefined,
          });
        }
      })
    );

    it.effect(
      "never continues on a landing, a wait, or a refusal the agent cannot act on",
      () =>
        Effect.gen(function* () {
          const verdicts = [
            SettleVerdict.Landed(),
            SettleVerdict.Waiting(),
            SettleVerdict.Refused({
              actionable: false,
              refusals: [new RepoBusy()],
            }),
          ];

          for (const verdict of verdicts) {
            const { handlers } = loaded({ settle: () => verdict });
            const { ctx } = contextOf("s1");

            const result = yield* fire(
              handlers.agent_before_settle,
              settleOf([]),
              ctx
            );

            expect({ result, verdict: verdict._tag }).toStrictEqual({
              result: undefined,
              verdict: verdict._tag,
            });
          }
        })
    );
  });

  describe("when the policy fails", () => {
    it.effect(
      "allows the tool, and says why through ctx.ui.notify when pi gives one",
      () =>
        Effect.gen(function* () {
          const failures = [unreachable, Effect.die("a bug in the policy")];

          for (const failure of failures) {
            const { handlers, pi } = fakePi();
            const { ctx, notes } = contextOf("s1");

            piAdapter(broken(failure))(pi);

            const result = yield* fire(
              handlers.tool_call,
              editOf(projectFile),
              ctx
            );

            expect(result).toBeUndefined();
            expect(notes).toHaveLength(1);
          }
        })
    );

    it.effect("names the failure in its note", () =>
      Effect.gen(function* () {
        const { handlers, pi } = fakePi();
        const { ctx, notes } = contextOf("s1");

        piAdapter(broken(unreachable))(pi);

        yield* fire(handlers.tool_call, bashOf("git push"), ctx);

        expect(notes).toHaveLength(1);
        expect(notes[0]).toContain("the platform did not answer within 10s");
      })
    );

    it.effect("gives no brief and no continuation, with or without a ui", () =>
      Effect.gen(function* () {
        for (const withUi of [true, false]) {
          const { handlers, pi } = fakePi();
          const { ctx, notes } = contextOf("s1", withUi);

          piAdapter(broken(unreachable))(pi);

          const brief = yield* fire(
            handlers.before_agent_start,
            startEvent,
            ctx
          );

          const settled = yield* fire(
            handlers.agent_before_settle,
            settleOf([]),
            ctx
          );

          expect({ brief, notes: notes.length, settled }).toStrictEqual({
            brief: undefined,
            notes: withUi ? 2 : 0,
            settled: undefined,
          });
        }
      })
    );
  });

  it.effect(
    "registers only before_agent_start, tool_call and agent_before_settle",
    () =>
      Effect.sync(() => {
        const { events } = loaded({});

        expect(events.toSorted()).toStrictEqual([
          "agent_before_settle",
          "before_agent_start",
          "tool_call",
        ]);
      })
  );

  it.effect(
    "is what the package's pi entry exports, over the live policy",
    () =>
      Effect.sync(() => {
        const { events, pi } = fakePi();

        extension(pi);

        expect(events.toSorted()).toStrictEqual([
          "agent_before_settle",
          "before_agent_start",
          "tool_call",
        ]);
      })
  );
});

// ------------------------------------------------------------ live deps

const want = "An ISO week date parses to the Monday of that week.";

/** Kept facts for a session on `fix-week` in a clone at `root`. */
const claimedIn = (root: string): SessionState => ({
  claim: {
    ask: AskId.make("fix-week"),
    base: CommitSha.make("1".repeat(40)),
    checkCommand: "bun test packages/a",
    project: ProjectName.make("oscabriel/datekit"),
    territory: { module: "a", paths: [Glob.make("packages/a/**")] },
    want,
  },
  holds: 0,
  judge: { paths: [Glob.make(`/${Brand.configDir}/**`)], pointers: [] },
  root,
});

/**
 * The live deps with their state in a temp folder, a local check that
 * answers `checked`, and a platform that must not be called. Gives the
 * deps, a folder that is no repo, the roots the check ran in, and a way to
 * keep a session's facts.
 */
const policyWith = (
  checked: Effect.Effect<readonly Refusal[], PushCheckFailed>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const state = yield* fs.makeTempDirectoryScoped();
    const folder = yield* fs.makeTempDirectoryScoped();
    const roots: string[] = [];

    const env = ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { XDG_STATE_HOME: state } })
    );

    const deps = policyDeps(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(Client)({}),
        Layer.succeed(PushCheck)({
          run: (root) =>
            Effect.andThen(
              Effect.sync(() => roots.push(root)),
              checked
            ),
        }),
        env
      )
    );

    const keep = (id: string, facts: SessionState) =>
      saveSession(id, facts).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, env)),
        Effect.orDie
      );

    return { deps, folder, keep, roots };
  }).pipe(Effect.provide(NodeServices.layer));

const refusing = (...refusals: readonly Refusal[]) => Effect.succeed(refusals);

describe("the live deps, over the hook policy's own modules", () => {
  it.live("brief a session whose kept facts hold a claim", () =>
    Effect.gen(function* () {
      const { deps, folder, keep } = yield* policyWith(refusing());

      yield* keep("s1", claimedIn(folder));

      const brief = Option.getOrElse(
        yield* deps.brief({ cwd: folder, id: "s1" }),
        () => ""
      );

      expect(brief).toContain(want);
      expect(brief).toContain("bun test packages/a");
    })
  );

  it.live("give no brief, and run no check, in a folder that is no repo", () =>
    Effect.gen(function* () {
      const { deps, folder, roots } = yield* policyWith(refusing(outside));
      const session = { cwd: folder, id: "s2" };
      const brief = yield* deps.brief(session);
      const push = yield* deps.guardTool(session, GuardedCall.Push());
      const settled = yield* deps.settle(session);

      expect({ brief, push, roots, settled }).toStrictEqual({
        brief: Option.none(),
        push: Option.none(),
        roots: [],
        settled: SettleVerdict.Waiting(),
      });
    })
  );

  it.live("preflight a push by the local check, in the claim's repo", () =>
    Effect.gen(function* () {
      const busy = new RepoBusy();

      const { deps, folder, keep, roots } = yield* policyWith(
        refusing(busy, outside)
      );

      yield* keep("s3", claimedIn(folder));

      const push = yield* deps.guardTool(
        { cwd: `${folder}/packages/a`, id: "s3" },
        GuardedCall.Push()
      );

      expect({ push, roots }).toStrictEqual({
        push: Option.some([busy, outside]),
        roots: [folder],
      });
    })
  );

  it.live(
    "settle as the policy's stop would hold: on a refusal the agent can fix",
    () =>
      Effect.gen(function* () {
        const busy = new RepoBusy();

        const cases = [
          {
            refusals: [outside],
            verdict: SettleVerdict.Refused({
              actionable: true,
              refusals: [outside],
            }),
          },
          {
            refusals: [busy],
            verdict: SettleVerdict.Refused({
              actionable: false,
              refusals: [busy],
            }),
          },
          { refusals: [], verdict: SettleVerdict.Waiting() },
        ];

        for (const { refusals, verdict } of cases) {
          const { deps, folder, keep } = yield* policyWith(
            refusing(...refusals)
          );

          yield* keep("s4", claimedIn(folder));

          expect(yield* deps.settle({ cwd: folder, id: "s4" })).toStrictEqual(
            verdict
          );
        }
      })
  );

  it.live(
    "judge an edit as the hook's pre-tool-use does, from the kept facts and without the check",
    () =>
      Effect.gen(function* () {
        const { deps, folder, keep, roots } = yield* policyWith(
          refusing(outside)
        );

        yield* keep("s6", claimedIn(folder));

        // pi names a file absolutely, or from the agent's folder.
        const session = { cwd: `${folder}/packages/a`, id: "s6" };

        const judged = yield* Effect.forEach(
          [`${folder}/${projectFile}`, "../../README.md", "src/week.ts"],
          (file) => deps.guardTool(session, GuardedCall.Write({ file }))
        );

        const unclaimed = yield* deps.guardTool(
          { cwd: folder, id: "s7" },
          GuardedCall.Write({ file: projectFile })
        );

        expect({ judged, roots, unclaimed }).toStrictEqual({
          judged: [
            Option.some([new TouchedJudge({ paths: [projectFile] })]),
            Option.some([outside]),
            Option.none(),
          ],
          roots: [],
          unclaimed: Option.none(),
        });
      })
  );

  it.live("fail as HookFailed when the local check gives no answer", () =>
    Effect.gen(function* () {
      const { deps, folder, keep } = yield* policyWith(
        Effect.fail(new PushCheckFailed({ reason: "it ran past 1m" }))
      );

      yield* keep("s5", claimedIn(folder));

      const failed = yield* Effect.flip(deps.settle({ cwd: folder, id: "s5" }));

      expect(failed.message).toContain("it ran past 1m");
    })
  );
});
