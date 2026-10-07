import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import type { TokenScope } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { Brand } from "@repo/brand";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { Lander, Rebuild } from "@repo/project/lander";
import type { LandJob } from "@repo/project/lander";
import { LanderMemory } from "@repo/project/lander/memory";
import type { LanderScript } from "@repo/project/lander/memory";
import {
  BundleExit,
  BundleWire,
  ComposeExit,
  ComposeWire,
  LandExit,
  LandWire,
  MergeExit,
  MergeWire,
} from "@repo/project/lander/wire";
import type { LaneResult } from "@repo/protocol/domain/answer";
import {
  CommitSha,
  Handle,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import type { WorkerEntrypoint } from "cloudflare:workers";
import {
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Logger,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";

import { CheckRunnerSandbox } from "../src/adapters/check-runner-sandbox.ts";
import type { SandboxBinding } from "../src/adapters/check-runner-sandbox.ts";
import { LanderSandbox } from "../src/adapters/lander-sandbox.ts";

const project = ProjectName.make("datekit");

const canonical = RepoName.make("datekit");

const fork = RepoName.make("datekit--fix-parse--alice");

const base = CommitSha.make("2".repeat(40));

const head = CommitSha.make("3".repeat(40));

const main = LandedSha.make("4".repeat(40));

const tree = TreeSha.make("5".repeat(40));

const composed = CommitSha.make("6".repeat(40));

const landed = LandedSha.make("7".repeat(40));

const path = RepoPath.make("src/parse.ts");

const lane = LaneName.make("test");

const failed: LaneResult = {
  command: "bun test",
  durationMs: 1200,
  lane,
  result: "failed",
};

/** One lane on an answer's merged tree, cloned from the claim's fork. */
const checkJob: CheckJob = {
  at: CheckAt.cases.Tree.make({ tree }),
  lanes: [{ command: "bun test", lane }],
  placeholders: [],
  project,
  proxies: [],
  repo: fork,
};

const mergeJob = { base, fork, head, main, repo: canonical };

const landJob = (rebuild: Rebuild): LandJob => ({
  author: Handle.make("alice"),
  main,
  message: "Fix the parser\n\nRequest-Id: request-0001\n",
  rebuild,
  repo: canonical,
  requestId: RequestId.make("request-0001"),
  tree,
  verdict: Option.none(),
});

const landMerge = landJob(Rebuild.Merge({ base, fork, head }));

const composeJob = {
  files: [{ content: "export {};\n", path }] as const,
  main,
  repo: canonical,
};

const bundleJob = { at: main, repo: canonical };

const bundle = {
  entry: `${Brand.configDir}/project.ts`,
  modules: {},
  sdkVersion: "1.0.0",
};

const merged = { changes: [{ path, status: "modified" as const }], tree };

const stale = new StaleBase({ base, conflicts: [path], main });

/** What the memory Lander inside the fake sandbox answers, unless a test says otherwise. */
const landerScript: LanderScript = {
  bundle: [Result.succeed(bundle)],
  compose: [Result.succeed({ commit: composed, tree })],
  land: [Result.succeed({ pending: [], sha: landed })],
  merge: [Result.succeed(merged)],
};

/** One token a job minted, as the store gave it out. */
interface Minted {
  readonly repo: RepoName;
  readonly scope: TokenScope;
  readonly ttlMs: number;
  readonly id: string;
  readonly secret: string;
}

/**
 * The memory store with the canonical repo and a claim's fork, recording
 * every token it mints and every revoke it is asked for; with `failRevoke`,
 * every revoke dies after it is recorded, its error echoing the token's
 * secret.
 */
const recordingRepoHost = (failRevoke: boolean) =>
  Effect.gen(function* () {
    const store = yield* RepoHost;
    const minted: Minted[] = [];
    const revoked: { readonly repo: RepoName; readonly id: string }[] = [];

    yield* store.create(canonical);
    yield* store.create(fork);

    const host = RepoHost.of({
      ...store,
      mintToken: (repo, scope, ttl) =>
        store.mintToken(repo, scope, ttl).pipe(
          Effect.tap(({ id, secret }) =>
            Effect.sync(() =>
              minted.push({
                id,
                repo,
                scope,
                secret: Redacted.value(secret),
                ttlMs: Duration.toMillis(ttl),
              })
            )
          )
        ),
      revokeToken: (repo, id) =>
        Effect.sync(() => revoked.push({ id, repo })).pipe(
          Effect.andThen(
            failRevoke
              ? Effect.die(
                  new Error(
                    `cannot revoke ${minted.find((token) => token.id === id)?.secret}`
                  )
                )
              : store.revokeToken(repo, id)
          )
        ),
    });

    return { host, minted, revoked };
  }).pipe(Effect.provide(RepoHostMemory));

/** Every wire the fake sandbox decoded, by method. */
interface Seen {
  readonly bundleRules: (typeof BundleWire.Type)[];
  readonly check: (typeof CheckWire.Type)[];
  readonly compose: (typeof ComposeWire.Type)[];
  readonly land: (typeof LandWire.Type)[];
  readonly merge: (typeof MergeWire.Type)[];
}

/**
 * The sandbox Worker's entrypoint as the service binding reaches it, in
 * memory: each method decodes its wire with 301's schema, runs the memory
 * `CheckRunner` or `Lander` it was built over, and encodes the `Exit`. It
 * keeps every wire it decoded, by method.
 */
const fakeSandbox = Effect.gen(function* () {
  const run = yield* FiberSet.makeRuntimePromise<CheckRunner | Lander>();

  const seen: Seen = {
    bundleRules: [],
    check: [],
    compose: [],
    land: [],
    merge: [],
  };

  /** Decodes a wire into `into`, runs its job, and encodes the outcome. */
  const answer =
    <W, WI, A, E, X>(
      wire: Schema.Codec<W, WI>,
      exit: Schema.Codec<Exit.Exit<A, E>, X>,
      into: W[],
      job: (decoded: W) => Effect.Effect<A, E, CheckRunner | Lander>
    ) =>
    (encoded: WI): Promise<X> =>
      run(
        Schema.decodeEffect(wire)(encoded).pipe(
          Effect.orDie,
          Effect.tap((decoded) => Effect.sync(() => into.push(decoded))),
          Effect.flatMap(job),
          Effect.exit,
          Effect.flatMap((outcome) =>
            Effect.orDie(Schema.encodeEffect(exit)(outcome))
          )
        )
      );

  const sandbox: SandboxBinding = {
    bundleRules: answer(BundleWire, BundleExit, seen.bundleRules, ({ job }) =>
      Lander.use((lander) => lander.bundleRules(job))
    ),
    check: answer(CheckWire, CheckExit, seen.check, ({ job }) =>
      CheckRunner.use((runner) => runner.run(job))
    ),
    compose: answer(ComposeWire, ComposeExit, seen.compose, ({ job }) =>
      Lander.use((lander) => lander.compose(job))
    ),
    land: answer(LandWire, LandExit, seen.land, ({ job }) =>
      Lander.use((lander) => lander.land(job))
    ),
    merge: answer(MergeWire, MergeExit, seen.merge, ({ job }) =>
      Lander.use((lander) => lander.merge(job))
    ),
  };

  return { sandbox, seen };
});

interface WorldOptions {
  readonly script?: LanderScript;
  /** The binding the adapters get, made from the fake's. */
  readonly binding?: (sandbox: SandboxBinding) => SandboxBinding;
  readonly failRevoke?: boolean;
}

/**
 * Both adapters over a fake sandbox and a recording store, and what the
 * fake and the store saw.
 */
const world = (options: WorldOptions = {}) =>
  Effect.gen(function* () {
    const { host, minted, revoked } = yield* recordingRepoHost(
      options.failRevoke ?? false
    );

    const fake = yield* fakeSandbox.pipe(
      Effect.provide(
        Layer.mergeAll(
          CheckRunnerMemory.layer(
            new Map([[scriptKey(checkJob.at, lane), [failed]]])
          ),
          LanderMemory.layer(options.script ?? landerScript)
        )
      )
    );

    const binding = options.binding?.(fake.sandbox) ?? fake.sandbox;

    const { lander, runner } = yield* Effect.gen(function* () {
      return { lander: yield* Lander, runner: yield* CheckRunner };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          CheckRunnerSandbox(binding),
          LanderSandbox(binding)
        ).pipe(Layer.provide(Layer.succeed(RepoHost, host)))
      )
    );

    return { host, lander, minted, revoked, runner, seen: fake.seen };
  });

/** One log line, as the structured logger renders it. */
type Line = ReturnType<typeof Logger.formatStructured.log>;

/** Runs `body` with every log line it writes kept: its exit, and the lines. */
const withLogs = <A, E>(body: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: Line[] = [];

    const exit = yield* Effect.exit(body).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            lines.push(Logger.formatStructured.log(options));
          }),
        ])
      )
    );

    return { exit, lines };
  });

/** Which repo each token was minted on, with which scope. */
const mintsOf = (minted: readonly Minted[]) =>
  minted.map(({ repo, scope }) => ({ repo, scope }));

/** A wire remote, with its token in the clear for comparing. */
const opened = (remote: {
  readonly token: Redacted.Redacted;
  readonly url: string;
}) => ({
  token: Redacted.value(remote.token),
  url: remote.url,
});

type World = Effect.Success<ReturnType<typeof world>>;

/** Every operation of both adapters once, a land for each rebuild that reads a fork or not. */
const everyJob = ({
  lander,
  runner,
}: World): readonly Effect.Effect<
  object,
  RepoBusy | StaleBase | VerifierBlocked
>[] => [
  runner.run(checkJob),
  lander.merge(mergeJob),
  lander.land(landMerge),
  lander.land(landJob(Rebuild.Existing({ commit: composed }))),
  lander.compose(composeJob),
  lander.bundleRules(bundleJob),
];

/** By token id, so revokes in any order compare. */
const byId = <T extends { readonly id: string }>(tokens: readonly T[]) =>
  tokens.toSorted((a, b) => a.id.localeCompare(b.id));

/**
 * The sandbox Worker's default entrypoint, by its shape in
 * `apps/sandbox/src/worker.ts` (an app may not import another app).
 */
interface SandboxEntrypoint extends WorkerEntrypoint<Env> {
  readonly check: (
    wire: typeof CheckWire.Encoded
  ) => Promise<typeof CheckExit.Encoded>;
  readonly merge: (
    wire: typeof MergeWire.Encoded
  ) => Promise<typeof MergeExit.Encoded>;
  readonly land: (
    wire: typeof LandWire.Encoded
  ) => Promise<typeof LandExit.Encoded>;
  readonly compose: (
    wire: typeof ComposeWire.Encoded
  ) => Promise<typeof ComposeExit.Encoded>;
  readonly bundleRules: (
    wire: typeof BundleWire.Encoded
  ) => Promise<typeof BundleExit.Encoded>;
}

describe("the sandbox binding", () => {
  it("is the service binding's RPC stub as the runtime types it", () => {
    expectTypeOf<Service<SandboxEntrypoint>>().toExtend<SandboxBinding>();
  });
});

describe("the sandbox CheckRunner", () => {
  it.effect(
    "returns the Checker's run, cloned with a read token on the answer's repo",
    () =>
      Effect.gen(function* () {
        const { host, minted, runner, seen } = yield* world();

        expect(yield* Effect.exit(runner.run(checkJob))).toStrictEqual(
          Exit.succeed({
            durationMs: 1200,
            evidence: [{ lane, signature: "test: scripted failure" }],
            heldBack: [],
            lanes: [failed],
          })
        );
        expect(mintsOf(minted)).toStrictEqual([{ repo: fork, scope: "read" }]);
        expect(seen.check.map(({ clone }) => opened(clone))).toStrictEqual([
          { token: minted[0]?.secret, url: yield* host.remote(fork) },
        ]);
      })
  );
});

describe("the sandbox Lander", () => {
  it.effect(
    "merges with read tokens on canonical and the fork, and nothing more",
    () =>
      Effect.gen(function* () {
        const { host, lander, minted, seen } = yield* world();

        expect(yield* Effect.exit(lander.merge(mergeJob))).toStrictEqual(
          Exit.succeed(merged)
        );
        expect(mintsOf(minted)).toStrictEqual([
          { repo: canonical, scope: "read" },
          { repo: fork, scope: "read" },
        ]);
        expect(
          seen.merge.map((wire) => ({
            fork: opened(wire.fork),
            main: opened(wire.main),
          }))
        ).toStrictEqual([
          {
            fork: { token: minted[1]?.secret, url: yield* host.remote(fork) },
            main: {
              token: minted[0]?.secret,
              url: yield* host.remote(canonical),
            },
          },
        ]);
      })
  );

  it.effect(
    "lands a merge with one write token on canonical and a read token on the fork",
    () =>
      Effect.gen(function* () {
        const { host, lander, minted, seen } = yield* world();

        expect(yield* Effect.exit(lander.land(landMerge))).toStrictEqual(
          Exit.succeed({ pending: [], sha: landed })
        );
        expect(mintsOf(minted)).toStrictEqual([
          { repo: canonical, scope: "write" },
          { repo: fork, scope: "read" },
        ]);
        expect(
          seen.land.map((wire) => ({
            fork: Option.map(Option.fromUndefinedOr(wire.fork), opened),
            main: Redacted.value(wire.main.token),
          }))
        ).toStrictEqual([
          {
            fork: Option.some({
              token: minted[1]?.secret,
              url: yield* host.remote(fork),
            }),
            main: minted[0]?.secret,
          },
        ]);
      })
  );

  it.effect.each([
    Rebuild.Compose({ files: composeJob.files }),
    Rebuild.Existing({ commit: composed }),
  ])(
    "lands a $_tag rebuild with the write token on canonical alone",
    (rebuild) =>
      Effect.gen(function* () {
        const { lander, minted, seen } = yield* world();

        expect(yield* Effect.exit(lander.land(landJob(rebuild)))).toStrictEqual(
          Exit.succeed({ pending: [], sha: landed })
        );
        expect(mintsOf(minted)).toStrictEqual([
          { repo: canonical, scope: "write" },
        ]);
        expect(seen.land.map((wire) => wire.fork)).toStrictEqual([undefined]);
      })
  );

  it.effect(
    "composes with one write token on canonical, for its compose ref",
    () =>
      Effect.gen(function* () {
        const { lander, minted, seen } = yield* world();

        expect(yield* Effect.exit(lander.compose(composeJob))).toStrictEqual(
          Exit.succeed({ commit: composed, tree })
        );
        expect(mintsOf(minted)).toStrictEqual([
          { repo: canonical, scope: "write" },
        ]);
        expect(
          seen.compose.map((wire) => Redacted.value(wire.main.token))
        ).toStrictEqual([minted[0]?.secret]);
      })
  );

  it.effect("bundles the config folder with one read token on canonical", () =>
    Effect.gen(function* () {
      const { lander, minted, seen } = yield* world();

      expect(yield* Effect.exit(lander.bundleRules(bundleJob))).toStrictEqual(
        Exit.succeed(bundle)
      );
      expect(mintsOf(minted)).toStrictEqual([
        { repo: canonical, scope: "read" },
      ]);
      expect(
        seen.bundleRules.map((wire) => Redacted.value(wire.main.token))
      ).toStrictEqual([minted[0]?.secret]);
    })
  );

  it.effect("gives every token a lifetime of five minutes", () =>
    Effect.gen(function* () {
      const ok = yield* world();

      yield* Effect.forEach(everyJob(ok), (job) => Effect.exit(job));

      expect(ok.minted.map(({ ttlMs }) => ttlMs)).toStrictEqual(
        Array.from({ length: 8 }, () => 300_000)
      );
    })
  );
});

/** A way the sandbox's `merge` can fail to answer with an `Exit`, each echoing a token it was sent. */
interface Breakage {
  readonly name: string;
  readonly failure: string;
  readonly merge: SandboxBinding["merge"];
}

const breakages: readonly Breakage[] = [
  {
    failure: "rejected",
    merge: (wire) =>
      Promise.reject(
        new Error(`no fetch from ${wire.main.url}: ${wire.main.token}`)
      ),
    name: "rejects",
  },
  {
    failure: "rejected",
    merge: (wire) => {
      throw new Error(`no fork at ${wire.fork.token}`);
    },
    name: "throws",
  },
  {
    failure: "undecodable",
    merge: (wire) => Promise.resolve({ sha: wire.main.token }),
    name: "answers with something that is not an Exit",
  },
  {
    failure: "defect",
    merge: (wire) =>
      Promise.resolve(
        Schema.encodeSync(MergeExit)(
          Exit.die(new Error(`git said ${wire.main.token}`))
        )
      ),
    name: "dies on the far side",
  },
];

/** Every secret in `minted` that `text` contains. */
const leaked = (text: string, minted: readonly Minted[]) =>
  minted.flatMap(({ secret }) => (text.includes(secret) ? [secret] : []));

describe("a sandbox job that fails", () => {
  it.effect(
    "arrives as the typed StaleBase or RepoBusy the Lander refused with",
    () =>
      Effect.gen(function* () {
        const busy = new RepoBusy({});

        const { lander } = yield* world({
          script: { land: [Result.fail(busy)], merge: [Result.fail(stale)] },
        });

        expect(yield* Effect.exit(lander.merge(mergeJob))).toStrictEqual(
          Exit.fail(stale)
        );
        expect(yield* Effect.exit(lander.land(landMerge))).toStrictEqual(
          Exit.fail(busy)
        );
      })
  );

  it.effect.each(breakages)(
    "is VerifierBlocked, logged once by its method and with no token, when the sandbox $name",
    ({ failure, merge }) =>
      Effect.gen(function* () {
        const { lander, minted, revoked } = yield* world({
          binding: (sandbox) => ({ ...sandbox, merge }),
        });

        const { exit, lines } = yield* withLogs(lander.merge(mergeJob));

        expect(exit).toStrictEqual(Exit.fail(new VerifierBlocked({})));
        expect(
          lines
            .filter(({ level }) => level === "ERROR")
            .map(({ annotations }) => ({
              failure: annotations.failure,
              method: annotations.method,
            }))
        ).toStrictEqual([{ failure, method: "merge" }]);
        expect(leaked(JSON.stringify(lines), minted)).toStrictEqual([]);
        expect(revoked.map(({ id }) => id)).toStrictEqual(
          minted.map(({ id }) => id).toReversed()
        );
      })
  );

  it.effect(
    "is VerifierBlocked on a repo the store does not know, and revokes what it minted first",
    () =>
      Effect.gen(function* () {
        const { lander, minted, revoked } = yield* world();
        const gone = RepoName.make("datekit--gone--bob");

        const { exit, lines } = yield* withLogs(
          lander.merge({ ...mergeJob, fork: gone })
        );

        expect(exit).toStrictEqual(Exit.fail(new VerifierBlocked({})));
        expect(mintsOf(minted)).toStrictEqual([
          { repo: canonical, scope: "read" },
        ]);
        expect(revoked.map(({ id }) => id)).toStrictEqual(
          minted.map(({ id }) => id)
        );
        expect(
          lines.map(({ annotations, level }) => ({
            failure: annotations.failure,
            level,
            method: annotations.method,
            repo: annotations.repo,
          }))
        ).toStrictEqual([
          {
            failure: "repo not found",
            level: "ERROR",
            method: "merge",
            repo: gone,
          },
        ]);
      })
  );
});

describe("a sandbox job's tokens", () => {
  it.effect("are each revoked once their job has ended", () =>
    Effect.gen(function* () {
      const ok = yield* world();

      yield* Effect.forEach(everyJob(ok), (job) => Effect.exit(job));

      expect(ok.minted).toHaveLength(8);
      expect(byId(ok.revoked)).toStrictEqual(
        byId(ok.minted.map(({ id, repo }) => ({ id, repo })))
      );
    })
  );

  it.effect(
    "fail no job when they cannot be revoked, and are warned of by repo and id alone",
    () =>
      Effect.gen(function* () {
        const { lander, minted, revoked } = yield* world({ failRevoke: true });

        const { exit, lines } = yield* withLogs(lander.land(landMerge));

        expect(exit).toStrictEqual(Exit.succeed({ pending: [], sha: landed }));
        expect(revoked.map(({ id }) => id)).toStrictEqual(
          minted.map(({ id }) => id).toReversed()
        );
        expect(
          lines.map(({ annotations, level }) => ({
            level,
            method: annotations.method,
            repo: annotations.repo,
            tokenId: annotations.tokenId,
          }))
        ).toStrictEqual(
          minted.toReversed().map(({ id, repo }) => ({
            level: "WARN",
            method: "land",
            repo,
            tokenId: id,
          }))
        );
        expect(leaked(JSON.stringify(lines), minted)).toStrictEqual([]);
      })
  );

  it.effect("appear in no result, refusal or log line", () =>
    Effect.gen(function* () {
      const ok = yield* world();

      const refusing = yield* world({
        script: {
          ...landerScript,
          land: [Result.fail(new RepoBusy({}))],
          merge: [Result.fail(stale)],
        },
      });

      const broken = yield* Effect.forEach(breakages, ({ merge }) =>
        world({ binding: (sandbox) => ({ ...sandbox, merge }) })
      );

      const { exit, lines } = yield* withLogs(
        Effect.forEach(
          [
            ...everyJob(ok),
            ...everyJob(refusing),
            ...broken.map(({ lander }) => lander.merge(mergeJob)),
          ],
          (job) => Effect.exit(job)
        )
      );

      const minted = [ok, refusing, ...broken].flatMap((each) => each.minted);

      expect(minted).toHaveLength(24);
      expect(leaked(JSON.stringify(exit), minted)).toStrictEqual([]);
      expect(leaked(JSON.stringify(lines), minted)).toStrictEqual([]);
    })
  );
});
