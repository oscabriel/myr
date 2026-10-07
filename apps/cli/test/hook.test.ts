import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { defaultJudgeGlobs, judgeClosure } from "@repo/checks/judge";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { scan } from "@repo/gate/stages/shape";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Glob, RefNameText } from "@repo/protocol/domain/common";
import { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import { Envelope } from "@repo/protocol/envelope";
import { CommitSha, Handle, LandedSha, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  OutOfScope,
  RepoBusy,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asPerson, unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import {
  Array,
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Runtime,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { CliOutput } from "effect/cli";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { decideHook } from "../src/hook/decide.ts";
import type { HookClaim, HookFacts } from "../src/hook/decide.ts";
import type { HookInput } from "../src/hook/input.ts";
import { askJudge } from "../src/hook/judge.ts";
import {
  PushCheck,
  selfCommand,
  pushCheckWith,
} from "../src/hook/push-check.ts";
import { program } from "../src/main.ts";
import { OutputPlain } from "../src/output.ts";

/** The repo's top folder, as the session found it. */
const root = "/work/datekit";

/** The ask's check, one of the ask's own files: no answer may change it. */
const checkPath = "packages/a/test/week.test.ts";

const landedSha = "4444444444444444444444444444444444444444";

/** Bob's ask `fix-week`, as its file states it: module `a` is its territory. */
const askWire = {
  askedBy: "bob",
  blockedBy: [],
  brief: { want: "An ISO week date parses to the Monday of that week." },
  check: Schema.encodeSync(CheckSpec)(
    CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(checkPath) })
  ),
  file: `${Brand.configDir}/asks/fix-week.ask.ts`,
  id: "fix-week",
  kind: "fix",
  openedAt: "2026-10-07T12:00:00.000Z",
  openedIn: landedSha,
  project: "datekit",
  state: "claimed",
  territory: {
    module: "a",
    paths: ["packages/a/**"],
    publicFiles: ["packages/a/src/index.ts"],
  },
} as const;

/** The ask, as `showAsk` returns it. */
const ask = Schema.decodeSync(Ask)(askWire);

/** Alice's claim on `fix-week`, as the hook keeps it. */
const claim: HookClaim = {
  ask: ask.id,
  checkCommand: `bun test ${checkPath}`,
  project: ask.project,
  territory: ask.territory,
  want: ask.brief.want,
};

/** An unreasoned `.skip(` in the ask's check: the agent's to fix. */
const weakened = new Weakened({
  at: { line: 3, path: RepoPath.make(checkPath) },
  weakening: { marker: ".skip(" },
});

const sha = (digit: string) => CommitSha.make(digit.repeat(40));

/** A session with a claim, before any stop was held. */
const facts: HookFacts = {
  claim: Option.some(claim),
  holds: 0,
  judge: {
    paths: [...defaultJudgeGlobs, Glob.make(`/${checkPath}`)],
    pointers: ["package.json#/scripts"],
  },
  refusals: [],
  root,
};

const input = (fields: Partial<HookInput>): HookInput => ({
  cwd: root,
  hook_event_name: "PreToolUse",
  session_id: "session-1",
  ...fields,
});

/** A tool call on one file, as Claude Code sends it. */
const tool = (name: string, toolInput: NonNullable<HookInput["tool_input"]>) =>
  input({ tool_input: toolInput, tool_name: name });

/** Claude Code's PreToolUse deny, with the gateway's own text as the reason. */
const deny = (refusals: Array.NonEmptyReadonlyArray<Refusal>) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: explain(refusals).join("\n"),
  },
});

describe("pre-tool-use", () => {
  it.each([
    {
      expected: deny([
        new OutOfScope({ paths: [RepoPath.make("packages/b/src/x.ts")] }),
      ]),
      name: "a Write outside the territory is denied as OutOfScope",
      payload: tool("Write", {
        content: "export {}",
        file_path: `${root}/packages/b/src/x.ts`,
      }),
    },
    {
      expected: deny([
        new TouchedJudge({
          paths: [RepoPath.make(`${Brand.configDir}/project.ts`)],
        }),
      ]),
      name: "an Edit of the config folder is denied as TouchedJudge",
      payload: tool("Edit", {
        file_path: `${root}/${Brand.configDir}/project.ts`,
        new_string: "b",
        old_string: "a",
      }),
    },
    {
      expected: {},
      name: "a MultiEdit inside the territory is allowed",
      payload: tool("MultiEdit", {
        edits: [],
        file_path: `${root}/packages/a/src/week.ts`,
      }),
    },
    {
      expected: deny([
        new OutOfScope({ paths: [RepoPath.make("packages/b/notes.ipynb")] }),
      ]),
      name: "a NotebookEdit is judged by its notebook_path",
      payload: tool("NotebookEdit", {
        new_source: "",
        notebook_path: `${root}/packages/b/notes.ipynb`,
      }),
    },
    {
      expected: {},
      name: "Bash is the gateway's to judge, so it is allowed",
      payload: tool("Bash", { command: "rm -rf packages/b" }),
    },
    {
      expected: {},
      name: "Read changes nothing, so it is allowed",
      payload: tool("Read", { file_path: `${root}/${Brand.configDir}/x.ts` }),
    },
    {
      expected: {},
      name: "a file outside the repo is not ours to judge",
      payload: tool("Write", { content: "", file_path: "/tmp/scratch.ts" }),
    },
    {
      expected: deny([new TouchedJudge({ paths: [RepoPath.make(checkPath)] })]),
      name: "the ask's own check, inside the territory, is TouchedJudge",
      payload: tool("Edit", { file_path: `${root}/${checkPath}` }),
    },
    {
      expected: deny([
        new TouchedJudge({
          paths: [RepoPath.make("packages/a/vitest.config.ts")],
        }),
      ]),
      name: "a judged file inside the territory is TouchedJudge, not OutOfScope",
      payload: tool("Write", {
        file_path: `${root}/packages/a/vitest.config.ts`,
      }),
    },
    {
      expected: deny([
        new OutOfScope({ paths: [RepoPath.make("packages/b/src/y.ts")] }),
      ]),
      name: "a relative path is read from the harness's cwd, with .. resolved",
      payload: input({
        cwd: `${root}/packages/a`,
        tool_input: { file_path: "../b/src/./y.ts" },
        tool_name: "Write",
      }),
    },
  ])("$name", ({ expected, payload }) => {
    expect(decideHook("pre-tool-use", payload, facts).output).toStrictEqual(
      expected
    );
  });

  it("allows every edit when the session has no claim, and says why", () => {
    const decision = decideHook(
      "pre-tool-use",
      tool("Write", { file_path: `${root}/packages/b/src/x.ts` }),
      { ...facts, claim: Option.none() }
    );

    expect(decision.output).toStrictEqual({});
    expect(Option.isSome(decision.note)).toBeTruthy();
  });
});

describe("session-start", () => {
  const start = input({ hook_event_name: "SessionStart" });

  it("briefs the agent on its claim: the want, the territory and the check", () => {
    const { output } = decideHook("session-start", start, facts);

    const context = Schema.decodeUnknownSync(
      Schema.Struct({
        hookSpecificOutput: Schema.Struct({
          additionalContext: Schema.String,
          hookEventName: Schema.Literal("SessionStart"),
        }),
      })
    )(output).hookSpecificOutput.additionalContext;

    expect(context).toContain(claim.want);
    expect(context).toContain("`packages/a/**`");
    expect(context).toContain("`packages/a/src/index.ts`");
    expect(context).toContain(`\`${claim.checkCommand}\``);
    expect(context.split("\n")).toContain(
      `Run \`${Brand.cli} check\` before you push.`
    );
  });

  it("says nothing to the agent without a claim", () => {
    expect(
      decideHook("session-start", start, { ...facts, claim: Option.none() })
        .output
    ).toStrictEqual({});
  });
});

/** Claude Code's Stop, as it sends it. */
const stop = (fields: Partial<HookInput> = {}) =>
  input({ hook_event_name: "Stop", stop_hook_active: false, ...fields });

/** Claude Code's Stop hold, with the gateway's own text as the reason. */
const hold = (refusals: Array.NonEmptyReadonlyArray<Refusal>) => ({
  decision: "block",
  reason: explain(refusals).join("\n"),
});

describe("stop", () => {
  it("holds the agent with the check's refusal as the reason", () => {
    const decision = decideHook("stop", stop(), {
      ...facts,
      refusals: [weakened],
    });

    expect(decision.output).toStrictEqual(hold([weakened]));
    expect(decision.holds).toBe(1);
  });

  it("holds a third time in a row, and that hold is the last", () => {
    const third = decideHook("stop", stop({ stop_hook_active: true }), {
      ...facts,
      holds: 2,
      refusals: [weakened],
    });

    expect(third.output).toStrictEqual(hold([weakened]));
    expect(third.holds).toBe(3);

    const fourth = decideHook("stop", stop({ stop_hook_active: true }), {
      ...facts,
      holds: 3,
      refusals: [weakened],
    });

    expect(fourth.output).toStrictEqual({});
    expect(fourth.holds).toBe(0);
    expect(Option.getOrElse(fourth.note, () => "")).toContain("Weakened");
  });

  it("counts Claude Code's stop_hook_active as a hold in a row", () => {
    // The session's count was lost, but Claude Code says this stop follows a
    // hold: it is the second in a row.
    const decision = decideHook("stop", stop({ stop_hook_active: true }), {
      ...facts,
      holds: 0,
      refusals: [weakened],
    });

    expect(decision.output).toStrictEqual(hold([weakened]));
    expect(decision.holds).toBe(2);
  });

  it("lets the agent stop when the check is clean", () => {
    const decision = decideHook("stop", stop(), { ...facts, holds: 2 });

    expect(decision.output).toStrictEqual({});
    expect(decision.holds).toBe(0);
  });

  it("never holds on a retryable wait alone, and explains only what the agent can fix", () => {
    const busy = new RepoBusy({});

    expect(
      decideHook("stop", stop(), { ...facts, refusals: [busy] }).output
    ).toStrictEqual({});
    expect(
      decideHook("stop", stop(), { ...facts, refusals: [busy, weakened] })
        .output
    ).toStrictEqual(hold([weakened]));
  });

  it("lets the agent stop without a claim", () => {
    expect(
      decideHook("stop", stop(), {
        ...facts,
        claim: Option.none(),
        refusals: [weakened],
      }).output
    ).toStrictEqual({});
  });
});

describe("the gateway's own reading of a path", () => {
  /** The policy at the landed SHA: the closure `@repo/checks` computes for it. */
  const policy = Schema.decodeSync(Policy)({
    agents: "trailer",
    asks: [askWire],
    at: landedSha,
    budget: { decisionsPerDay: 5, expireDays: 14 },
    caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
    claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
    deciders: [{ handles: ["bob"], paths: "**" }],
    functions: { admit: false, opensAlone: false },
    judge: judgeClosure(
      Schema.decodeSync(RunBlock)({
        checks: { lint: "bun run lint" },
        test: "bun test {path}",
      }),
      [
        {
          content: '{"extends": "./tsconfig.base.json"}',
          path: "tsconfig.json",
        },
        { content: "{}", path: "tsconfig.base.json" },
        { content: '{"scripts": {}}', path: "package.json" },
      ]
    ),
    kinds: [],
    modules: [askWire.territory, { module: "b", paths: ["packages/b/**"] }],
    ratchets: [],
    record: { countsAfterDays: 30, windowDays: 365 },
    run: { checks: { lint: "bun run lint" }, test: "bun test {path}" },
    source: "config",
    vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
    vouches: [],
    weakening: { markers: [] },
  });

  /** Alice's push to her claim's fork, changing `path` alone. */
  const push = (path: string): PushFacts => ({
    addedLines: new Map(),
    ask: Option.some(ask),
    base: sha("1"),
    changes: [{ path: RepoPath.make(path), status: "modified" }],
    claim: Option.none(),
    claimsHeld: 1,
    head: sha("2"),
    landed: LandedSha.make(sha("4")),
    layerPaths: new Set(),
    opensAsk: false,
    policy,
    pusher: Person.make({ handle: Handle.make("alice") }),
    ratchetCounts: new Map(),
    ref: RefNameText.make("refs/heads/main"),
    scriptsChanged: false,
    target: PushTarget.ClaimFork({
      ask: ask.id,
      claimant: Handle.make("alice"),
      project: ask.project,
    }),
  });

  const session: HookFacts = {
    ...facts,
    judge: askJudge(policy.judge, ask),
  };

  it.effect.each([
    "packages/a/src/week.ts",
    "packages/b/src/x.ts",
    `${Brand.configDir}/project.ts`,
    `${Brand.configDir}/asks/fix-week.ask.ts`,
    checkPath,
    "packages/a/test/other.test.ts",
    "packages/a/vitest.config.ts",
    "packages/a/tsconfig.json",
    "tsconfig.base.json",
    ".github/workflows/ci.yml",
    "package.json",
    "packages/a/.env.production",
    "packages/a/.env.production.local",
    "README.md",
  ])("%s: the hook denies what the shape stage refuses, in its words", (path) =>
    Effect.gen(function* () {
      const refusals = (yield* scan.run(push(path))).filter(
        (refusal) =>
          Schema.is(OutOfScope)(refusal) || Schema.is(TouchedJudge)(refusal)
      );

      const decision = decideHook(
        "pre-tool-use",
        tool("Edit", { file_path: `${root}/${path}` }),
        session
      );

      expect(decision.output).toStrictEqual(
        Array.isReadonlyArrayNonEmpty(refusals) ? deny(refusals) : {}
      );
    })
  );
});

// ------------------------------------------------------------ the command

/** Alice's live claim on `fix-week`, made when main was at `base`. */
const liveClaim = (base: string) =>
  Schema.decodeSync(ClaimView)({
    ask: "fix-week",
    base,
    checkCommand: claim.checkCommand,
    claimant: "alice",
    fork: "datekit--fix-week--alice",
    lapsesAt: "2026-10-08T12:00:00.000Z",
    openedAt: "2026-10-07T12:00:00.000Z",
    project: "datekit",
    remote: "https://platform.example/datekit--fix-week--alice.git",
    state: "live",
    warnsAt: "2026-10-07T14:00:00.000Z",
  });

/**
 * Alice's clone of her claim's fork: a commit with two modules, the config
 * folder and the ask's check, and the fork as `origin`. Its root, real path.
 */
const aClone = (remote: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

    const files = new Map([
      [`${Brand.configDir}/project.ts`, "export default {};\n"],
      [checkPath, "test('week', () => {});\n"],
      [
        "package.json",
        '{"name": "datekit", "scripts": {"test": "bun test"}}\n',
      ],
      ["packages/a/src/index.ts", "export {};\n"],
      ["packages/b/src/x.ts", "export {};\n"],
      // The judge closure follows a tsconfig's `extends` among the root's files.
      ["base.json", "{}\n"],
      ["tsconfig.json", '{"extends": "./base"}\n'],
    ]);

    for (const [file, content] of files) {
      yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
        recursive: true,
      });
      yield* fs.writeFileString(path.join(dir, file), content);
    }

    yield* gitOk(dir, "init", "--quiet", "--initial-branch", "main");
    yield* gitOk(dir, "add", "--all");
    yield* gitOk(dir, "commit", "--quiet", "--message", "base");
    yield* gitOk(dir, "remote", "add", "origin", remote);

    return { base: yield* gitOk(dir, "rev-parse", "HEAD"), dir };
  });

/**
 * A platform whose `status` gives alice's claims as `claims` holds them
 * when asked, counting each `status` and each `showAsk`.
 */
const platformOf = (
  claims: Ref.Ref<readonly ClaimView[]>,
  asked: Ref.Ref<{ readonly showAsk: number; readonly status: number }>
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("showAsk", () =>
          Effect.as(
            Ref.update(asked, (count) => ({
              ...count,
              showAsk: count.showAsk + 1,
            })),
            { ask, brief: `# ${ask.id}` }
          )
        ),
        Contracts.toLayerHandler("status", () =>
          Effect.zipWith(
            Ref.get(claims),
            Ref.update(asked, (count) => ({
              ...count,
              status: count.status + 1,
            })),
            (held) => ({ answers: [], claims: held })
          )
        )
      ),
      asPerson(Handle.make("alice")),
    ])
  );

/** A platform that knows alice's claim, made at `base`, and what it was asked. */
const platformFor = (base: string) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make({ showAsk: 0, status: 0 });

    return {
      asked,
      platform: platformOf(
        yield* Ref.make<readonly ClaimView[]>([liveClaim(base)]),
        asked
      ),
    };
  });

/** What one run of `<cli> hook …` printed, and the exit code a process would have. */
interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

/**
 * Runs `argv` as a harness would: `stdin` on stdin, the state kept under
 * `stateHome`, with `services` (the platform, a shape check) beside the
 * CLI's own.
 */
const runHook = (
  argv: readonly string[],
  stdin: string,
  stateHome: string,
  services: Layer.Layer<Client> | Layer.Layer<Client | PushCheck>
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program(argv));

    return {
      code: Exit.match(exit, {
        onFailure: (cause) => Runtime.getErrorExitCode(Cause.squash(cause)),
        onSuccess: () => 0,
      }),
      err: (yield* TestConsole.errorLines).map(String),
      out: (yield* TestConsole.logLines).map(String),
    } satisfies Ran;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        TestConsole.layer,
        CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
        OutputPlain,
        services,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { XDG_STATE_HOME: stateHome } })
        ),
        // Last, so it stands in for the process's own stdio.
        Stdio.layerTest({
          stdin: Stream.make(new TextEncoder().encode(stdin)),
        })
      )
    )
  );

/** `TouchedJudge` for one path. */
const touchedJudgeOf = (path: string) =>
  new TouchedJudge({ paths: [RepoPath.make(path)] });

const tempDir = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped()
);

const fork = "https://platform.example/datekit--fix-week--alice.git";

describe(`${Brand.cli} hook, as a harness runs it`, () => {
  it.live(
    "briefs the session once, then denies an edit with the gateway's text, asking the platform nothing more",
    () =>
      Effect.gen(function* () {
        const { base, dir } = yield* aClone(fork);
        const state = yield* tempDir;
        const { asked, platform } = yield* platformFor(base);

        const started = yield* runHook(
          ["hook", "session-start", "--json"],
          JSON.stringify({
            cwd: dir,
            hook_event_name: "SessionStart",
            session_id: "s-1",
            source: "startup",
          }),
          state,
          platform
        );

        expect(started.code).toBe(0);
        expect(started.out.join("\n")).toContain(claim.checkCommand);

        const edit = (file: string) =>
          runHook(
            ["hook", "pre-tool-use", "--json"],
            JSON.stringify({
              cwd: dir,
              hook_event_name: "PreToolUse",
              session_id: "s-1",
              tool_input: { content: "", file_path: `${dir}/${file}` },
              tool_name: "Write",
            }),
            state,
            // The session's facts are kept: the platform is not asked again.
            Layer.mock(Client)({})
          );

        const edits = [
          yield* edit("packages/b/src/x.ts"),
          yield* edit(checkPath),
          yield* edit("packages/a/src/week.ts"),
          yield* edit("base.json"),
        ];

        const outOfScope = new OutOfScope({
          paths: [RepoPath.make("packages/b/src/x.ts")],
        });

        expect(edits).toStrictEqual([
          { code: 0, err: [], out: [JSON.stringify(deny([outOfScope]))] },
          {
            code: 0,
            err: [],
            out: [JSON.stringify(deny([touchedJudgeOf(checkPath)]))],
          },
          { code: 0, err: [], out: ["{}"] },
          {
            code: 0,
            err: [],
            out: [JSON.stringify(deny([touchedJudgeOf("base.json")]))],
          },
        ]);
        expect((yield* Ref.get(asked)).showAsk).toBe(1);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "holds a stop three times in a row while the check refuses, then lets it go with a note",
    () =>
      Effect.gen(function* () {
        const { base, dir } = yield* aClone(fork);
        const state = yield* tempDir;
        const { platform } = yield* platformFor(base);

        const refusing = Layer.mergeAll(
          platform,
          Layer.succeed(PushCheck)({
            run: () => Effect.succeed([weakened]),
          })
        );

        const stopRun = runHook(
          ["hook", "stop", "--json"],
          JSON.stringify({
            cwd: dir,
            hook_event_name: "Stop",
            session_id: "s-2",
            stop_hook_active: false,
          }),
          state,
          refusing
        );

        const held = JSON.stringify(hold([weakened]));

        for (const _ of [1, 2, 3]) {
          expect((yield* stopRun).out).toStrictEqual([held]);
        }

        const fourth = yield* stopRun;

        expect(fourth.out).toStrictEqual(["{}"]);
        expect(fourth.code).toBe(0);
        expect(fourth.err.join("\n")).toContain("Weakened");
        expect((yield* stopRun).out).toStrictEqual([held]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("reads stdin it cannot parse as a reason to allow, and says so", () =>
    Effect.gen(function* () {
      const ran = yield* runHook(
        ["hook", "pre-tool-use", "--json"],
        "not json",
        yield* tempDir,
        Layer.mock(Client)({})
      );

      expect(ran.code).toBe(0);
      expect(ran.out).toStrictEqual(["{}"]);
      expect(ran.err).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("answers without --json too, for a person trying it by hand", () =>
    Effect.gen(function* () {
      const ran = yield* runHook(
        ["hook", "stop"],
        JSON.stringify({
          cwd: "/",
          hook_event_name: "Stop",
          session_id: "s-4",
        }),
        yield* tempDir,
        Layer.mock(Client)({})
      );

      expect({ code: ran.code, out: ran.out }).toStrictEqual({
        code: 0,
        out: ["{}"],
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "allows a session in a repo that is none of the platform's, and says why",
    () =>
      Effect.gen(function* () {
        const { dir } = yield* aClone("git@github.com:owner/datekit.git");

        const ran = yield* runHook(
          ["hook", "session-start", "--json"],
          JSON.stringify({
            cwd: dir,
            hook_event_name: "SessionStart",
            session_id: "s-3",
          }),
          yield* tempDir,
          Layer.mock(Client)({})
        );

        expect(ran.out).toStrictEqual(["{}"]);
        expect(ran.err.join("\n")).toContain("none of the platform's");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "finds a claim taken mid-session at the next stop, in a clone of main, and guards from then on",
    () =>
      Effect.gen(function* () {
        const { base, dir } = yield* aClone(
          "https://platform.example/datekit.git"
        );

        const state = yield* tempDir;
        const claims = yield* Ref.make<readonly ClaimView[]>([]);
        const asked = yield* Ref.make({ showAsk: 0, status: 0 });

        const platform = Layer.mergeAll(
          platformOf(claims, asked),
          Layer.succeed(PushCheck)({ run: () => Effect.succeed([weakened]) })
        );

        const event = (name: string, fields: Partial<HookInput> = {}) =>
          runHook(
            ["hook", name, "--json"],
            JSON.stringify({
              cwd: dir,
              hook_event_name: name,
              session_id: "s-5",
              ...fields,
            }),
            state,
            platform
          );

        const edit = event("pre-tool-use", {
          tool_input: { file_path: `${dir}/packages/b/src/x.ts` },
          tool_name: "Edit",
        });

        const before = [yield* event("session-start"), yield* edit];

        // The agent claims the ask in its first turn.
        yield* Ref.set(claims, [liveClaim(base)]);

        const after = [yield* edit, yield* event("stop"), yield* edit];

        expect([...before, ...after].map(({ out }) => out)).toStrictEqual([
          ["{}"],
          ["{}"],
          // An edit before the stop still reads the facts kept at the start.
          ["{}"],
          [JSON.stringify(hold([weakened]))],
          [
            JSON.stringify(
              deny([
                new OutOfScope({
                  paths: [RepoPath.make("packages/b/src/x.ts")],
                }),
              ])
            ),
          ],
        ]);
        expect(yield* Ref.get(asked)).toStrictEqual({ showAsk: 1, status: 2 });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses an event it does not answer as a usage error, exit 2", () =>
    Effect.gen(function* () {
      const ran = yield* runHook(
        ["hook", "post-tool-use", "--json"],
        "{}",
        yield* tempDir,
        Layer.mock(Client)({})
      );

      expect(ran.code).toBe(2);
      expect(ran.out).toStrictEqual([]);
      expect(ran.err.join("\n")).toContain("session-start");
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

const encodeEnvelope = Schema.encodeSync(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/**
 * The default check over a stand-in for the CLI that prints `stdout` and
 * exits `code`, whatever arguments it is given.
 */
const checkPrinting = (stdout: string, code: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* tempDir;
    const printed = path.join(dir, "envelope.json");

    yield* fs.writeFileString(printed, stdout);

    const check = yield* Effect.provide(
      Effect.service(PushCheck),
      pushCheckWith(["sh", "-c", `cat '${printed}'; exit ${code}`])
    );

    return yield* Effect.result(check.run(dir));
  }).pipe(Effect.provide(NodeServices.layer));

describe("the default push check: this CLI, run again", () => {
  it.live("reads the refusals from a refused envelope, though it exits 1", () =>
    Effect.gen(function* () {
      const result = yield* checkPrinting(
        `${encodeEnvelope({ command: "check", ok: false, refusals: [weakened], v: 1 })}\n`,
        1
      );

      expect(result).toStrictEqual(Result.succeed([weakened]));
    })
  );

  it.live("reads a passing envelope as no refusals", () =>
    Effect.gen(function* () {
      const result = yield* checkPrinting(
        encodeEnvelope({ command: "check", data: {}, ok: true, v: 1 }),
        0
      );

      expect(result).toStrictEqual(Result.succeed([]));
    })
  );

  it.live("fails, for the hook to allow, when no envelope comes back", () =>
    Effect.gen(function* () {
      const result = yield* checkPrinting("error: not built", 1);

      expect(Result.isFailure(result)).toBeTruthy();
    })
  );

  it.each([
    {
      expected: ["/usr/bin/bun", "/home/a/cli/src/bin.ts"],
      started: {
        argv: ["/usr/bin/bun", "/home/a/cli/src/bin.ts", "hook"],
        execPath: "/usr/bin/bun",
      },
    },
    {
      expected: [`/usr/local/bin/${Brand.cli}`],
      started: {
        argv: ["bun", `/$bunfs/root/${Brand.cli}`, "hook"],
        execPath: `/usr/local/bin/${Brand.cli}`,
      },
    },
  ])(
    "runs $expected for a CLI started as $started.argv",
    ({ expected, started }) => {
      expect(selfCommand(started)).toStrictEqual(expected);
    }
  );
});
