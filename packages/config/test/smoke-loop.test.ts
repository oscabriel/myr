/**
 * smoke's core loop: `bun scripts/smoke.ts --stage <s> --loop`
 * makes a throwaway project, opens an ask red first, claims it, pushes an
 * answer that reaches outside the ask's territory and hears `OutOfScope`
 * in git's own output, pushes the fix, and reads back its landing and its
 * verdict note, all through the CLI and git as a person would. Here it runs
 * against the Node world (`apps/platform/test/serve-world.ts`), reached
 * over HTTP and git as a stage is.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Effect,
  FileSystem,
  Layer,
  Path,
  Redacted,
  Ref,
  Result,
  Sink,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { LedgerFile, readLedger } from "../../../infra/created.ts";
import { servedWorld } from "../../../scripts/lib/seed.ts";
import {
  DemoStageRefused,
  smokeLoop,
} from "../../../scripts/lib/smoke/loop.ts";
import { DraftNeedsLoop, main } from "../../../scripts/smoke.ts";
import { Brand } from "../../brand/src/index.ts";
import { Handle } from "../../protocol/src/ids.ts";

const decider = Handle.make("ines-v");

const answerer = Handle.make("bram");

/** Each person's token in the world: no secret, it never leaves this machine. */
const tokens = {
  answerer: Redacted.make("bram-smoke-loop-world-token-0123456789abcdef"),
  decider: Redacted.make("ines-v-smoke-loop-world-token-0123456789abcd"),
};

/** A person in a trailer: their handle and the address the platform gives them. */
const credited = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

/** All a byte stream says, as text. */
const textOf = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** `git ls-remote <remote> <ref>` as anyone, with no credential at all. */
const anonymousTip = (remote: string, ref: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", ["ls-remote", remote, ref], {
          env: {
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
          },
          extendEnv: true,
        })
      );

      const [listed] = yield* Effect.all(
        [textOf(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return listed.split("\t")[0] ?? "";
    })
  );

describe("smokeLoop, against the Node world", () => {
  it.live(
    "opens an ask red first, hears OutOfScope from git, lands the fix with its author, committer and trailers, finds the verdict note, and writes its throwaways to the ledger",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "smoke-806-" });
        const ledger = path.join(dir, "created.jsonl");

        const { main: tip, report } = yield* Effect.scoped(
          Effect.gen(function* () {
            const origin = yield* servedWorld(
              new Map([
                [decider, tokens.decider],
                [answerer, tokens.answerer],
              ])
            );

            const ran = yield* smokeLoop({
              answerer: tokens.answerer,
              decider: tokens.decider,
              origin,
              run: "r1",
              stage: "node",
            });

            return {
              main: yield* anonymousTip(
                `${origin}/${ran.project}.git`,
                "refs/heads/main"
              ),
              report: ran,
            };
          })
        ).pipe(Effect.provideService(LedgerFile, ledger));

        expect({
          author: report.author,
          committer: report.committer,
          landed: report.landed,
          noteFound: report.noteFound,
          project: report.project,
          refusedWith: report.refusedWith,
          steps: report.timings.map(({ step }) => step),
          timed: report.timings.every(({ ms }) => ms >= 0),
          trailers: report.trailers.filter((trailer) =>
            /^(?:Asked-by|Signed-off-by):/u.test(trailer)
          ),
        }).toStrictEqual({
          author: "bram",
          committer: Brand.name,
          landed: tip,
          noteFound: true,
          project: "ines-v/smoke-r1",
          refusedWith: ["OutOfScope"],
          steps: [
            "people",
            "init",
            "open-ask",
            "claim",
            "out-of-scope",
            "answer",
            "landing",
            "verdict-note",
          ],
          timed: true,
          trailers: [
            `Asked-by: ${credited("ines-v")}`,
            `Signed-off-by: ${credited("bram")}`,
          ],
        });

        expect(
          (yield* readLedger.pipe(
            Effect.provideService(LedgerFile, ledger)
          )).map(({ by, kind, name, stage }) => ({ by, kind, name, stage }))
        ).toStrictEqual([
          {
            by: "smoke",
            kind: "project",
            name: "ines-v__smoke-r1",
            stage: "node",
          },
          {
            by: "smoke",
            kind: "repo",
            name: "ines-v__smoke-r1",
            stage: "node",
          },
          {
            by: "smoke",
            kind: "repo",
            name: "ines-v__smoke-r1--parse-year--bram",
            stage: "node",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    240_000
  );
});

/**
 * A spawner that runs nothing: each command it was asked for, by name. Any
 * command fails, so a run that reached one could not pass by accident.
 */
const refusing = Effect.gen(function* () {
  const asked = yield* Ref.make<readonly string[]>([]);

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      yield* Ref.update(asked, (all) => [
        ...all,
        ChildProcess.isStandardCommand(command) ? command.command : "a pipe",
      ]);

      return ChildProcessSpawner.makeHandle({
        all: Stream.empty,
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        pid: ChildProcessSpawner.ProcessId(1),
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    })
  );

  return {
    asked: Ref.get(asked),
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  };
});

/**
 * A platform scripted at the process boundary: `status` names the decider,
 * `projects` lists `listed`, git does what it is asked, and `init` makes
 * the project on the platform and then fails (as a push that answered 500
 * after the project was made did on a dev stage). What was spawned is kept, git by
 * its subcommand and the CLI by its command.
 */
const scripted = (listed: readonly string[]) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make<readonly string[]>([]);

    // Each CLI command's `--json` envelope, as the CLI prints it.
    const replies = new Map([
      [
        "status",
        {
          code: 0,
          stdout: JSON.stringify({
            command: "status",
            data: { handle: decider },
            ok: true,
            v: 1,
          }),
        },
      ],
      [
        "projects",
        {
          code: 0,
          stdout: JSON.stringify({
            command: "projects",
            data: {
              projects: listed.map((project) => ({
                openAsks: 0,
                posture: "open",
                project,
              })),
            },
            ok: true,
            v: 1,
          }),
        },
      ],
      ["init", { code: 1, stdout: "" }],
    ]);

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const [program, args] = ChildProcess.isStandardCommand(command)
          ? [command.command, command.args]
          : ["a pipe", []];

        // The CLI runs as `bun <entry> <command> … --json`.
        const said =
          program === "bun" ? (args[1] ?? "") : `${program} ${args[0] ?? ""}`;

        yield* Ref.update(asked, (all) => [...all, said]);

        const reply = replies.get(said) ?? { code: 0, stdout: "" };

        return ChildProcessSpawner.makeHandle({
          all: Stream.empty,
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(reply.code)),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(1),
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode(reply.stdout)),
          unref: Effect.succeed(Effect.void),
        });
      })
    );

    return {
      asked: Ref.get(asked),
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    };
  });

/**
 * The loop for run `r1` on the scripted platform, with the ledger in a file
 * of its own: how it ended, the CLI commands it ran, and the ledger's lines.
 */
const loopOnScripted = (listed: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "smoke-ledger-" });
    const ledger = path.join(dir, "created.jsonl");
    const platform = yield* scripted(listed);

    const failure = yield* smokeLoop({
      answerer: tokens.answerer,
      decider: tokens.decider,
      origin: "https://platform-dev.example.workers.dev",
      run: "r1",
      stage: "dev-example",
    }).pipe(
      Effect.catchTag("DemoStageRefused", Effect.die),
      Effect.flip,
      Effect.provide(platform.layer),
      Effect.provideService(LedgerFile, ledger)
    );

    const lines = yield* readLedger.pipe(
      Effect.provideService(LedgerFile, ledger)
    );

    return {
      cli: (yield* platform.asked).filter((said) => !said.startsWith("git ")),
      failure,
      ledger: lines.map(({ by, kind, name, stage }) => ({
        by,
        kind,
        name,
        stage,
      })),
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("smoke --loop's throwaway ledger", () => {
  it.live(
    "writes the project and its repo before init, so an init that made the project and then failed leaves them in the ledger",
    () =>
      Effect.gen(function* () {
        const { cli, failure, ledger } = yield* loopOnScripted([]);

        expect({ cli, ledger, step: failure.step }).toStrictEqual({
          cli: ["status", "status", "projects", "init"],
          ledger: [
            {
              by: "smoke",
              kind: "project",
              name: "ines-v__smoke-r1",
              stage: "dev-example",
            },
            {
              by: "smoke",
              kind: "repo",
              name: "ines-v__smoke-r1",
              stage: "dev-example",
            },
          ],
          step: "init",
        });
      })
  );

  it.live(
    "stops before init on a name the platform already lists, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { cli, failure, ledger } = yield* loopOnScripted([
          "oscabriel/datekit",
          "ines-v/smoke-r1",
        ]);

        expect({
          cli,
          ledger,
          reason: failure.reason,
          step: failure.step,
        }).toStrictEqual({
          cli: ["status", "status", "projects"],
          ledger: [],
          reason:
            "ines-v/smoke-r1 is on the platform already, so nothing was made or recorded: a run a second later takes another name",
          step: "init",
        });
      })
  );
});

describe("smoke --loop on demo", () => {
  it.live(
    "is refused with DemoStageRefused before any request or process: a throwaway project would show on demo's front page",
    () =>
      Effect.gen(function* () {
        const fetched: string[] = [];
        const spawner = yield* refusing;

        const result = yield* main(["--stage", "demo", "--loop"]).pipe(
          Effect.provide(spawner.layer),
          Effect.provideService(FetchHttpClient.Fetch, (input) => {
            fetched.push(new Request(input).url);

            return Promise.reject(new Error("smoke --loop on demo fetched"));
          }),
          Effect.result
        );

        expect({
          fetched,
          result,
          spawned: yield* spawner.asked,
        }).toStrictEqual({
          fetched: [],
          result: Result.fail(new DemoStageRefused({ stage: "demo" })),
          spawned: [],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("is refused by smokeLoop itself, whoever calls it", () =>
    Effect.gen(function* () {
      const spawner = yield* refusing;

      const failure = yield* Effect.flip(
        smokeLoop({
          answerer: tokens.answerer,
          decider: tokens.decider,
          origin: "https://platform-demo.example.workers.dev",
          run: "r1",
          stage: "demo",
        })
      ).pipe(Effect.provide(spawner.layer));

      expect({
        failure,
        message: failure.message,
        spawned: yield* spawner.asked,
      }).toStrictEqual({
        failure: new DemoStageRefused({ stage: "demo" }),
        message:
          "--loop makes a throwaway project, which would show on demo's front page: run it on a dev stage",
        spawned: [],
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("smokeLoop --draft, against the Node world", () => {
  it.live(
    "after the loop, the answerer's want is drafted red first by the memory drafter, the decider accepts it, and the ask opens disclosing the drafter beside the asker",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "drafting-" });

        const report = yield* Effect.scoped(
          Effect.gen(function* () {
            const origin = yield* servedWorld(
              new Map([
                [decider, tokens.decider],
                [answerer, tokens.answerer],
              ])
            );

            return yield* smokeLoop({
              answerer: tokens.answerer,
              decider: tokens.decider,
              draft: true,
              origin,
              run: "r2",
              stage: "node",
            });
          })
        ).pipe(
          Effect.provideService(LedgerFile, path.join(dir, "created.jsonl"))
        );

        expect({
          attempts: report.draft?.attempts,
          model: report.draft?.model,
          steps: report.timings.map(({ step }) => step).slice(-3),
          timed: (report.draft?.ms ?? -1) >= 0,
          trailers: report.draft?.trailers.filter((trailer) =>
            /^(?:Ask|Asked-by|Assisted-by):/u.test(trailer)
          ),
        }).toStrictEqual({
          attempts: 1,
          model: "memory",
          steps: ["draft-propose", "draft-ready", "draft-accept"],
          timed: true,
          trailers: [
            `Asked-by: ${credited("bram")}`,
            `Assisted-by: ${Brand.cli}-drafter:memory (verified)`,
            "Ask: ines-v/smoke-r2/parse-ordinal",
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    240_000
  );
});

describe("smoke --draft without --loop", () => {
  it.live(
    "is refused with DraftNeedsLoop before any request or process: only the loop has a project to draft on",
    () =>
      Effect.gen(function* () {
        const fetched: string[] = [];
        const spawner = yield* refusing;

        const result = yield* main([
          "--stage",
          "dev-oscabriel",
          "--draft",
        ]).pipe(
          Effect.provide(spawner.layer),
          Effect.provideService(FetchHttpClient.Fetch, (input) => {
            fetched.push(new Request(input).url);

            return Promise.reject(new Error("smoke --draft fetched"));
          }),
          Effect.result
        );

        expect({
          fetched,
          result,
          spawned: yield* spawner.asked,
        }).toStrictEqual({
          fetched: [],
          result: Result.fail(new DraftNeedsLoop({ flag: "--draft" })),
          spawned: [],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
