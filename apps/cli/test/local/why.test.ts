import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CheckVersion,
  CommitSha,
  Handle,
  LandedSha,
  LaneName,
  PatchId,
  ProjectName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { UnknownCommit, UnknownProject } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import {
  Cause,
  Console,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Runtime,
  Schema,
  Struct,
} from "effect";
import { CliOutput } from "effect/cli";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { WorkingDirectory, parseLocation } from "../../src/local/why.ts";
import { program } from "../../src/main.ts";
import { Output, OutputPlain } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";

const project = ProjectName.make("datekit");

const alice = Handle.make("alice");

const carol = Handle.make("carol");

/** The second commit's message: its trailers, as an answerer wrote them. */
const message = [
  "Start the week on Monday",
  "",
  "Asked-by: carol",
  "Signed-off-by: alice",
  "Assisted-by: claude-code",
].join("\n");

/**
 * A repo with two commits: the first writes `src/week.ts` lines 1 and 2,
 * the second adds line 3 with `message`.
 */
const aRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const file = path.join(dir, "src", "week.ts");

  yield* gitOk(dir, "init", "--quiet", "--initial-branch=main");
  yield* fs.makeDirectory(path.join(dir, "src"));
  yield* fs.writeFileString(
    file,
    "export const days = 7;\nexport const weekend = [6, 0];\n"
  );
  yield* gitOk(dir, "add", ".");
  yield* gitOk(dir, "commit", "--quiet", "-m", "Count the days of a week");

  const first = CommitSha.make(yield* gitOk(dir, "rev-parse", "HEAD"));

  yield* fs.writeFileString(
    file,
    "export const days = 7;\nexport const weekend = [6, 0];\nexport const firstDay = 1;\n"
  );
  yield* gitOk(dir, "commit", "--quiet", "-am", message);

  const second = CommitSha.make(yield* gitOk(dir, "rev-parse", "HEAD"));

  return { dir, first, second };
});

/** What the platform was asked: each `landing` call's payload. */
type Asked = readonly { readonly project: string; readonly sha: string }[];

/** A record of `landing` calls, none yet. */
const noCalls = Ref.make<Asked>([]);

/** The platform's record of the second commit's landing. */
const landingOf = (sha: CommitSha): LandingView => ({
  ask: AskId.make("fix-week"),
  assisted: [{ harness: "claude-code", verified: false }],
  author: alice,
  credits: [
    { handle: carol, role: "Asked-by" },
    { handle: alice, role: "Signed-off-by" },
  ],
  landedAt: DateTime.makeUnsafe("2026-10-06T12:00:00Z"),
  project,
  sha: LandedSha.make(sha),
});

/** The same landing as `--json` prints it. */
const landingJson = (sha: string) => ({
  ask: "fix-week",
  assisted: [{ harness: "claude-code", verified: false }],
  author: "alice",
  credits: [
    { handle: "carol", role: "Asked-by" },
    { handle: "alice", role: "Signed-off-by" },
  ],
  landedAt: "2026-10-06T12:00:00.000Z",
  project: "datekit",
  sha,
});

/**
 * The platform in process, answering `landing` with `answer` and every
 * other contract never: a test reaching one fails.
 */
const platform = (
  answer: (payload: {
    readonly project: ProjectName;
    readonly sha: CommitSha;
  }) => Effect.Effect<
    { readonly landing: LandingView },
    UnknownCommit | UnknownProject
  >
) =>
  Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(unanswered, Contracts.toLayerHandler("landing", answer)),
      asTester,
    ])
  );

/**
 * A platform that knows `landed` as a landing and no other commit, and
 * records every `landing` call it is asked.
 */
const platformKnowing = (
  landed: Option.Option<CommitSha>,
  calls: Ref.Ref<Asked>
) =>
  platform(({ project: asked, sha }) =>
    Ref.update(calls, (all) => [...all, { project: asked, sha }]).pipe(
      Effect.andThen(
        Option.exists(landed, (known) => known === sha)
          ? Effect.succeed({ landing: landingOf(sha) })
          : Effect.fail(new UnknownCommit({ sha }))
      )
    )
  );

/**
 * Output as the agent policy gives it when `CLAUDECODE=1`: Markdown for
 * results, refusals and notes on stderr. `OutputPlain` is the person's.
 */
const OutputForAgent = Layer.succeed(Output)({
  mode: "agent",
  note: (text) => Console.error(text),
  plan: ({ payload }) => Console.log(JSON.stringify(payload)),
  refused: ({ refusals }) => Console.error(explain(refusals).join("\n")),
  success: ({ view }) => Console.log(view.markdown),
});

/** How the process would exit, by the runtime's own rule. */
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

/**
 * Runs `<cli> why …` in `dir` against `client`, printing through `output`,
 * and returns its exit code, stdout and stderr.
 */
const run = (
  dir: string,
  args: readonly string[],
  client: Layer.Layer<Client>,
  output: Layer.Layer<Output> = OutputPlain
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      program(["why", ...args]).pipe(
        Effect.provideService(WorkingDirectory, dir)
      )
    );

    return {
      code: exitCodeOf(exit),
      err: (yield* TestConsole.errorLines).map(String).join("\n"),
      out: (yield* TestConsole.logLines).map(String).join("\n"),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestConsole.layer,
        CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
        client,
        output,
        SignedOut
      )
    )
  );

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

describe("a line's location", () => {
  it("is a path and a line number", () => {
    expect(parseLocation("src/week.ts:42")).toStrictEqual(
      Option.some({ line: 42, path: RepoPath.make("src/week.ts") })
    );
  });

  it("splits at the last colon, so a path may hold one", () => {
    expect(parseLocation("docs/a:b.md:7")).toStrictEqual(
      Option.some({ line: 7, path: RepoPath.make("docs/a:b.md") })
    );
  });

  it.each([
    "src/week.ts",
    "src/week.ts:",
    ":3",
    "src/week.ts:0",
    "src/week.ts:-1",
    "src/week.ts:+3",
    "src/week.ts:3.5",
    "src/week.ts:three",
    "src/week.ts:99999999999999999999",
  ])("is no line: %j", (text) => {
    expect(parseLocation(text)).toStrictEqual(Option.none());
  });
});

describe(`${Brand.cli} why`, () => {
  it.live(
    "prints one envelope with the line's commit and the platform's landing record",
    () =>
      Effect.gen(function* () {
        const { dir, second } = yield* aRepo;
        const calls = yield* noCalls;

        const ran = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit", "--json"],
          platformKnowing(Option.some(second), calls)
        );

        expect(ran.code).toBe(0);
        expect(ran.err).toBe("");
        expect(yield* decodeEnvelope(ran.out)).toStrictEqual({
          command: "why",
          data: {
            landing: landingJson(second),
            line: 3,
            path: "src/week.ts",
            sha: second,
          },
          ok: true,
          v: 1,
        });
        expect(yield* Ref.get(calls)).toStrictEqual([
          { project: "datekit", sha: second },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "tells an agent, in Markdown, the ask, the author and each credit",
    () =>
      Effect.gen(function* () {
        const { dir, second } = yield* aRepo;
        const calls = yield* noCalls;

        const ran = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit"],
          platformKnowing(Option.some(second), calls),
          OutputForAgent
        );

        expect(ran.code).toBe(0);
        expect(ran.out.split("\n")).toStrictEqual(
          expect.arrayContaining([
            expect.stringContaining(`landing \`${second.slice(0, 7)}\``),
            "- Ask: `fix-week`",
            "- Author: alice",
            "- Asked-by: carol",
            "- Signed-off-by: alice",
            "- Assisted-by: claude-code (claimed)",
          ])
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    'names the ask a line\'s landing opened in an "Opened" row, and no ask it answers',
    () =>
      Effect.gen(function* () {
        const { dir } = yield* aRepo;

        const opening = platform(({ sha }) =>
          Effect.succeed({
            landing: {
              ...Struct.omit(landingOf(sha), ["ask"]),
              opened: AskId.make("format-ordinal"),
            },
          })
        );

        const agent = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit"],
          opening,
          OutputForAgent
        );

        expect(agent.code).toBe(0);
        expect(agent.out.split("\n")).toStrictEqual(
          expect.arrayContaining(["- Opened: `format-ordinal`"])
        );
        expect(agent.out).not.toContain("- Ask:");

        const person = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit"],
          opening
        );

        expect(person.code).toBe(0);
        expect(person.out.split("\n").map((line) => line.trim())).toStrictEqual(
          expect.arrayContaining(["Opened: format-ordinal"])
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "says a commit the platform did not land is none of its landings, and lists the trailers it carries",
    () =>
      Effect.gen(function* () {
        const { dir, second } = yield* aRepo;
        const calls = yield* noCalls;
        const unknowing = platformKnowing(Option.none(), calls);

        const json = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit", "--json"],
          unknowing
        );

        expect(json.code).toBe(0);
        expect(yield* decodeEnvelope(json.out)).toStrictEqual({
          command: "why",
          data: {
            line: 3,
            path: "src/week.ts",
            sha: second,
            trailers: [
              { key: "Asked-by", value: "carol" },
              { key: "Signed-off-by", value: "alice" },
              { key: "Assisted-by", value: "claude-code" },
            ],
          },
          ok: true,
          v: 1,
        });

        const text = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit"],
          unknowing
        );

        expect(text.code).toBe(0);
        expect(text.out.split("\n").map((line) => line.trim())).toStrictEqual(
          expect.arrayContaining([
            expect.stringContaining("which is not a platform landing"),
            "Asked-by: carol",
            "Signed-off-by: alice",
            "Assisted-by: claude-code",
          ])
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live.each([
    { args: ["src/week.ts:4"], why: "a line past the file's end" },
    { args: ["src/month.ts:1"], why: "a file not in HEAD" },
    { args: ["src/week.ts"], why: "no line at all" },
  ])("refuses $why as a usage error (exit 2), asking nothing", ({ args }) =>
    Effect.gen(function* () {
      const { dir } = yield* aRepo;
      const calls = yield* noCalls;

      const ran = yield* run(
        dir,
        [...args, "--project", "datekit"],
        platformKnowing(Option.none(), calls)
      );

      expect(ran.code).toBe(2);
      expect(ran.out).toBe("");
      expect(ran.err).toContain(args[0] ?? "");
      expect(yield* Ref.get(calls)).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "from a folder inside the repo, takes the path from there and names it from the repo's root",
    () =>
      Effect.gen(function* () {
        const { dir, second } = yield* aRepo;
        const calls = yield* noCalls;

        const ran = yield* run(
          `${dir}/src`,
          ["week.ts:3", "--project", "datekit", "--json"],
          platformKnowing(Option.some(second), calls)
        );

        expect(ran.code).toBe(0);
        expect(yield* decodeEnvelope(ran.out)).toMatchObject({
          data: { line: 3, path: "src/week.ts", sha: second },
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "without --project, asks about the project the repo's platform remote names",
    () =>
      Effect.gen(function* () {
        const { dir, second } = yield* aRepo;
        const calls = yield* noCalls;

        yield* gitOk(
          dir,
          "remote",
          "add",
          "origin",
          `https://${Brand.domain}/datekit.git`
        );

        const ran = yield* run(
          dir,
          ["src/week.ts:3", "--json"],
          platformKnowing(Option.some(second), calls)
        );

        expect(ran.code).toBe(0);
        expect(yield* Ref.get(calls)).toStrictEqual([
          { project: "datekit", sha: second },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "without --project or a platform remote, exits 2 asking for --project, and asks nothing",
    () =>
      Effect.gen(function* () {
        const { dir } = yield* aRepo;
        const calls = yield* noCalls;

        const ran = yield* run(
          dir,
          ["src/week.ts:3"],
          platformKnowing(Option.none(), calls)
        );

        expect(ran.code).toBe(2);
        expect(ran.err).toContain("--project");
        expect(yield* Ref.get(calls)).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("adds the verdict a fetched note carries on that commit", () =>
    Effect.gen(function* () {
      const { dir, first, second } = yield* aRepo;
      const calls = yield* noCalls;

      const verdict: Verdict = {
        ask: AskId.make("fix-week"),
        at: DateTime.makeUnsafe("2026-10-06T11:59:00Z"),
        base: first,
        checkVersion: CheckVersion.make("checks@1"),
        head: second,
        heldBack: [],
        lanes: [
          {
            command: "bun test",
            durationMs: 1200,
            lane: LaneName.make("test"),
            result: "passed",
          },
        ],
        outcome: Outcome.cases.Landed.make({ sha: LandedSha.make(second) }),
        patchId: PatchId.make("a".repeat(64)),
        project,
        stage: "checks",
        tree: TreeSha.make(yield* gitOk(dir, "rev-parse", "HEAD^{tree}")),
        verifier: "platform",
      };

      yield* gitOk(
        dir,
        "notes",
        `--ref=refs/notes/${Brand.slug}`,
        "add",
        "-m",
        yield* Schema.encodeEffect(Schema.fromJsonString(Verdict))(verdict),
        second
      );

      const ran = yield* run(
        dir,
        ["src/week.ts:3", "--project", "datekit", "--json"],
        platformKnowing(Option.some(second), calls)
      );

      expect(ran.code).toBe(0);
      expect(yield* decodeEnvelope(ran.out)).toStrictEqual({
        command: "why",
        data: {
          landing: landingJson(second),
          line: 3,
          note: yield* Schema.encodeEffect(Verdict)(verdict),
          path: "src/week.ts",
          sha: second,
        },
        ok: true,
        v: 1,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "prints a refusal from the platform once, and exits 66 for a name that names nothing",
    () =>
      Effect.gen(function* () {
        const { dir } = yield* aRepo;

        const ran = yield* run(
          dir,
          ["src/week.ts:3", "--project", "datekit"],
          platform(() => Effect.fail(new UnknownProject({ project })))
        );

        expect(ran.code).toBe(66);
        expect(ran.out).toBe("");
        expect(ran.err).toBe(
          explain([new UnknownProject({ project })]).join("\n")
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
