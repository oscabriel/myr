import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { OpenAsk } from "@repo/protocol/contracts";
import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Envelope } from "@repo/protocol/envelope";
import { LandedSha, RepoPath } from "@repo/protocol/ids";
import { NotRedFirst } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Ref,
  Runtime,
  Schema,
} from "effect";
import { CliOutput } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";

const PROJECT = "oscabriel/demo";

const ASK = "fix-a";

const ASK_FILE = `${Brand.configDir}/asks/${ASK}.ask.ts`;

const CHECK = `test/asks/${ASK}.test.ts`;

const askText = [
  `import { kinds, territory } from "${Brand.cliPackage}/rules";`,
  "",
  "export default kinds.fix.ask({",
  `  path: "${CHECK}",`,
  '  territory: territory.paths("src/a.ts"),',
  '  want: "a is two",',
  "});",
  "",
].join("\n");

const checkText = 'it("is two", () => expect(a).toBe(2));\n';

const landed = LandedSha.make("5555555555555555555555555555555555555555");

const opened: typeof OpenAsk.successSchema.Type = {
  ask: Schema.decodeSync(Ask)({
    askedBy: "oscabriel",
    blockedBy: [],
    brief: { want: "a is two" },
    check: Schema.encodeSync(CheckSpec)(
      CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(CHECK) })
    ),
    file: ASK_FILE,
    id: ASK,
    kind: "fix",
    openedAt: "2026-10-07T12:00:00.000Z",
    openedIn: landed,
    project: PROJECT,
    state: "open",
    territory: { module: ".", paths: ["src/a.ts"] },
  }),
  landed,
};

const aRepo = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

    yield* gitOk(repo, "init", "--quiet", "--initial-branch=main");

    for (const [file, content] of Object.entries(files)) {
      yield* fs.makeDirectory(path.dirname(path.join(repo, file)), {
        recursive: true,
      });
      yield* fs.writeFileString(path.join(repo, file), content);
    }

    return repo;
  });

const startedIn = (repo: string) =>
  Layer.effect(ChildProcessSpawner.ChildProcessSpawner)(
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;

      return ChildProcessSpawner.make((command) =>
        real.spawn(
          ChildProcess.isStandardCommand(command)
            ? ChildProcess.make(command.command, command.args, {
                ...command.options,
                cwd: path.resolve(repo, command.options.cwd ?? "."),
              })
            : command
        )
      );
    })
  ).pipe(Layer.provide(NodeServices.layer));

const aPlatform = (
  reply: Effect.Effect<typeof OpenAsk.successSchema.Type, NotRedFirst>
) =>
  Effect.map(Ref.make<readonly unknown[]>([]), (calls) => ({
    calls: Ref.get(calls),
    layer: Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
      Layer.provide([
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("openAsk", (payload) =>
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

const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

const cli = (
  repo: string,
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
        startedIn(repo)
      )
    )
  );

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

const argv = ["ask", "open", ASK, "--project", PROJECT, "--yes", "--json"];

describe(`${Brand.cli} ask open`, () => {
  it.live(
    "reads the ask file and the check it names from the working tree, and sends both",
    () =>
      Effect.gen(function* () {
        const repo = yield* aRepo({ [ASK_FILE]: askText, [CHECK]: checkText });
        const platform = yield* aPlatform(Effect.succeed(opened));
        const ran = yield* cli(repo, platform.layer, argv);

        expect(ran.code).toBe(0);
        expect(yield* platform.calls).toStrictEqual([
          {
            ask: ASK,
            files: [
              { content: askText, path: ASK_FILE },
              { content: checkText, path: CHECK },
            ],
            project: PROJECT,
          },
        ]);

        const envelope = yield* decodeEnvelope(ran.out.join("\n"));

        expect(envelope).toMatchObject({
          command: "ask open",
          data: { landed },
          ok: true,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "takes --files over the working tree, reading nothing",
    () =>
      Effect.gen(function* () {
        const repo = yield* aRepo({});
        const platform = yield* aPlatform(Effect.succeed(opened));

        const given = [{ content: "given", path: ASK_FILE }];

        const ran = yield* cli(repo, platform.layer, [
          ...argv,
          "--files",
          JSON.stringify(given),
        ]);

        expect(ran.code).toBe(0);
        expect(yield* platform.calls).toStrictEqual([
          { ask: ASK, files: given, project: PROJECT },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "sends the discussion --discussion names, so the thread it came from is marked asked",
    () =>
      Effect.gen(function* () {
        const repo = yield* aRepo({});
        const platform = yield* aPlatform(Effect.succeed(opened));

        const given = [{ content: "given", path: ASK_FILE }];

        const ran = yield* cli(repo, platform.layer, [
          ...argv,
          "--files",
          JSON.stringify(given),
          "--discussion",
          "disc-000001",
        ]);

        expect(ran.code).toBe(0);
        expect(yield* platform.calls).toStrictEqual([
          {
            ask: ASK,
            discussion: "disc-000001",
            files: given,
            project: PROJECT,
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live.each([
    {
      files: {},
      names: ASK_FILE,
      what: "no ask file",
    },
    {
      files: { [ASK_FILE]: askText.replace(`  path: "${CHECK}",\n`, "") },
      names: "names no check",
      what: "an ask file naming no path",
    },
    {
      files: { [ASK_FILE]: askText },
      names: CHECK,
      what: "a check the tree lacks",
    },
  ])(
    "with $what, exits 2 naming what is missing, and calls nothing",
    ({ files, names }) =>
      Effect.gen(function* () {
        const repo = yield* aRepo(files);
        const platform = yield* aPlatform(Effect.succeed(opened));
        const ran = yield* cli(repo, platform.layer, argv);

        expect({
          calls: yield* platform.calls,
          code: ran.code,
          said: ran.err.filter((line) => line.includes(names)).length,
        }).toStrictEqual({ calls: [], code: 2, said: 1 });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "prints the platform's refusal with its tag and exits as a refusal does",
    () =>
      Effect.gen(function* () {
        const repo = yield* aRepo({ [ASK_FILE]: askText, [CHECK]: checkText });

        const platform = yield* aPlatform(Effect.fail(new NotRedFirst({})));

        const ran = yield* cli(repo, platform.layer, argv);

        expect(ran.code).not.toBe(0);
        expect(ran.out.join("\n")).toContain("NotRedFirst");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );

  it.live(
    "without --yes exits 2 naming --yes, and reads and calls nothing",
    () =>
      Effect.gen(function* () {
        const repo = yield* aRepo({});
        const platform = yield* aPlatform(Effect.succeed(opened));

        const ran = yield* cli(repo, platform.layer, [
          "ask",
          "open",
          ASK,
          "--project",
          PROJECT,
        ]);

        expect({
          calls: yield* platform.calls,
          code: ran.code,
          said: ran.err.filter((line) => line.includes("--yes")).length,
        }).toStrictEqual({ calls: [], code: 2, said: 1 });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  );
});
