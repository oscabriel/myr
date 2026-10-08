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
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
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

/** A platform that says the caller holds no claims anywhere, and answers nothing else. */
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

/**
 * A platform that says the caller holds a live claim on the ask, made when
 * main stood at `base`, and answers nothing else.
 */
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
                fork: `${project}--${ask}--${handle}`,
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

/** A platform no offline run may call. */
const unreachable = Layer.mock(Client)({});

/** What `check` runs with: a test console, plain output, real processes. */
const services = (client: Layer.Layer<Client>) =>
  Layer.mergeAll(
    TestConsole.layer,
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    client,
    OutputPlain,
    SignedOut
  ).pipe(Layer.provideMerge(NodeServices.layer));

/** Runs the CLI on `argv`: how it ended, and what it printed where. */
const run = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program(argv));

    return {
      err: (yield* TestConsole.errorLines).map(String),
      exit,
      out: (yield* TestConsole.logLines).map(String),
    };
  });

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

/** The one document `--json` printed on stdout. */
const envelopeOf = (out: readonly string[]) =>
  Effect.gen(function* () {
    expect(out).toHaveLength(1);

    return yield* decodeJson(out[0] ?? "");
  });

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

/** The one document `--json` printed on stdout, read as the envelope it is. */
const decodedOf = (out: readonly string[]) =>
  Effect.gen(function* () {
    expect(out).toHaveLength(1);

    return yield* decodeEnvelope(out[0] ?? "");
  });

const encodeRefusals = Schema.encodeEffect(Schema.Array(Refusal));

/** A `Fetch` for a host that reaches nothing over the network. */
const offline = Layer.succeed(Fetch)({
  fetch: (request) =>
    Effect.fail(new FetchFailed({ reason: "offline", url: request.url })),
});

/**
 * What the gate says of `head` in `repo`, from facts this test builds on
 * its own: a bare copy of the repo opened through `RepoHost` `/local`, the
 * change list and added lines from `@repo/git`, against the merge base of
 * `main` and `head`; the policy at `main`; and a live claim on the ask by
 * the fork's claimant.
 */
const gateSays = (repo: CheckRepo, head: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hosted = yield* fs.makeTempDirectoryScoped();
    const name = RepoName.make(project);

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
        fork: RepoName.make(`${project}--${ask}--${handle}`),
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

/**
 * What `check` must leave as it found it: where HEAD points, every ref, the
 * repo's config and index, its worktrees, and the files in its git folder.
 */
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

/**
 * What git exports to a hook that runs the CLI, such as a pre-commit hook
 * under `git commit -a`: its own repo and index, and the config given with
 * `git -c`. Restored when the scope closes.
 */
const inHook = (root: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      vi.stubEnv("GIT_DIR", `${root}/.git`);
      vi.stubEnv("GIT_INDEX_FILE", `${root}/.git/index`);
      vi.stubEnv("GIT_CONFIG_PARAMETERS", "'core.bare'='false'");
    }),
    () => Effect.sync(() => vi.unstubAllEnvs())
  );

describe(`${Brand.cli} check`, () => {
  it.live(
    "prints the refusals the gateway would give the same head, in one envelope, and exits 1",
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

        expect(Exit.isFailure(printed.exit)).toBeTruthy();
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
              logRef: "local:bad",
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
    "diffs from the claim's base, as the gateway does, even when the answer is committed on main",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        // What the gateway says of the answer pushed onto the claim's base.
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
});
