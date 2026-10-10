import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { InitProject } from "@repo/protocol/contracts";
import { Envelope } from "@repo/protocol/envelope";
import { LandedSha, ProjectName } from "@repo/protocol/ids";
import { ProjectExists } from "@repo/protocol/refusal";
import type { ImportFailed } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { git, gitOk } from "@repo/testkit/git";
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Runtime,
  Schema,
} from "effect";
import { CliOutput } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { projectFile } from "../../src/local/project-file.ts";
import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";

const CONFIG = `${Brand.configDir}/project.ts`;

const scripts = {
  lint: "oxlint",
  test: "vitest run",
  typecheck: "tsc --noEmit",
};

const ci = [
  "on: push",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - run: bun install --frozen-lockfile",
  "      - run: bun run test",
  "",
].join("\n");

/**
 * The config `init` proposes for the machine's repo: the commands its CI
 * and scripts run, each with where it was found.
 */
const proposal = projectFile(
  {
    checks: Object.fromEntries(
      new Map([
        ["unit", "bun run test"],
        ["lint", "bun run lint"],
        ["types", "bun run typecheck"],
      ])
    ),
    setup: "bun install --frozen-lockfile",
    test: "vitest run {path}",
  },
  [
    "setup from .github/workflows/ci.yml",
    "test from package.json",
    "checks.unit from .github/workflows/ci.yml",
    "checks.lint from package.json",
    "checks.types from package.json",
  ]
);

/**
 * A maintainer's machine: a repo on branch `work` whose scripts test, lint
 * and type-check and whose CI installs with Bun; an empty bare repo that
 * stands in for the platform's; and a `HOME` whose git config names who
 * commits and nothing else.
 */
const aMachine = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const bare = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const gitconfig = path.join(home, ".gitconfig");

  yield* fs.writeFileString(
    gitconfig,
    "[user]\n\tname = Maintainer\n\temail = maintainer@example.com\n"
  );

  yield* gitOk(repo, "init", "--quiet", "--initial-branch=work");

  yield* fs.writeFileString(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "demo", scripts }, null, 2)
  );

  yield* fs.makeDirectory(path.join(repo, ".github", "workflows"), {
    recursive: true,
  });

  yield* fs.writeFileString(path.join(repo, ".github/workflows/ci.yml"), ci);
  yield* gitOk(repo, "add", "-A");
  yield* gitOk(repo, "commit", "--quiet", "--message", "Start");
  yield* gitOk(bare, "init", "--quiet", "--bare");

  return { bare, gitconfig, home, remote: `file://${bare}`, repo };
});

type Machine = Effect.Success<typeof aMachine>;

/**
 * The real process spawner, as if the CLI were started in `machine.repo`
 * with `machine.home` as `HOME`: a command's relative folder is taken from
 * the repo, and git reads only the machine's global config.
 */
const startedIn = (machine: Machine) =>
  Layer.effect(ChildProcessSpawner.ChildProcessSpawner)(
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;

      const env = {
        GIT_CONFIG_GLOBAL: machine.gitconfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        HOME: machine.home,
        LC_ALL: "C",
        XDG_CONFIG_HOME: path.join(machine.home, ".config"),
      };

      return ChildProcessSpawner.make((command) =>
        real.spawn(
          ChildProcess.isStandardCommand(command)
            ? ChildProcess.make(command.command, command.args, {
                ...command.options,
                cwd: path.resolve(machine.repo, command.options.cwd ?? "."),
                env: { ...command.options.env, ...env },
                extendEnv: true,
              })
            : command
        )
      );
    })
  ).pipe(Layer.provide(NodeServices.layer));

/**
 * A platform whose `initProject` records each payload it decodes and answers
 * `reply`, reached through a client over the contracts' own schemas; any
 * other contract dies.
 */
const aPlatform = (
  reply: Effect.Effect<
    typeof InitProject.successSchema.Type,
    ProjectExists | ImportFailed
  >
) =>
  Effect.map(Ref.make<readonly unknown[]>([]), (calls) => ({
    calls: Ref.get(calls),
    layer: Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("initProject", (payload) =>
            Effect.andThen(
              Ref.update(calls, (all) => [...all, payload]),
              reply
            )
          )
        ),
        asTester,
      ])
    ),
  }));

/** The exit code the process would end with, as the runtime decides it. */
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

/** Runs `<cli> argv` on `machine` against `platform`: its exit code and what it printed. */
const cli = (
  machine: Machine,
  platform: Layer.Layer<Client>,
  argv: readonly string[]
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program(argv));

    return {
      code: exitCodeOf(exit),
      err: (yield* TestConsole.errorLines).flatMap((chunk) =>
        String(chunk).split("\n")
      ),
      out: (yield* TestConsole.logLines).map(String),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        TestConsole.layer,
        CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
        OutputPlain,
        platform,
        SignedOut,
        startedIn(machine)
      )
    )
  );

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/** The one envelope `--json` printed. */
const envelopeOf = (out: readonly string[]) =>
  Effect.gen(function* () {
    expect(out).toHaveLength(1);

    return yield* decodeEnvelope(out[0] ?? "");
  });

/** What git says about the machine's repo and the platform's. */
const state = (machine: Machine) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(machine.repo, CONFIG);

    return {
      branch: yield* gitOk(machine.repo, "branch", "--show-current"),
      commits: Number(
        yield* gitOk(machine.repo, "rev-list", "--count", "HEAD")
      ),
      config: (yield* fs.exists(file))
        ? Option.some(yield* fs.readFileString(file))
        : Option.none(),
      head: yield* gitOk(machine.repo, "rev-parse", "HEAD"),
      platformMain: (yield* git(
        machine.bare,
        "rev-parse",
        "--verify",
        "--quiet",
        "main"
      )).stdout.trim(),
      remotes: yield* gitOk(machine.repo, "remote"),
    };
  });

/** The platform made the project `demo`, served at the machine's bare repo. */
const created = (machine: Machine) =>
  Effect.succeed({ project: ProjectName.make("demo"), remote: machine.remote });

describe(`${Brand.cli} init in an existing repo`, () => {
  it.live(
    "writes the proposed config, commits it alone, makes the project, adds the remote and pushes HEAD to main",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const machine = yield* aMachine;

        // Work in progress the maintainer has staged: init must leave it be.
        yield* fs.writeFileString(path.join(machine.repo, "notes.md"), "wip\n");
        yield* gitOk(machine.repo, "add", "notes.md");

        const before = yield* state(machine);
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--yes",
          "--json",
        ]);

        expect(ran.code).toBe(0);
        expect(yield* envelopeOf(ran.out)).toStrictEqual({
          command: "init",
          data: {
            files: [CONFIG],
            project: "demo",
            pushed: true,
            remote: machine.remote,
          },
          ok: true,
          v: 1,
        });
        expect(yield* platform.calls).toStrictEqual([{ project: "demo" }]);

        const after = yield* state(machine);

        expect({
          branch: after.branch,
          commits: after.commits - before.commits,
          config: after.config,
          files: yield* gitOk(
            machine.repo,
            "show",
            "--name-only",
            "--format=",
            "HEAD"
          ),
          platformMain: after.platformMain,
          remote: yield* gitOk(machine.repo, "remote", "get-url", Brand.slug),
          remotes: after.remotes,
          staged: yield* gitOk(machine.repo, "diff", "--cached", "--name-only"),
        }).toStrictEqual({
          branch: "work",
          commits: 1,
          config: Option.some(proposal),
          files: CONFIG,
          platformMain: after.head,
          remote: machine.remote,
          remotes: Brand.slug,
          staged: "notes.md",
        });
        expect(
          yield* gitOk(machine.repo, "log", "-1", "--format=%s")
        ).toContain(CONFIG);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "without --yes exits 2 with a line naming --yes, and writes, calls and adds nothing",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const before = yield* state(machine);
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
        ]);

        expect(ran.code).toBe(2);
        expect(ran.err.filter((line) => line.includes("--yes"))).toHaveLength(
          1
        );
        expect(ran.out).toStrictEqual([]);
        expect(yield* platform.calls).toStrictEqual([]);
        expect(yield* state(machine)).toStrictEqual(before);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "with --dry-run prints the file, the payload and the git commands it would run, and does none of it",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const before = yield* state(machine);
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--dry-run",
          "--json",
        ]);

        expect(ran.code).toBe(0);

        const envelope = yield* envelopeOf(ran.out);

        const Plan = Schema.Struct({
          command: Schema.Literal("init"),
          data: Schema.Struct({
            dryRun: Schema.Literal(true),
            payload: Schema.Struct({
              files: Schema.Array(
                Schema.Struct({ content: Schema.String, path: Schema.String })
              ),
              git: Schema.Array(Schema.Array(Schema.String)),
              payload: Schema.Unknown,
            }),
          }),
          ok: Schema.Literal(true),
        });

        const { payload: plan } = (yield* Schema.decodeUnknownEffect(Plan)(
          envelope
        )).data;

        expect(plan).toStrictEqual({
          files: [{ content: proposal, path: CONFIG }],
          git: [
            ["git", "add", "--", CONFIG],
            [
              "git",
              "commit",
              "--quiet",
              "--message",
              expect.stringContaining(CONFIG),
              "--",
              CONFIG,
            ],
            ["git", "remote", "add", Brand.slug, expect.any(String)],
            [
              "git",
              "config",
              "--global",
              "--replace-all",
              expect.stringMatching(/^credential\..+\.helper$/u),
              "",
            ],
            [
              "git",
              "config",
              "--global",
              "--add",
              expect.stringMatching(/^credential\..+\.helper$/u),
              Brand.slug,
            ],
            [
              "git",
              "config",
              "--global",
              expect.stringMatching(/^credential\..+\.useHttpPath$/u),
              "true",
            ],
            ["git", "push", Brand.slug, "HEAD:main"],
          ],
          payload: { project: "demo" },
        });
        expect({
          calls: yield* platform.calls,
          state: yield* state(machine),
        }).toStrictEqual({ calls: [], state: before });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "keeps a config the repo already has, says so, and does the rest",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const machine = yield* aMachine;
        const mine = "// the maintainer's own\nexport default {};\n";

        yield* fs.makeDirectory(path.join(machine.repo, Brand.configDir));
        yield* fs.writeFileString(path.join(machine.repo, CONFIG), mine);
        yield* gitOk(machine.repo, "add", "-A");
        yield* gitOk(machine.repo, "commit", "--quiet", "--message", "Config");

        const before = yield* state(machine);
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--yes",
          "--json",
        ]);

        expect(ran.code).toBe(0);
        expect(
          ran.err.filter(
            (line) => line.includes(CONFIG) && line.includes("kept")
          )
        ).toHaveLength(1);
        expect(yield* envelopeOf(ran.out)).toStrictEqual({
          command: "init",
          data: {
            files: [],
            project: "demo",
            pushed: true,
            remote: machine.remote,
          },
          ok: true,
          v: 1,
        });

        const after = yield* state(machine);

        expect({
          config: after.config,
          head: after.head,
          platformMain: after.platformMain,
        }).toStrictEqual({
          config: Option.some(mine),
          head: before.head,
          platformMain: before.head,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "commits a config the work tree has and HEAD lacks, as it is, so a rerun after a failed commit pushes it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const machine = yield* aMachine;
        const mine = "// the maintainer's own\nexport default {};\n";

        // What a run whose commit failed (no user.name yet, a hook) leaves.
        yield* fs.makeDirectory(path.join(machine.repo, Brand.configDir));
        yield* fs.writeFileString(path.join(machine.repo, CONFIG), mine);
        yield* gitOk(machine.repo, "add", "--", CONFIG);

        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--yes",
          "--json",
        ]);

        expect(ran.code).toBe(0);
        expect(yield* envelopeOf(ran.out)).toStrictEqual({
          command: "init",
          data: {
            files: [CONFIG],
            project: "demo",
            pushed: true,
            remote: machine.remote,
          },
          ok: true,
          v: 1,
        });
        expect({
          committed: yield* gitOk(
            machine.repo,
            "show",
            "--name-only",
            "--format=",
            "HEAD"
          ),
          onPlatform: (yield* git(machine.bare, "show", `main:${CONFIG}`))
            .stdout,
        }).toStrictEqual({ committed: CONFIG, onPlatform: mine });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "prints ProjectExists once and exits 65, pushing nothing",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;

        const platform = yield* aPlatform(
          Effect.fail(new ProjectExists({ project: ProjectName.make("demo") }))
        );

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--yes",
        ]);

        expect(ran.code).toBe(65);
        expect(
          ran.err.filter((line) =>
            line.includes("a project named demo already exists")
          )
        ).toHaveLength(1);
        expect(ran.out).toStrictEqual([]);
        expect(yield* platform.calls).toStrictEqual([{ project: "demo" }]);

        const after = yield* state(machine);

        expect({
          platformMain: after.platformMain,
          remotes: after.remotes,
        }).toStrictEqual({ platformMain: "", remotes: "" });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "sets up git's credential helper for an https platform, prints what it changed, and with --no-push pushes nothing",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const platformUrl = "https://platform.example.test";
        const gateway = `${platformUrl}/demo.git`;

        const platform = yield* aPlatform(
          Effect.succeed({ project: ProjectName.make("demo"), remote: gateway })
        );

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "demo",
          "--yes",
          "--no-push",
          "--json",
        ]);

        expect(ran.code).toBe(0);
        expect(yield* envelopeOf(ran.out)).toStrictEqual({
          command: "init",
          data: {
            files: [CONFIG],
            project: "demo",
            pushed: false,
            remote: gateway,
          },
          ok: true,
          v: 1,
        });

        const helpers = yield* git(
          machine.repo,
          "config",
          "--file",
          machine.gitconfig,
          "--get-all",
          `credential.${platformUrl}.helper`
        );

        expect({
          helpers: helpers.stdout.trimEnd().split("\n"),
          platformMain: (yield* state(machine)).platformMain,
          printed: ran.err.filter((line) =>
            line.includes(`credential.${platformUrl}.helper`)
          ).length,
          useHttpPath: yield* gitOk(
            machine.repo,
            "config",
            "--file",
            machine.gitconfig,
            `credential.${platformUrl}.useHttpPath`
          ),
        }).toStrictEqual({
          // An empty helper first drops any general one, then the CLI's.
          helpers: ["", Brand.slug],
          platformMain: "",
          printed: 2,
          useHttpPath: "true",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );
});

describe(`${Brand.cli} init --import`, () => {
  it.live(
    "asks the platform to import the public repo, touches nothing here, and prints the clone command",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const before = yield* state(machine);
        const url = "https://example.test/acme/widgets.git";
        const gateway = "https://platform.example.test/widgets.git";

        const landed = LandedSha.make(
          "4444444444444444444444444444444444444444"
        );

        const platform = yield* aPlatform(
          Effect.succeed({
            landed,
            project: ProjectName.make("widgets"),
            remote: gateway,
          })
        );

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--import",
          url,
          "--branch",
          "trunk",
          "--yes",
          "--json",
        ]);

        expect(ran.code).toBe(0);
        expect(yield* platform.calls).toStrictEqual([
          { import: { branch: "trunk", url }, project: "widgets" },
        ]);
        expect(yield* envelopeOf(ran.out)).toStrictEqual({
          command: "init",
          data: {
            clone: `git clone ${gateway}`,
            files: [],
            landed,
            project: "widgets",
            pushed: false,
            remote: gateway,
          },
          ok: true,
          v: 1,
        });
        expect(yield* state(machine)).toStrictEqual(before);
        expect(
          (yield* git(
            machine.repo,
            "config",
            "--file",
            machine.gitconfig,
            "--list"
          )).stdout
        ).not.toContain("credential");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "prints the clone command for a person too",
    () =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const gateway = "https://platform.example.test/widgets.git";

        const platform = yield* aPlatform(
          Effect.succeed({
            project: ProjectName.make("widgets"),
            remote: gateway,
          })
        );

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--import",
          "https://example.test/acme/widgets.git",
          "--yes",
        ]);

        expect(ran.code).toBe(0);
        expect(ran.out.join("\n")).toContain(`git clone ${gateway}`);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live.each([
    "http://example.test/acme/widgets.git",
    "git@example.test:acme/widgets.git",
    "file:///srv/widgets.git",
  ])(
    "refuses %s before any call: a usage error, exit 2",
    (url) =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          "--project",
          "widgets",
          "--import",
          url,
          "--yes",
        ]);

        expect(ran.code).toBe(2);
        expect(
          ran.err.filter((line) => line.includes("https://"))
        ).toHaveLength(1);
        expect(yield* platform.calls).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live.each([
    {
      flags: [
        "--import",
        "https://example.test/acme/widgets.git",
        "--branch",
        "",
      ],
      names: "--branch",
    },
    { flags: ["--branch", "trunk"], names: "--import" },
  ])(
    "refuses $flags before any call, naming $names: a usage error, exit 2",
    ({ flags, names }) =>
      Effect.gen(function* () {
        const machine = yield* aMachine;
        const before = yield* state(machine);
        const platform = yield* aPlatform(created(machine));

        const ran = yield* cli(machine, platform.layer, [
          "init",
          ...flags,
          "--yes",
        ]);

        expect({
          calls: yield* platform.calls,
          code: ran.code,
          lines: ran.err.filter((line) => line.includes(names)).length,
          state: yield* state(machine),
        }).toStrictEqual({ calls: [], code: 2, lines: 1, state: before });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );
});
