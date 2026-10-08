/**
 * The swarm (issue 702): its plan for a split family, its people, each
 * contributor's brief and workspace, and the run's summary file. The burrow
 * fixtures are what `<cli> asks` and `<cli> ask` printed for burrow's
 * `drop-legacy-fetch` family on the dev stage (2026-10-08).
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Ask, AskListing } from "@repo/protocol/domain/ask";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Envelope } from "@repo/protocol/envelope";
import { AskId, KindName, ProjectName } from "@repo/protocol/ids";
import {
  Array,
  ConfigProvider,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Ref,
  Result,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { LedgerFile, readLedger } from "../../../infra/created.ts";
import { optionsOf } from "../../../scripts/lib/swarm/args.ts";
import {
  NotEnoughAsks,
  planSwarm,
  SwarmPlan,
} from "../../../scripts/lib/swarm/plan.ts";
import { brief } from "../../../scripts/lib/swarm/prompt.ts";
import {
  AgentsResult,
  SwarmDir,
  writeAgentsResult,
} from "../../../scripts/lib/swarm/results.ts";
import { roster } from "../../../scripts/lib/swarm/roster.ts";
import type { Contributor } from "../../../scripts/lib/swarm/roster.ts";
import { nudges } from "../../../scripts/lib/swarm/scenario.ts";
import { prepareWorkspace } from "../../../scripts/lib/swarm/workspace.ts";
import { main } from "../../../scripts/swarm.ts";
import { Brand } from "../../brand/src/index.ts";
import { repoRoot } from "./root.ts";

const burrow = ProjectName.make("burrow");

const ListedAsks = Envelope(Schema.Struct({ asks: Schema.Array(AskListing) }));

/** What `<cli> ask <ask> --json` prints, when it shows the ask. */
const ShownAsk = Schema.Struct({
  command: Schema.Literal("ask"),
  data: Schema.Struct({ ask: Ask, brief: Schema.NonEmptyString }),
  ok: Schema.Literal(true),
  v: Schema.Literal(1),
});

/** A fixture's text. */
const fixture = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(
      path.join("test", "fixtures", "swarm", name)
    );
  });

/** burrow's open asks, as `<cli> asks --project burrow --json` listed them. */
const burrowAsks = Effect.gen(function* () {
  const envelope = yield* Schema.decodeEffect(
    Schema.fromJsonString(ListedAsks)
  )(yield* fixture("list-asks.json"));

  return envelope.ok ? envelope.data.asks : [];
});

const child = (module: string) => AskId.make(`drop-legacy-fetch-${module}`);

const children = [
  "burrow-auth",
  "burrow-billing",
  "burrow-catalog",
  "burrow-kit",
  "burrow-notify",
  "burrow-search",
].map(child);

const plan = (
  asks: readonly AskListing[],
  people: readonly Contributor[] = roster
) =>
  planSwarm({
    asks,
    project: burrow,
    roster: people,
    scenario: "plain",
    stage: "dev-oscabriel",
  });

describe("the plan", () => {
  it.effect(
    "hands burrow's six children to the six contributors in order, on four harnesses and six models, and holds the delete child",
    () =>
      Effect.gen(function* () {
        const { assignments, held } = Result.getOrThrow(
          plan(yield* burrowAsks)
        );

        expect(
          assignments.map(({ ask, contributor, territory }) => [
            contributor.handle,
            ask,
            territory,
          ])
        ).toStrictEqual([
          ["wren", children[0], "@burrow/auth"],
          ["tamsin", children[1], "@burrow/billing"],
          ["ivo", children[2], "@burrow/catalog"],
          ["marisol", children[3], "@burrow/kit"],
          ["dagny", children[4], "@burrow/notify"],
          ["pell", children[5], "@burrow/search"],
        ]);

        expect({
          harnesses: new Set(
            assignments.map(({ contributor }) => contributor.harness)
          ).size,
          models: new Set(
            assignments.map(({ contributor }) => contributor.model)
          ).size,
        }).toStrictEqual({ harnesses: 4, models: 6 });
        expect(held).toStrictEqual([
          "drop-legacy-fetch",
          "drop-legacy-fetch-delete",
        ]);
        expect(assignments.map(({ ask }) => ask)).not.toContain(
          "drop-legacy-fetch-delete"
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("gives no two contributors overlapping territories", () =>
    Effect.gen(function* () {
      const { assignments } = Result.getOrThrow(plan(yield* burrowAsks));

      const territories = assignments.map(({ territory }) => territory);

      expect(territories).toHaveLength(6);
      expect(new Set(territories).size).toBe(6);
      expect(territories).not.toContain(".");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "plans the same for the same asks, in whatever order they are listed",
    () =>
      Effect.gen(function* () {
        const asks = yield* burrowAsks;
        const first = Result.getOrThrow(plan(asks));

        expect(Result.getOrThrow(plan(asks))).toStrictEqual(first);
        expect(Result.getOrThrow(plan(Array.reverse(asks)))).toStrictEqual(
          first
        );
        expect(
          yield* Schema.decodeEffect(SwarmPlan)(
            yield* Schema.encodeEffect(SwarmPlan)(first)
          )
        ).toStrictEqual(first);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "fails NotEnoughAsks{wanted: 6, open: 5} with five open children",
    () =>
      Effect.gen(function* () {
        const asks = (yield* burrowAsks).filter(
          ({ ask }) => ask !== children[5]
        );

        expect(plan(asks)).toStrictEqual(
          Result.fail(new NotEnoughAsks({ open: 5, wanted: 6 }))
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("skips a child someone already claimed", () =>
    Effect.gen(function* () {
      const asks = (yield* burrowAsks).map((listed) =>
        listed.ask === children[1] ? { ...listed, claimed: true } : listed
      );

      const five = roster.slice(0, 5);
      const { assignments } = Result.getOrThrow(plan(asks, five));

      expect(assignments.map(({ ask }) => ask)).toStrictEqual([
        children[0],
        children[2],
        children[3],
        children[4],
        children[5],
      ]);
      expect(plan(asks)).toStrictEqual(
        Result.fail(new NotEnoughAsks({ open: 5, wanted: 6 }))
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "hands out only one of two asks on the same module, and nothing beside a whole-repo ask",
    () =>
      Effect.gen(function* () {
        const asks = yield* burrowAsks;

        const same = asks.map((listed) =>
          listed.ask === children[1]
            ? { ...listed, territory: "@burrow/auth" }
            : listed
        );

        expect(plan(same)).toStrictEqual(
          Result.fail(new NotEnoughAsks({ open: 5, wanted: 6 }))
        );
        expect(
          Result.getOrThrow(plan(same, roster.slice(0, 5))).assignments.map(
            ({ ask }) => ask
          )
        ).toStrictEqual([
          children[0],
          children[2],
          children[3],
          children[4],
          children[5],
        ]);

        const whole: AskListing = {
          ask: AskId.make("aaa-whole-repo"),
          blockedBy: [],
          claimed: false,
          kind: KindName.make("fix"),
          territory: ".",
          want: "Touch everything",
        };

        const first = Result.getOrThrow(
          plan([whole, ...asks], roster.slice(0, 1))
        );

        expect(first.assignments.map(({ ask }) => ask)).toStrictEqual([
          "aaa-whole-repo",
        ]);
        expect(plan([whole, ...asks], roster.slice(0, 2))).toStrictEqual(
          Result.fail(new NotEnoughAsks({ open: 1, wanted: 2 }))
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the roster", () => {
  it.effect(
    "is six people burrow vouches for, on four harnesses and six models, with the pi adapter on one pi agent only",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        const vouched = new Set(
          (yield* fs.readFileString(
            path.join(root, "examples", "burrow", Brand.configDir, "vouched.td")
          ))
            .split("\n")
            .map((line) => line.split(" ")[0] ?? "")
            .filter((handle) => /^[a-z]/u.test(handle))
        );

        expect(roster.map(({ handle }) => handle)).toStrictEqual([
          "wren",
          "tamsin",
          "ivo",
          "marisol",
          "dagny",
          "pell",
        ]);

        expect(
          roster.filter(({ handle }) => !vouched.has(handle))
        ).toStrictEqual([]);
        expect(roster.map(({ harness }) => harness)).toStrictEqual([
          "claude-code",
          "opencode",
          "amp",
          "pi",
          "pi",
          "pi",
        ]);
        expect(
          roster.flatMap(({ adapter, handle }) => (adapter ? [handle] : []))
        ).toStrictEqual(["pell"]);

        // An Anthropic id, OpenCode's GPT, an Amp mode, then pi's three.
        const models = [
          /^claude-/u,
          /^openai\/gpt-/u,
          /^(?:low|medium|high|ultra)$/u,
          /\/kimi-k3$/u,
          /\/glm-5\.3$/u,
          /\/gemini-[\d.]+-flash$/u,
        ];

        expect(
          roster.map(({ model }, at) => models[at]?.test(model))
        ).toStrictEqual([true, true, true, true, true, true]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the scenarios' nudges", () => {
  it("adds nothing to anyone's brief in the plain scenario", () => {
    expect(roster.map((_, index) => nudges("plain", index))).toStrictEqual(
      roster.map(() => Option.none())
    );
  });

  it("tells contributor 2 a disable comment is fine, and contributor 3 that it needs its reason, in the video scenario", () => {
    const told = roster.map((_, index) => nudges("video", index));

    expect(told.map(Option.isSome)).toStrictEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(Option.getOrThrow(told[1] ?? Option.none())).toContain(
      "disable comment"
    );
    expect(Option.getOrThrow(told[1] ?? Option.none())).not.toContain(" -- ");
    expect(Option.getOrThrow(told[2] ?? Option.none())).toContain(
      "reason after ` -- `"
    );
  });
});

/** The ask page `<cli> ask` printed for burrow's auth child. */
const authPage = Effect.gen(function* () {
  const text = (yield* fixture("show-ask.json")).replaceAll(
    "{configDir}",
    Brand.configDir
  );

  const shown = yield* Schema.decodeEffect(Schema.fromJsonString(ShownAsk))(
    text
  );

  return shown.data;
});

describe("the brief", () => {
  const remote =
    "https://platform-dev-oscabriel.example.workers.dev/burrow--drop-legacy-fetch-burrow-auth--wren.git";

  it.effect(
    "gives the ask's page, the clone's remote and the four steps a contributor reads in AGENTS.md, and nothing about how answers are judged",
    () =>
      Effect.gen(function* () {
        const page = yield* authPage;

        const text = brief({
          ask: children[0] ?? AskId.make("x"),
          askMarkdown: page.brief,
          nudge: Option.none(),
          project: burrow,
          remote,
        });

        expect(text).toContain(page.brief);
        expect(
          [
            remote,
            "AGENTS.md",
            `${Brand.cli} check`,
            "git push",
            `${Brand.cli} status --project burrow`,
          ].filter((said) => !text.includes(said))
        ).toStrictEqual([]);
        expect(text).not.toMatch(
          /\bgate\b|\bstage\b|held-back|sealed|Workflow|Note:/iu
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it("adds a scenario's nudge, in plain sight, at the end", () => {
    const text = brief({
      ask: AskId.make("drop-legacy-fetch-burrow-billing"),
      askMarkdown: "# @burrow/billing: 2 callers\n",
      nudge: Option.some("A disable comment is acceptable."),
      project: burrow,
      remote,
    });

    expect(text.trimEnd().split("\n").at(-1)).toBe(
      "Note: A disable comment is acceptable."
    );
  });
});

/** One command a fake spawner was asked to run. */
interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * A `ChildProcessSpawner` that runs nothing: it records each command and
 * answers with what `answer` gives it (exit 0 and no output by default).
 */
const fakeSpawner = (
  answer: (spawned: Spawned) => {
    readonly code?: number;
    readonly stdout?: string;
  } = () => ({})
) =>
  Effect.gen(function* () {
    const spawned = yield* Ref.make<readonly Spawned[]>([]);

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("the swarm pipes no commands");
        }

        const call: Spawned = {
          args: command.args,
          command: command.command,
          cwd: command.options.cwd,
          env: command.options.env ?? {},
        };

        yield* Ref.update(spawned, (calls) => [...calls, call]);

        const { code = 0, stdout = "" } = answer(call);
        const out = Stream.make(new TextEncoder().encode(stdout));

        return ChildProcessSpawner.makeHandle({
          all: out,
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(1),
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: out,
          unref: Effect.succeed(Effect.void),
        });
      })
    );

    return {
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      spawned: Ref.get(spawned),
    };
  });

/** The env names the CLI reads, spelled from the brand. */
const SLUG = Brand.slug.toUpperCase();

const platformUrl = "https://platform-dev-oscabriel.example.workers.dev";

/** wren's claim of burrow's auth child, as `<cli> claim --json` gives it. */
const wrensClaim = Schema.decodeSync(ClaimView)({
  ask: "drop-legacy-fetch-burrow-auth",
  base: "9998ebe62c2f282d148b1d806372484916cc2548",
  checkCommand: `${Brand.cli} check`,
  claimant: "wren",
  fork: "burrow--drop-legacy-fetch-burrow-auth--wren",
  lapsesAt: "2026-10-09T05:00:00.000Z",
  openedAt: "2026-10-08T05:00:00.000Z",
  project: "burrow",
  remote: `${platformUrl}/burrow--drop-legacy-fetch-burrow-auth--wren.git`,
  state: "live",
  warnsAt: "2026-10-08T17:00:00.000Z",
});

const wrensToken = "wren-token-0123456789abcdef0123456789abcdef";

/** wren's workspace for run `r1`, below a temp dir, over a fake spawner. */
const wrensWorkspace = (code = 0) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const swarm = yield* fs.makeTempDirectoryScoped();
    const fake = yield* fakeSpawner(() => ({ code }));

    const [wren] = roster;

    const workspace = yield* prepareWorkspace({
      claim: wrensClaim,
      contributor: wren,
      platformUrl,
      run: "r1",
      token: Redacted.make(wrensToken),
    }).pipe(
      Effect.provide(fake.layer),
      Effect.provideService(SwarmDir, swarm),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { PATH: "/usr/local/bin:/usr/bin" } })
      ),
      Effect.result
    );

    return { spawned: yield* fake.spawned, swarm, workspace };
  });

describe("a contributor's workspace", () => {
  it.effect(
    "writes the CLI and the credential helper as shims in bin/, gives the harness its env, and clones the fork with the helper in the clone's config",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { spawned, swarm, workspace } = yield* wrensWorkspace();

        const dir = `${swarm}/r1/wren`;
        const bin = `${dir}/bin`;
        const helper = `${bin}/${Brand.gitCredentialHelper}`;
        const made = Result.getOrThrow(workspace);

        expect(made).toStrictEqual({
          clone: `${dir}/clone`,
          dir,
          env: {
            GIT_EDITOR: ":",
            GIT_MERGE_AUTOEDIT: "no",
            GIT_SEQUENCE_EDITOR: ":",
            GIT_TERMINAL_PROMPT: "0",
            PATH: `${bin}:/usr/local/bin:/usr/bin`,
            [`${SLUG}_TOKEN`]: wrensToken,
            [`${SLUG}_URL`]: platformUrl,
            XDG_CONFIG_HOME: `${dir}/config`,
          },
          redacted: [`${SLUG}_TOKEN`],
        });

        const cli = yield* fs.readFileString(`${bin}/${Brand.cli}`);
        const credential = yield* fs.readFileString(helper);

        const modes = yield* Effect.forEach(
          [`${bin}/${Brand.cli}`, helper],
          (shim) =>
            Effect.map(fs.stat(shim), ({ mode }) => (mode % 0o1000).toString(8))
        );

        expect({
          cli: /^#!\/bin\/sh\n(?:#.*\n)?exec bun '[^']+\/apps\/cli\/src\/bin\.ts' "\$@"\n$/u.test(
            cli
          ),
          config: (yield* fs.stat(`${dir}/config`)).type,
          credential:
            /^#!\/bin\/sh\n(?:#.*\n)?exec bun '[^']+\/apps\/cli\/src\/bin\.ts' credential "\$@"\n$/u.test(
              credential
            ),
          modes,
        }).toStrictEqual({
          cli: true,
          config: "Directory",
          credential: true,
          modes: ["755", "755"],
        });

        expect(spawned).toStrictEqual([
          {
            args: [
              "clone",
              "--config",
              `credential.${platformUrl}.helper=`,
              "--config",
              `credential.${platformUrl}.helper=${helper}`,
              "--config",
              `credential.${platformUrl}.useHttpPath=true`,
              "--config",
              "user.name=wren",
              "--config",
              "user.email=wren@example.com",
              "--config",
              "commit.gpgsign=false",
              "--",
              wrensClaim.remote,
              `${dir}/clone`,
            ],
            command: "git",
            cwd: dir,
            env: made.env,
          },
        ]);
        expect(
          [cli, credential, ...spawned.flatMap(({ args }) => args)].filter(
            (text) => text.includes(wrensToken)
          )
        ).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "fails SwarmFailed when the clone fails, naming the fork and never the token",
    () =>
      Effect.gen(function* () {
        const { workspace } = yield* wrensWorkspace(128);

        const { _tag, reason } = Option.getOrThrow(
          Result.getFailure(workspace)
        );

        expect(_tag).toBe("SwarmFailed");
        expect(reason).toContain(wrensClaim.remote);
        expect(reason).not.toContain(wrensToken);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("the run's summary", () => {
  it.effect(
    "writes the run's summary to <run>/agents.json, and it decodes as AgentsResult",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const swarm = yield* fs.makeTempDirectoryScoped();

        const result = yield* Schema.decodeEffect(AgentsResult)({
          at: "2026-10-08T12:00:00.000Z",
          commit: "d7064cb0000000000000000000000000000000000",
          project: "burrow",
          runs: [
            {
              adapter: false,
              ask: "drop-legacy-fetch-burrow-auth",
              attempts: 3,
              durationMs: 412_000,
              handle: "wren",
              harness: "claude-code",
              landed: "9998ebe62c2f282d148b1d806372484916cc2548",
              model: "claude-opus-5-5",
              outcome: "landed",
              refusals: { OutOfScope: 1, StaleBase: 1 },
            },
            {
              adapter: true,
              ask: "drop-legacy-fetch-burrow-search",
              attempts: 0,
              durationMs: 0,
              handle: "pell",
              harness: "pi",
              model: "opencode/gemini-3.8-flash",
              outcome: "failed",
              refusals: {},
            },
          ],
          scenario: "plain",
          stage: "dev-oscabriel",
          v: 1,
        });

        yield* writeAgentsResult({ result, run: "r1" }).pipe(
          Effect.provideService(SwarmDir, swarm)
        );

        const written = yield* fs.readFileString(`${swarm}/r1/agents.json`);

        expect(
          yield* Schema.decodeEffect(Schema.fromJsonString(AgentsResult))(
            written
          )
        ).toStrictEqual(result);
        expect(written.at(-1)).toBe("\n");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

/** Why the flags `argv` make no run. */
const reasonOf = (argv: readonly string[]) =>
  optionsOf(argv).pipe(
    Effect.flip,
    Effect.map(({ reason }) => reason)
  );

describe("the swarm's flags", () => {
  it.effect(
    "takes burrow, plain, headless and 20 minutes when nothing else is named",
    () =>
      Effect.gen(function* () {
        const options = yield* optionsOf([
          "--stage",
          "dev-oscabriel",
          "--dry-run",
        ]);

        expect(options).toStrictEqual({
          dryRun: true,
          json: false,
          only: [],
          project: "burrow",
          scenario: "plain",
          stage: "dev-oscabriel",
          timeoutMin: 20,
          url: Option.none(),
        });
      })
  );

  it.effect(
    "reads --only as one or more handles from the roster, repeated or comma-separated",
    () =>
      Effect.gen(function* () {
        const options = yield* optionsOf([
          "--stage=dev-oscabriel",
          "--only",
          "wren",
          "pell",
          "--only=ivo,tamsin",
          "--scenario",
          "video",
          "--timeout-min",
          "5",
        ]);

        expect([
          options.only,
          options.scenario,
          options.timeoutMin,
        ]).toStrictEqual([["wren", "pell", "ivo", "tamsin"], "video", 5]);
        expect(
          yield* reasonOf(["--stage", "dev-oscabriel", "--only", "quickclaim"])
        ).toContain("not in the roster");
      })
  );

  it.effect(
    "refuses demo without --allow-demo, the herdr view until 717, no stage, and a flag it doesn't know",
    () =>
      Effect.gen(function* () {
        const reasons = yield* Effect.forEach(
          [
            ["--stage", "demo", "--dry-run"],
            ["--stage", "dev-oscabriel", "--view", "herdr"],
            ["--dry-run"],
            ["--stage", "dev-oscabriel", "--yes"],
            ["--stage", "dev-oscabriel", "--timeout-min", "0"],
          ],
          reasonOf
        );

        expect(
          reasons.map((reason, at) =>
            reason.includes(
              [
                "--allow-demo",
                "717",
                "no --stage",
                "unknown flag --yes",
                "--timeout-min 0",
              ][at] ?? "?"
            )
          )
        ).toStrictEqual([true, true, true, true, true]);
        expect(
          (yield* optionsOf(["--stage", "demo", "--allow-demo"])).stage
        ).toBe("demo");
      })
  );
});

/** What `main` prints, line by line, over a spawner that answers `asks` with the fixture. */
const dryRun = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const swarm = yield* fs.makeTempDirectoryScoped();
    const listed = yield* fixture("list-asks.json");

    const fake = yield* fakeSpawner(({ args }) =>
      args[1] === "asks" ? { stdout: listed } : { code: 1 }
    );

    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      error: () => {},
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    yield* main(argv).pipe(
      Effect.provide(fake.layer),
      Effect.provideService(SwarmDir, swarm),
      Effect.provideService(Console.Console, captured),
      // No SESSION_TOKENS, nor any token: a dry run needs none.
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: {} })
      )
    );

    return {
      made: yield* fs.readDirectory(swarm),
      printed,
      spawned: yield* fake.spawned,
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("the dry run", () => {
  const url = platformUrl;

  it.effect(
    "prints the plan as a table, each row ending in the command that would start that contributor, and only lists asks, anonymously",
    () =>
      Effect.gen(function* () {
        const { made, printed, spawned } = yield* dryRun([
          "--stage",
          "dev-oscabriel",
          "--project",
          "burrow",
          "--dry-run",
          "--url",
          url,
        ]);

        expect(printed.slice(0, 2)).toStrictEqual([
          `swarm: burrow on dev-oscabriel (${url}), scenario plain, 6 contributors`,
          expect.stringMatching(
            /^handle +harness +model +ask +territory +command$/u
          ),
        ]);

        const rows = printed.slice(2, 8);

        expect(rows.map((row) => row.split(/ +/u).slice(0, 5))).toStrictEqual([
          [
            "wren",
            "claude-code",
            "claude-opus-5-5",
            children[0],
            "@burrow/auth",
          ],
          [
            "tamsin",
            "opencode",
            "openai/gpt-6.1-sol",
            children[1],
            "@burrow/billing",
          ],
          ["ivo", "amp", "medium", children[2], "@burrow/catalog"],
          ["marisol", "pi", "opencode-go/kimi-k3", children[3], "@burrow/kit"],
          ["dagny", "pi", "opencode-go/glm-5.3", children[4], "@burrow/notify"],
          [
            "pell",
            "pi",
            "opencode/gemini-3.8-flash",
            children[5],
            "@burrow/search",
          ],
        ]);
        expect([rows[0], rows[5], ...printed.slice(8)]).toStrictEqual([
          expect.stringContaining(
            "/<run>/wren/clone' && claude -p --output-format stream-json --verbose --permission-mode bypassPermissions --model claude-opus-5-5 '<brief>'"
          ),
          expect.stringMatching(
            / pi -p --mode json .* -e \S+\/apps\/cli\/src\/pi\.ts '<brief>'$/u
          ),
          "held: drop-legacy-fetch, drop-legacy-fetch-delete",
          "dry run: nothing claimed, no harness started",
        ]);
        expect(
          spawned.map(({ args, env }) => ({
            args: args.slice(1),
            token: Object.hasOwn(env, `${SLUG}_TOKEN`)
              ? env[`${SLUG}_TOKEN`]
              : "inherited",
            url: env[`${SLUG}_URL`],
          }))
        ).toStrictEqual([
          {
            args: ["asks", "--project", "burrow", "--json"],
            token: undefined,
            url,
          },
        ]);
        expect(made).toStrictEqual([]);
      })
  );

  it.effect(
    "prints one decodable SwarmPlan with --json, and the video scenario's nudges in plain sight without it",
    () =>
      Effect.gen(function* () {
        const { printed } = yield* dryRun([
          "--stage",
          "dev-oscabriel",
          "--dry-run",
          "--json",
          "--url",
          url,
        ]);

        expect(printed).toHaveLength(1);

        const decoded = yield* Schema.decodeEffect(
          Schema.fromJsonString(SwarmPlan)
        )(printed[0] ?? "");

        expect(decoded.assignments.map(({ ask }) => ask)).toStrictEqual(
          children
        );

        const video = yield* dryRun([
          "--stage",
          "dev-oscabriel",
          "--dry-run",
          "--scenario",
          "video",
          "--url",
          url,
        ]);

        expect(
          video.printed.filter((line) => line.startsWith("nudge for "))
        ).toStrictEqual([
          `nudge for tamsin (video): ${Option.getOrThrow(nudges("video", 1))}`,
          `nudge for ivo (video): ${Option.getOrThrow(nudges("video", 2))}`,
        ]);
      })
  );
});

/** A fictional person's token on the fake platform: never printed, never in an argv. */
const tokenOf = (handle: string) =>
  `${handle}-token-0123456789abcdef0123456789ab`;

/**
 * `main` without `--dry-run`, over a fake platform: the CLI's `asks`, `ask`
 * and `claim` answer from the fixtures, git succeeds, and `SESSION_TOKENS`
 * holds `people`. The ledger and `.swarm/` are temp files.
 */
const fullRun = (people: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const swarm = yield* fs.makeTempDirectoryScoped();
    const ledger = `${swarm}/created.jsonl`;
    const listed = yield* fixture("list-asks.json");

    const shown = (yield* fixture("show-ask.json")).replaceAll(
      "{configDir}",
      Brand.configDir
    );

    const claimFor = (ask: string, token: string | undefined) => {
      const handle = roster.find(
        (one) => tokenOf(one.handle) === token
      )?.handle;

      const fork = `burrow--${ask}--${handle ?? "nobody"}`;

      return JSON.stringify({
        command: "claim",
        data: {
          claim: {
            ask,
            base: "9998ebe62c2f282d148b1d806372484916cc2548",
            checkCommand: `${Brand.cli} check`,
            claimant: handle,
            fork,
            lapsesAt: "2026-10-09T05:00:00.000Z",
            openedAt: "2026-10-08T05:00:00.000Z",
            project: "burrow",
            remote: `${platformUrl}/${fork}.git`,
            state: "live",
            warnsAt: "2026-10-08T17:00:00.000Z",
          },
        },
        ok: true,
        v: 1,
      });
    };

    const fake = yield* fakeSpawner(({ args, command, env }) => {
      if (command === "git") {
        return args.includes("rev-parse")
          ? { stdout: "d7064cb4f9f0f0e0d0c0b0a090807060504030201\n" }
          : {};
      }

      const [, verb = "", ask = ""] = args;

      return (
        {
          ask: { stdout: shown },
          asks: { stdout: listed },
          claim: { stdout: claimFor(ask, env[`${SLUG}_TOKEN`]) },
        }[verb] ?? { code: 1 }
      );
    });

    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      error: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    const sessions = Object.fromEntries(
      people.map((handle) => [tokenOf(handle), handle])
    );

    const result = yield* main([
      "--stage",
      "dev-oscabriel",
      "--url",
      platformUrl,
    ]).pipe(
      Effect.provide(fake.layer),
      Effect.provideService(SwarmDir, swarm),
      Effect.provideService(LedgerFile, ledger),
      Effect.provideService(Console.Console, captured),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: { SESSION_TOKENS: JSON.stringify(sessions) },
        })
      ),
      Effect.result
    );

    // The TestClock's epoch names the run.
    const summary = `${swarm}/19700101-000000/agents.json`;

    return {
      agents: (yield* fs.exists(summary))
        ? Option.some(yield* fs.readFileString(summary))
        : Option.none<string>(),
      ledger: yield* readLedger.pipe(Effect.provideService(LedgerFile, ledger)),
      printed,
      result,
      spawned: yield* fake.spawned,
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("a run", () => {
  it.effect(
    "claims each ask as its contributor, records each fork for teardown, prepares six workspaces and writes the summary, with no token in any argv or line",
    () =>
      Effect.gen(function* () {
        const handles = roster.map(({ handle }) => handle);

        const { agents, ledger, printed, result, spawned } =
          yield* fullRun(handles);

        expect(Result.isSuccess(result)).toBeTruthy();

        const claims = spawned.filter(({ args }) => args[1] === "claim");

        // Six at once: in whatever order they ran.
        expect(
          claims
            .map(({ args, env }) => [args[2], env[`${SLUG}_TOKEN`]])
            .toSorted(([one = ""], [other = ""]) => one.localeCompare(other))
        ).toStrictEqual(
          handles.map((handle, at) => [children[at], tokenOf(handle)])
        );
        expect(
          ledger
            .map(({ by, kind, name, namespace, stage }) => ({
              by,
              kind,
              name,
              namespace,
              stage,
            }))
            .toSorted((one, other) => one.name.localeCompare(other.name))
        ).toStrictEqual(
          handles.map((handle, at) => ({
            by: "swarm",
            kind: "repo",
            name: `burrow--${children[at] ?? ""}--${handle}`,
            namespace: "projects-dev-oscabriel",
            stage: "dev-oscabriel",
          }))
        );

        const summary = yield* Schema.decodeEffect(
          Schema.fromJsonString(AgentsResult)
        )(Option.getOrElse(agents, () => ""));

        expect(
          summary.runs.map(({ handle, outcome }) => [handle, outcome])
        ).toStrictEqual(handles.map((handle) => [handle, "failed"]));
        expect(
          [...printed, ...spawned.flatMap(({ args }) => args)].filter((text) =>
            handles.some((handle) => text.includes(tokenOf(handle)))
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "stops before any claim when SESSION_TOKENS has no session for a contributor, naming them",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* fullRun(
          roster.slice(0, 5).map(({ handle }) => handle)
        );

        expect(
          Option.map(Result.getFailure(result), ({ reason }) => reason)
        ).toStrictEqual(
          Option.some(
            "SESSION_TOKENS has no session for pell: add each on the stage (human step H5 on demo), then run the swarm again"
          )
        );
        expect(spawned.map(({ args }) => args[1])).toStrictEqual(["asks"]);
      })
  );
});
