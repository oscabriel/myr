import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, vi } from "@effect/vitest";
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import { Brand } from "@repo/brand";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { pushStages, runGate } from "@repo/gate/gate";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import { Client, Contracts } from "@repo/protocol/contracts";
import { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import { Envelope } from "@repo/protocol/envelope";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
  keyOf,
  TreeSha,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  ChecksFailed,
  NotClaimed,
  OutOfScope,
  Refusal,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import {
  Array,
  Cause,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Runtime,
  Schema,
} from "effect";
import { CliOutput } from "effect/cli";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { ConfigBundlerBun, localPolicy } from "../../src/local/local-policy.ts";
import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";
import {
  aCheckRepo,
  ask,
  checkFile,
  commit,
  handle,
  policyFile,
  policyText,
  project,
} from "./fixture.ts";
import type { CheckRepo } from "./fixture.ts";

const noClaims = Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
  Layer.provide([
    Layer.mergeAll(
      unanswered,
      Contracts.toLayerHandler("status", () =>
        Effect.succeed({
          answers: [],
          claims: [],
          handle: Handle.make("tester"),
        })
      )
    ),
    asTester,
  ])
);

const claimView = Schema.decodeUnknownSync(ClaimView);

const claimedAt = (base: string) =>
  Layer.effect(Client)(RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("status", () =>
          Effect.succeed({
            answers: [],
            claims: [
              claimView({
                ask,
                base,
                checkCommand: `true ${checkFile}`,
                claimant: handle,
                fork: `${keyOf(ProjectName.make(project))}--${ask}--${handle}`,
                lapsesAt: "2099-01-02T00:00:00.000Z",
                openedAt: "2026-10-07T12:00:00.000Z",
                project,
                remote: `https://platform.example.dev/${project}--${ask}--${handle}.git`,
                state: "live",
                warnsAt: "2099-01-01T00:00:00.000Z",
              }),
            ],
            handle: Handle.make(handle),
          })
        )
      ),
      asTester,
    ])
  );

const unreachable = Layer.mock(Client)({});

const services = (client: Layer.Layer<Client>) =>
  Layer.mergeAll(
    TestConsole.layer,
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    client,
    OutputPlain,
    SignedOut
  ).pipe(Layer.provideMerge(NodeServices.layer));

const run = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program(argv));

    return {
      err: (yield* TestConsole.errorLines).map(String),
      exit,
      out: (yield* TestConsole.logLines).map(String),
    };
  });

const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const envelopeOf = (out: readonly string[]) =>
  Effect.gen(function* () {
    expect(out).toHaveLength(1);

    return yield* decodeJson(out[0] ?? "");
  });

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

const decodedOf = (out: readonly string[]) =>
  Effect.gen(function* () {
    expect(out).toHaveLength(1);

    return yield* decodeEnvelope(out[0] ?? "");
  });

const encodeRefusals = Schema.encodeEffect(Schema.Array(Refusal));

const offline = Layer.succeed(Fetch)({
  fetch: (request) =>
    Effect.fail(new FetchFailed({ reason: "offline", url: request.url })),
});

const gateSays = (repo: CheckRepo, head: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hosted = yield* fs.makeTempDirectoryScoped();
    const name = RepoName.make(keyOf(ProjectName.make(project)));

    yield* gitOk(
      repo.root,
      "clone",
      "--bare",
      "--quiet",
      repo.root,
      path.join(hosted, `${name}.git`)
    );

    const base = CommitSha.make(
      yield* gitOk(repo.root, "merge-base", "main", head)
    );

    const policy = yield* localPolicy(repo.root, "main", {
      initializer: Handle.make(handle),
      project: ProjectName.make(project),
    }).pipe(Effect.provide(ConfigBundlerBun));

    const fixA = yield* Effect.fromOption(
      Array.findFirst(policy.asks, ({ id }) => id === ask)
    );

    const host = RepoHostLocal.layer({
      remoteBase: "http://unused",
      root: hosted,
    }).pipe(Layer.provide(offline));

    const changes = yield* Effect.gen(function* () {
      const treeOf = (sha: string) =>
        RepoHost.use((repos) =>
          repos.readCommit(name, CommitSha.make(sha))
        ).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.map(({ tree }) => TreeSha.make(tree))
        );

      const diff = yield* treeDiff(
        name,
        yield* treeOf(base),
        yield* treeOf(head)
      );

      return { added: yield* addedLines(name, diff), diff };
    }).pipe(Effect.provide(host));

    const now = yield* DateTime.now;
    const claimant = Handle.make(handle);

    const facts: PushFacts = {
      addedLines: changes.added,
      ask: Option.some(fixA),
      base,
      changes: changes.diff,
      claim: Option.some({
        ask: AskId.make(ask),
        base,
        checkCommand: `${Brand.cli} check`,
        claimant,
        fork: RepoName.make(
          `${keyOf(ProjectName.make(project))}--${ask}--${handle}`
        ),
        lapsesAt: now,
        openedAt: now,
        project: ProjectName.make(project),
        remote: "https://platform.example.dev/fork.git",
        state: "live",
        warnsAt: now,
      }),
      claimsHeld: 1,
      head: CommitSha.make(head),
      landed: LandedSha.make(repo.main),
      layerPaths: new Set(),
      opensAsk: false,
      policy,
      pusher: Person.make({ handle: claimant }),
      ref: RefNameText.make("refs/heads/main"),
      scriptsChanged: false,
      target: PushTarget.ClaimFork({
        ask: AskId.make(ask),
        claimant,
        project: ProjectName.make(project),
      }),
    };

    const refusals = yield* runGate(pushStages, facts).pipe(
      Effect.flatMap(Effect.fromOption)
    );

    return { encoded: yield* encodeRefusals(refusals), refusals };
  });

const stateOf = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const store = path.join(root, ".git");

    return {
      config: yield* fs.readFileString(path.join(store, "config")),
      head: yield* gitOk(root, "rev-parse", "--symbolic-full-name", "HEAD"),
      index: yield* fs.readFile(path.join(store, "index")),
      refs: yield* gitOk(root, "for-each-ref"),
      store: (yield* fs.readDirectory(store)).toSorted(),
      worktrees: yield* gitOk(root, "worktree", "list", "--porcelain"),
    };
  });

// What git exports to a hook it runs, such as pre-commit under `git commit -a`.
const inHook = (root: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      vi.stubEnv("GIT_DIR", `${root}/.git`);
      vi.stubEnv("GIT_INDEX_FILE", `${root}/.git/index`);
      vi.stubEnv("GIT_CONFIG_PARAMETERS", "'core.bare'='false'");
    }),
    () => Effect.sync(() => vi.unstubAllEnvs())
  );

const ratchet = "no-explicit-any";

const countingLint = [
  "grep -rnow any packages | awk -F: '",
  '  BEGIN { printf "{\\"diagnostics\\":[" }',
  '  { printf "%s{\\"code\\":\\"typescript(no-explicit-any)\\",\\"filename\\":\\"%s\\"}", (NR > 1 ? "," : ""), $1 }',
  '  END { print "]}" }',
  "'",
  "exit 1",
  "",
].join("\n");

const declaringRatchet = (repo: CheckRepo, command: string) =>
  Effect.gen(function* () {
    const sdk = `${Brand.cliPackage}/rules`;

    yield* gitOk(repo.root, "checkout", "--quiet", "main");
    yield* gitOk(repo.root, "rm", "--quiet", policyFile);

    return yield* commit(
      repo.root,
      {
        [`${Brand.configDir}/asks/${ask}.ask.ts`]: [
          `import { kinds, territory } from "${sdk}";`,
          "",
          "export default kinds.fix.ask({",
          `  path: "${checkFile}",`,
          '  territory: territory.package("a"),',
          '  want: "a is two",',
          "});",
          "",
        ].join("\n"),
        [`${Brand.configDir}/project.ts`]: [
          `import { check, kinds, project } from "${sdk}";`,
          "",
          "export default project({",
          "  kinds: [kinds.fix],",
          "  ratchets: {",
          `    "${ratchet}": check.ratchet.count("${command}", { rule: "typescript/no-explicit-any" }),`,
          "  },",
          '  run: { checks: {}, test: "true {path}" },',
          "});",
          "",
        ].join("\n"),
        "lint.sh": countingLint,
        "packages/a/src/a.ts": "export const a = (x: any, y: any) => 1;\n",
      },
      "Count explicit anys"
    );
  });

const raisingInA = (repo: CheckRepo) =>
  Effect.gen(function* () {
    yield* gitOk(repo.root, "checkout", "--quiet", "-b", "raising", "main");

    return yield* commit(
      repo.root,
      {
        "packages/a/src/a.ts":
          "export const a = (x: any, y: any, z: any) => 2;\n",
      },
      "Make a two, loosely"
    );
  });

describe(`${Brand.cli} check`, () => {
  it.live(
    "prints the refusals the gateway would give the same head, in one envelope, and exits 65: the answer must change",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--shape-only",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        const expected = yield* gateSays(repo, repo.straying);

        expect(exitCodeOf(printed.exit)).toBe(65);
        expect(printed.err.join("\n")).toContain(`made up for ${handle}`);
        expect(yield* envelopeOf(printed.out)).toStrictEqual({
          command: "check",
          ok: false,
          refusals: expected.encoded,
          v: 1,
        });
        // The ask's check file judges its answers, so editing it is
        // TouchedJudge as well as the place its skip was added.
        expect(expected.refusals).toStrictEqual([
          new OutOfScope({ paths: [RepoPath.make("packages/b/src/b.ts")] }),
          new TouchedJudge({ paths: [RepoPath.make(checkFile)] }),
          new Weakened({
            at: { line: 4, path: RepoPath.make(checkFile) },
            weakening: { marker: ".skip(" },
          }),
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "runs the lanes named on a head the gate takes, and reports each lane",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* gitOk(repo.root, "checkout", "--quiet", "clean");

        const argv = (lane: string) => [
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--lane",
          lane,
          "--json",
        ];

        const passed = yield* run(argv("ok")).pipe(
          Effect.provide(services(unreachable))
        );

        expect(Exit.isSuccess(passed.exit)).toBeTruthy();
        expect(yield* envelopeOf(passed.out)).toMatchObject({
          command: "check",
          data: {
            ask,
            base: repo.main,
            head: repo.clean,
            lanes: [{ command: "true", lane: "ok", result: "passed" }],
            stage: "checks",
          },
          ok: true,
          v: 1,
        });

        const failed = yield* run(argv("bad")).pipe(
          Effect.provide(services(unreachable))
        );

        expect(Exit.isFailure(failed.exit)).toBeTruthy();
        expect(yield* decodedOf(failed.out)).toStrictEqual({
          command: "check",
          ok: false,
          refusals: [
            new ChecksFailed({
              lane: "bad",
              logRef: ChecksFailed.localRef("bad"),
              next: "false",
            }),
          ],
          v: 1,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "leaves the repo, its config and its refs as they were, even when a git hook runs it",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        // A setup that writes git config, as an install's `prepare` script
        // does: it belongs to the temp clone the lanes run in.
        yield* gitOk(repo.root, "checkout", "--quiet", "main");

        yield* commit(
          repo.root,
          {
            [policyFile]: (yield* policyText).replace(
              '"checks":',
              '"setup": "git config check.setup ran", "checks":'
            ),
          },
          "Set the lanes up"
        );

        yield* gitOk(repo.root, "checkout", "--quiet", "clean");

        const before = yield* stateOf(repo.root);

        const printed = yield* inHook(repo.root).pipe(
          Effect.andThen(
            run([
              "check",
              "--dir",
              repo.root,
              "--ask",
              ask,
              "--offline",
              "--lane",
              "ok",
              "--json",
            ])
          ),
          Effect.provide(services(unreachable)),
          Effect.scoped
        );

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(yield* stateOf(repo.root)).toStrictEqual(before);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "judges the claim the platform says the caller holds: none is NotClaimed",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* gitOk(repo.root, "checkout", "--quiet", "clean");

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--json",
        ]).pipe(Effect.provide(services(noClaims)));

        expect(Exit.isFailure(printed.exit)).toBeTruthy();
        expect(yield* decodedOf(printed.out)).toStrictEqual({
          command: "check",
          ok: false,
          refusals: [NotClaimed.of(AskId.make(ask))],
          v: 1,
        });
        expect(printed.err.join("\n")).not.toContain("made up");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "judges a lintToZero ask's lane by its count in the ask's territory, not by the lint's exit code, as the platform does",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;
        const sdk = `${Brand.cliPackage}/rules`;

        // One explicit `any` is left, in b: outside the ask's territory, so
        // the count in a is zero, while the lint exits 1 for it.
        const report = JSON.stringify({
          diagnostics: [
            {
              code: "typescript(no-explicit-any)",
              filename: "packages/b/src/b.ts",
            },
          ],
        });

        yield* gitOk(repo.root, "checkout", "--quiet", "main");
        yield* gitOk(repo.root, "rm", "--quiet", policyFile);

        yield* commit(
          repo.root,
          {
            [`${Brand.configDir}/asks/no-any-in-a.ask.ts`]: [
              `import { kinds, territory } from "${sdk}";`,
              "",
              "export default kinds.lintToZero.ask({",
              '  command: "sh lint.sh",',
              '  rule: "typescript/no-explicit-any",',
              '  territory: territory.package("a"),',
              '  want: "a types every value",',
              "});",
              "",
            ].join("\n"),
            [`${Brand.configDir}/project.ts`]: [
              `import { kinds, project } from "${sdk}";`,
              "",
              "export default project({",
              "  kinds: [kinds.lintToZero],",
              '  run: { checks: {}, test: "true {path}" },',
              "});",
              "",
            ].join("\n"),
            "lint.sh": `printf '%s\\n' '${report}'\nexit 1\n`,
          },
          "Ask for no explicit any in a"
        );

        yield* gitOk(repo.root, "checkout", "--quiet", "-b", "typed");
        yield* commit(
          repo.root,
          { "packages/a/src/a.ts": "export const a: number = 2;\n" },
          "Type a"
        );

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          "no-any-in-a",
          "--offline",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(yield* envelopeOf(printed.out)).toMatchObject({
          data: {
            lanes: [{ lane: "lintToZero", result: "passed" }],
            stage: "checks",
          },
          ok: true,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "diffs from the claim's base, as the gateway does, even when the answer is committed on main",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        const expected = yield* gateSays(repo, repo.straying);

        // A contributor who clones the project and commits the answer on
        // its main, as the zero-install flow does: main...HEAD is empty.
        yield* gitOk(repo.root, "checkout", "--quiet", "main");
        yield* gitOk(repo.root, "reset", "--quiet", "--hard", repo.straying);

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--shape-only",
          "--json",
        ]).pipe(Effect.provide(services(claimedAt(repo.main))));

        expect(Exit.isFailure(printed.exit)).toBeTruthy();
        expect(yield* envelopeOf(printed.out)).toStrictEqual({
          command: "check",
          ok: false,
          refusals: expected.encoded,
          v: 1,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "takes the ask from the claim fork's remote when none is named, and says so on stderr",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* gitOk(repo.root, "checkout", "--quiet", "clean");

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--offline",
          "--shape-only",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(yield* envelopeOf(printed.out)).toStrictEqual({
          command: "check",
          data: {
            ask,
            base: repo.main,
            head: repo.clean,
            lanes: [],
            stage: "shape",
          },
          ok: true,
          v: 1,
        });
        expect(printed.err.join("\n")).toContain(`Checking the ask ${ask}`);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "refuses an answer that raises a ratchet's count from 2 to 3 in the ask's territory, as Weakened, before the push",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* declaringRatchet(repo, "sh lint.sh");
        yield* raisingInA(repo);

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(Exit.isFailure(printed.exit)).toBeTruthy();
        expect(yield* decodedOf(printed.out)).toStrictEqual({
          command: "check",
          ok: false,
          refusals: [
            new Weakened({
              weakening: { after: 3, before: 2, ratchet, territory: "a" },
            }),
          ],
          v: 1,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "lets a raise a reasoned escape explains wait on a maintainer, as the platform does, and says so",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* declaringRatchet(repo, "sh lint.sh");
        yield* gitOk(repo.root, "checkout", "--quiet", "-b", "escaping");

        yield* commit(
          repo.root,
          {
            "packages/a/src/a.ts": [
              "// @ts-expect-error -- the codec boundary erases types",
              "export const a = (x: any, y: any, z: any) => 2;",
              "",
            ].join("\n"),
          },
          "Make a two, past a codec"
        );

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(yield* envelopeOf(printed.out)).toMatchObject({
          data: {
            ratchets: [
              { after: 3, before: 2, ratchet, territory: "a" },
              { after: 0, before: 0, ratchet, territory: "b" },
            ],
          },
          ok: true,
        });
        expect(printed.err.join("\n")).toContain(
          `The ratchet ${ratchet} in a: 2 on the base, 3 here: a reasoned escape you add there asks a maintainer to raise it`
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "passes an answer that keeps every ratchet's count, and reports the counts",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;
        const main = yield* declaringRatchet(repo, "sh lint.sh");

        yield* gitOk(repo.root, "checkout", "--quiet", "-b", "keeping");

        const head = yield* commit(
          repo.root,
          {
            "packages/a/src/a.ts": "export const a = (x: any, y: any) => 2;\n",
          },
          "Make a two"
        );

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(yield* envelopeOf(printed.out)).toMatchObject({
          data: {
            base: main,
            head,
            ratchets: [
              { after: 2, before: 2, ratchet, territory: "a" },
              { after: 0, before: 0, ratchet, territory: "b" },
            ],
            stage: "checks",
          },
          ok: true,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "says plainly that a ratchet it cannot count here is left to the platform, and does not fail on it",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* declaringRatchet(repo, "not-installed-here --format json");
        yield* raisingInA(repo);

        const printed = yield* run([
          "check",
          "--dir",
          repo.root,
          "--ask",
          ask,
          "--offline",
          "--json",
        ]).pipe(Effect.provide(services(unreachable)));

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(yield* envelopeOf(printed.out)).toMatchObject({
          data: { stage: "checks" },
          ok: true,
        });
        expect(printed.err.join("\n")).toContain(
          `Could not count the ratchet ${ratchet} here`
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
