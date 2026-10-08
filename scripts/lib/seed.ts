/**
 * The seed's core (issue 509): what to put on a platform for one example
 * project, read from the example's tracked files, and putting it there.
 *
 * A plan (`planSeed`) is the library as it was before anyone asked (every
 * tracked file but the asks and the checks they name), the decider its
 * config names for the whole tree, and each ask with the files it opens
 * with. Only what git tracks ships, so an ignored file, and above all a
 * closed env file, never leaves the machine.
 *
 * A run (`runSeed`) makes the project and pushes main's first commit as the
 * platform's operator (spec D20: the initializer decides until the config
 * names deciders), through the gateway's first-push admission (D1), then
 * opens each ask as the decider, so each is red first on the platform's own
 * Checker (spec §5 steps 1–3). A step already done is reported `already`
 * and left alone, so a second run changes nothing.
 *
 * A platform is a `SeedTarget`: a stage (`stageTarget`) or the Node world
 * served by a process of its own (`worldTarget`), each reached over HTTP
 * and git the same way (`platformTarget`). Tokens live in `Redacted`
 * values and reach git only through its child's env: the seed never prints,
 * logs or writes one.
 */
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { AskListing } from "@repo/protocol/domain/ask";
import {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  RepoPath,
  sameHandle,
} from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array,
  Config,
  Context,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Ref,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { repoRoot } from "../../infra/stages.ts";

/**
 * The seed could not go on; `reason` says why and what to do. When the
 * platform refused a step, `refusals` holds what it said.
 */
export class SeedFailed extends Schema.TaggedError<SeedFailed>()("SeedFailed", {
  reason: Schema.String,
  refusals: Schema.optionalKey(Schema.NonEmptyArray(Refusal)),
}) {
  override get message() {
    return this.reason;
  }
}

/** One file of a seeded tree, as its bytes. */
export interface SeedFile {
  readonly path: RepoPath;
  readonly content: Uint8Array;
}

/** One file an ask opens with, as text (the `openAsk` contract's `ConfigFile`). */
export interface AskFile {
  readonly path: RepoPath;
  readonly content: string;
}

/** One ask the seed opens: its id, its kind's name, and the files it opens with. */
export interface AskStep {
  readonly id: AskId;
  readonly kind: string;
  /** The ask's file, then the check file it names, if it names one. */
  readonly files: Array.NonEmptyReadonlyArray<AskFile>;
}

/** What the seed puts on a platform for one example project. */
export interface SeedPlan {
  readonly project: ProjectName;
  /** Who opens the asks: the first decider the config names for the whole tree. */
  readonly decider: Handle;
  /** main's first commit: the library before anyone asked. */
  readonly initFiles: Array.NonEmptyReadonlyArray<SeedFile>;
  readonly asks: readonly AskStep[];
  /** The ratchets the config declares, in place once main has landed. */
  readonly ratchets: readonly string[];
}

/** Where the asks live in an example: the config folder's `asks/`. */
const ASKS = `${Brand.configDir}/asks/`;

/** The config file that names the deciders and the ratchets. */
const PROJECT_FILE = `${Brand.configDir}/project.ts`;

/** An ask's file: `asks/<id>.ask.ts`, directly in the asks folder. */
const ASK_FILE = /^(?<id>[^/]+)\.ask\.ts$/u;

/**
 * The files whose values stay on each machine (AGENTS.md "Env"). The seed
 * refuses an example that tracks one rather than read it.
 */
const CLOSED_ENV = /^\.env(?:\.local|\.[^/]+\.local)?$/u;

// An ask file calls its kind's builder: `kinds.fix.ask({ … })`.
const KIND = /\bkinds\.(?<kind>\w+)\.ask\(/u;

// An ask file names its check file as the `path` its kind takes
// (`kinds.fix.ask({ path: "test/asks/<id>.test.ts", … })`), which the kind
// makes the ask's `RedThenGreen.path`. A kind that counts (`migrate`) names
// none.
const CHECK_PATH = /\bpath:\s*"(?<path>[^"]+)"/u;

// The deciders for the whole tree: `deciders: { "**": ["ines-v", …] }`.
const WHOLE_TREE_DECIDER = /"\*\*"\s*:\s*\[\s*"(?<handle>[^"]+)"/u;

// Each ratchet the config declares: `"<name>": check.ratchet.count(…)`.
const RATCHET = /"(?<name>[^"]+)"\s*:\s*check\.ratchet\./gu;

const failed = (reason: string) => new SeedFailed({ reason });

/** `raw` decoded by `schema`, or the seed fails saying what it was. */
const decoded =
  <S extends Schema.Codec<unknown, string>>(schema: S, what: string) =>
  (raw: string) =>
    Schema.decodeEffect(schema)(raw).pipe(
      Effect.mapError(() => failed(`${what} ${JSON.stringify(raw)} is not one`))
    );

/** The paths git tracks under `dir`, relative to it, in git's order. */
const trackedIn = (root: string, dir: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const listed = yield* spawner
      .string(
        ChildProcess.make("git", ["ls-files", "-z", "--", dir], { cwd: root })
      )
      .pipe(
        Effect.mapError((error) =>
          failed(`git ls-files ${dir} failed: ${error.message}`)
        )
      );

    return listed
      .split("\0")
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1));
  });

/** One file of the example as text, or the seed fails naming it. */
const textOf = (fs: FileSystem.FileSystem, at: string, path: string) =>
  fs
    .readFileString(at)
    .pipe(Effect.mapError(() => failed(`can't read ${path}`)));

/**
 * The plan for the example at `dir` (relative to the repo root, as
 * `examples/datekit`): the project is named for its folder.
 */
export const planSeed = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const folder = dir.replace(/^\.\//u, "").replace(/\/+$/u, "");
    const tracked = yield* trackedIn(root, folder);
    const at = (file: string) => path.join(root, folder, file);

    const closed = tracked.filter((file) =>
      CLOSED_ENV.test(path.basename(file))
    );

    if (Array.isReadonlyArrayNonEmpty(closed)) {
      return yield* failed(
        `${folder} tracks ${closed.join(", ")}: the seed never reads a closed env file; untrack it first`
      );
    }

    const project = yield* decoded(
      ProjectName,
      "the folder name"
    )(path.basename(folder));

    const config = yield* textOf(fs, at(PROJECT_FILE), PROJECT_FILE);

    const decider = yield* Effect.fromOption(
      Option.fromNullishOr(WHOLE_TREE_DECIDER.exec(config)?.groups?.handle)
    ).pipe(
      Effect.mapError(() =>
        failed(`${folder}/${PROJECT_FILE} names no decider for "**"`)
      ),
      Effect.flatMap(decoded(Handle, "the decider"))
    );

    const ratchets = [...config.matchAll(RATCHET)].flatMap(
      ({ groups }) => groups?.name ?? []
    );

    const askFiles = tracked.filter(
      (file) => file.startsWith(ASKS) && ASK_FILE.test(file.slice(ASKS.length))
    );

    const asks = yield* Effect.forEach(askFiles, (file) =>
      Effect.gen(function* () {
        const id = yield* decoded(
          AskId,
          "the ask id"
        )(file.slice(ASKS.length).replace(/\.ask\.ts$/u, ""));

        const text = yield* textOf(fs, at(file), file);

        const kind = yield* Effect.fromOption(
          Option.fromNullishOr(KIND.exec(text)?.groups?.kind)
        ).pipe(
          Effect.mapError(() =>
            failed(`${folder}/${file} calls no kinds.<kind>.ask(…)`)
          )
        );

        const check = Option.fromNullishOr(CHECK_PATH.exec(text)?.groups?.path);

        if (Option.isSome(check) && !tracked.includes(check.value)) {
          return yield* failed(
            `${folder}/${file} names the check ${check.value}, which git doesn't track`
          );
        }

        const checkFiles = yield* Effect.forEach(
          Option.toArray(check),
          (checkPath) =>
            Effect.map(textOf(fs, at(checkPath), checkPath), (content) => ({
              content,
              path: RepoPath.make(checkPath),
            }))
        );

        return {
          files: Array.prepend(checkFiles, {
            content: text,
            path: RepoPath.make(file),
          }),
          id,
          kind,
        } satisfies AskStep;
      })
    );

    const held = new Set(
      asks.flatMap(({ files }) => files.map((file) => String(file.path)))
    );

    const initPaths = tracked.filter(
      (file) => !file.startsWith(ASKS) && !held.has(file)
    );

    const initFiles = yield* Effect.forEach(initPaths, (file) =>
      fs.readFile(at(file)).pipe(
        Effect.map((content) => ({ content, path: RepoPath.make(file) })),
        Effect.mapError(() => failed(`can't read ${folder}/${file}`))
      )
    );

    if (!Array.isReadonlyArrayNonEmpty(initFiles)) {
      return yield* failed(`git tracks nothing under ${folder} to seed`);
    }

    return {
      asks,
      decider,
      initFiles,
      project,
      ratchets,
    } satisfies SeedPlan;
  });

/** Whether a run did a step, or found it done before. */
export const StepResult = Schema.Literals(["done", "already"]);

export type StepResult = typeof StepResult.Type;

const step = { result: StepResult, target: Schema.String };

/**
 * One step of a seed: making the project (`Init`), pushing main's first
 * commit (`Push`), opening an ask (`OpenAsk`).
 */
export const SeedStep = Schema.TaggedUnion({
  Init: step,
  OpenAsk: step,
  Push: step,
});

export type SeedStep = typeof SeedStep.Type;

/** What a platform gives the seed: a world, or a stage. */
export class SeedTarget extends Context.Service<
  SeedTarget,
  {
    /** Who makes each project and pushes its first commit. */
    readonly operator: Handle;
    /** The contracts as `handle` calls them; fails when the platform has no session for them. */
    readonly clientFor: (handle: Handle) => Layer.Layer<Client, SeedFailed>;
    /** Fails naming each of `handles` the platform has no session for. */
    readonly requireSessions: (
      handles: readonly Handle[]
    ) => Effect.Effect<void, SeedFailed>;
    /** Every ref of a project's canonical repo, by name, as git lists them. */
    readonly refsOf: (
      project: ProjectName
    ) => Effect.Effect<ReadonlyMap<string, CommitSha>, SeedFailed>;
    /**
     * A fresh repo holding `files` in one commit, pushed as `as` to the
     * project's main at the gateway, which admits only its initializer's
     * first push; gives the commit.
     */
    readonly pushInitial: (
      project: ProjectName,
      files: SeedPlan["initFiles"],
      as: Handle
    ) => Effect.Effect<CommitSha, SeedFailed>;
  }
>()("seed/SeedTarget") {}

const isRefusal = Schema.is(Refusal);

/** What a call to the platform fails with: a refusal, or the transport's own error. */
interface CallFailure {
  readonly _tag: string;
  readonly message: string;
}

/**
 * A call that failed: a refusal, said as `explain` says it everywhere, or
 * a platform that didn't answer.
 */
const failedCall = (call: string) => (error: CallFailure) =>
  isRefusal(error)
    ? new SeedFailed({
        reason: `${call} was refused: ${explain([error])
          .map((line) => line.trim())
          .join("; ")}`,
        refusals: [error],
      })
    : failed(`${call} got no answer from the platform: ${error.message}`);

/** main, as git names it. */
export const MAIN_REF = "refs/heads/main";

/**
 * Whether the platform has a session for the operator and for every plan's
 * decider: fails naming everyone it has none for, so a seed never stops
 * half-way for want of one.
 */
export const ready = (
  plans: readonly SeedPlan[]
): Effect.Effect<void, SeedFailed, SeedTarget> =>
  Effect.flatMap(Effect.service(SeedTarget), (target) =>
    target.requireSessions([
      target.operator,
      ...plans.map(({ decider }) => decider),
    ])
  );

/** What a platform holds for one seeded project. */
export interface SeededProject {
  readonly project: ProjectName;
  /** Its asks that are not closed, as anyone lists them. */
  readonly asks: readonly AskListing[];
  /** Every ref of its canonical repo, by name, sorted: main, the landed mirror, notes, the commits checks ran on. */
  readonly refs: readonly (readonly [string, CommitSha])[];
}

/** What the platform holds now for each project of `plans`, read as each one's decider. */
export const seeded = (
  plans: readonly SeedPlan[]
): Effect.Effect<readonly SeededProject[], SeedFailed, SeedTarget> =>
  Effect.flatMap(Effect.service(SeedTarget), (target) =>
    Effect.forEach(plans, ({ decider, project }) =>
      Effect.gen(function* () {
        const { asks } = yield* Client.use((client) =>
          client.listAsks({ project })
        ).pipe(
          Effect.provide(target.clientFor(decider)),
          Effect.mapError(failedCall(`listAsks ${project}`))
        );

        const refs = yield* target.refsOf(project);

        return {
          asks,
          project,
          refs: [...refs].toSorted(([one], [other]) =>
            one.localeCompare(other)
          ),
        };
      })
    )
  );

/**
 * Seeds one project: makes it and pushes main's first commit as the
 * operator, then opens each ask as the decider. Both sessions are checked
 * before the first step, so a missing one stops the seed before it starts.
 */
export const runSeed = (
  plan: SeedPlan
): Effect.Effect<readonly SeedStep[], SeedFailed, SeedTarget> =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = yield* SeedTarget;
      const { decider, project } = plan;

      yield* ready([plan]);

      const operator = Context.get(
        yield* Layer.build(target.clientFor(target.operator)),
        Client
      );

      const asker = Context.get(
        yield* Layer.build(target.clientFor(decider)),
        Client
      );

      const init = yield* operator.initProject({ project }).pipe(
        Effect.as<StepResult>("done"),
        Effect.catchTag("ProjectExists", () =>
          Effect.succeed<StepResult>("already")
        ),
        Effect.mapError(failedCall(`initProject ${project}`))
      );

      const landed = (yield* target.refsOf(project)).has(MAIN_REF);

      const push = landed
        ? "already"
        : yield* target
            .pushInitial(project, plan.initFiles, target.operator)
            .pipe(Effect.as<StepResult>("done"));

      const asks = yield* Effect.forEach(plan.asks, ({ files, id }) =>
        asker.showAsk({ ask: id, project }).pipe(
          Effect.as<StepResult>("already"),
          Effect.catchTag("UnknownAsk", () =>
            Effect.as(
              asker.openAsk({ ask: id, files, project }),
              "done" as const
            )
          ),
          Effect.mapError(failedCall(`openAsk ${project}/${id} as ${decider}`)),
          Effect.map((result) =>
            SeedStep.cases.OpenAsk.make({ result, target: `${project}/${id}` })
          )
        )
      );

      return [
        SeedStep.cases.Init.make({ result: init, target: project }),
        SeedStep.cases.Push.make({ result: push, target: project }),
        ...asks,
      ];
    })
  );

// ------------------------------------------------------------ the platform

/** A platform the seed reaches over HTTP and git. */
export interface Platform {
  /** Where it serves `/rpc` and git: `https://platform-dev-….workers.dev`. */
  readonly origin: string;
  /** Who makes each project and pushes its first commit. */
  readonly operator: Handle;
  /** Each person's token, by handle. Never printed. */
  readonly tokens: ReadonlyMap<Handle, Redacted.Redacted>;
  /** Where a missing person's token goes, for the message that names them. */
  readonly sessionsFrom: string;
}

/** The env var that hands git a token: in git's own env, never in its argv. */
const TOKEN_VAR = "SEED_GIT_TOKEN";

/** git's credential helper for one person: their handle, and the token from git's env. */
const helperFor = (handle: Handle) =>
  `!f() { test "$1" = get || exit 0; echo username=${handle}; echo "password=$${TOKEN_VAR}"; }; f`;

/**
 * Fixed dates, so a seed of the same files makes the same commit; no git
 * config from this machine (no hooks, no signing); English messages.
 */
const gitEnv = (handle: Handle, token: Redacted.Redacted) => ({
  GIT_AUTHOR_DATE: "2026-10-06T12:00:00Z",
  GIT_AUTHOR_EMAIL: `${handle}@example.com`,
  GIT_AUTHOR_NAME: handle,
  GIT_COMMITTER_DATE: "2026-10-06T12:00:00Z",
  GIT_COMMITTER_EMAIL: `${handle}@example.com`,
  GIT_COMMITTER_NAME: handle,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  [TOKEN_VAR]: Redacted.value(token),
});

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** The contracts over HTTP at `origin`'s `/rpc`, with `token` as the bearer. */
const clientAt = (
  origin: string,
  token: Redacted.Redacted
): Layer.Layer<Client> =>
  Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({
        transformClient: HttpClient.mapRequest(
          HttpClientRequest.bearerToken(token)
        ),
        url: `${origin}/rpc`,
      })
    ),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
  );

/**
 * The seed's target over a platform at an origin: the contracts over
 * `/rpc` and git through the gateway, each as a person with their token.
 */
export const platformTarget = (
  platform: Platform
): Layer.Layer<
  SeedTarget,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(SeedTarget)(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { origin } = platform;
      const remoteOf = (project: ProjectName) => `${origin}/${project}.git`;

      const tokenOf = (handle: Handle) =>
        Option.fromNullishOr(
          [...platform.tokens].find(([known]) => sameHandle(known, handle))?.[1]
        );

      const missing = (handles: Array.NonEmptyReadonlyArray<Handle>) =>
        failed(
          `the platform at ${origin} has no session for ${handles.join(", ")}: add ${handles.length === 1 ? "one" : "each"} to ${platform.sessionsFrom}, then run the seed again`
        );

      const requireSessions = (handles: readonly Handle[]) => {
        const lacking = Array.dedupeWith(
          handles.filter((handle) => Option.isNone(tokenOf(handle))),
          sameHandle
        );

        return Array.isReadonlyArrayNonEmpty(lacking)
          ? Effect.fail(missing(lacking))
          : Effect.void;
      };

      /** git as `as`, in `cwd`: how it ended, and what it printed. */
      const gitAs = (as: Handle, cwd: string, args: readonly string[]) =>
        Effect.gen(function* () {
          const token = yield* Effect.fromOption(tokenOf(as)).pipe(
            Effect.mapError(() => missing([as]))
          );

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const child = yield* spawner.spawn(
                ChildProcess.make(
                  "git",
                  [
                    "-c",
                    "credential.helper=",
                    "-c",
                    `credential.helper=${helperFor(as)}`,
                    ...args,
                  ],
                  { cwd, env: gitEnv(as, token), extendEnv: true }
                )
              );

              const [stdout, stderr, code] = yield* Effect.all(
                [text(child.stdout), text(child.stderr), child.exitCode],
                { concurrency: "unbounded" }
              );

              return { code: Number(code), stderr, stdout };
            })
          ).pipe(
            Effect.mapError((error) =>
              failed(`git ${args[0] ?? ""} didn't run: ${error.message}`)
            )
          );
        });

      /** git as `as` that must succeed; its output. */
      const gitOk = (as: Handle, cwd: string, args: readonly string[]) =>
        Effect.flatMap(gitAs(as, cwd, args), ({ code, stderr, stdout }) =>
          code === 0
            ? Effect.succeed(stdout)
            : Effect.fail(
                failed(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`)
              )
        );

      // An empty folder of the seed's own, removed with the scope: git run
      // there reads no repo's config, as `gitEnv` keeps the machine's out.
      const scratch = fs
        .makeTempDirectoryScoped({ prefix: "seed-" })
        .pipe(Effect.mapError(() => failed("can't make a temporary folder")));

      // `git ls-remote` lists one ref a line: `<sha>\t<ref>`.
      const refsOf = (project: ProjectName) =>
        Effect.scoped(
          Effect.gen(function* () {
            const listed = yield* gitOk(platform.operator, yield* scratch, [
              "ls-remote",
              remoteOf(project),
            ]);

            const refs = yield* Effect.forEach(
              listed.split("\n").filter((line) => line.length > 0),
              (line) => {
                const [sha = "", ref = ""] = line.split("\t");

                return ref.length === 0
                  ? Effect.fail(
                      failed(`git ls-remote listed ${JSON.stringify(line)}`)
                    )
                  : Effect.map(
                      decoded(
                        CommitSha,
                        `the commit ls-remote lists for ${ref}`
                      )(sha),
                      (commit) => [ref, commit] as const
                    );
              }
            );

            return new Map(refs);
          })
        );

      const pushInitial = (
        project: ProjectName,
        files: SeedPlan["initFiles"],
        as: Handle
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* scratch;

            yield* Effect.forEach(
              files,
              ({ content, path: file }) =>
                Effect.gen(function* () {
                  const at = path.join(dir, file);

                  yield* fs.makeDirectory(path.dirname(at), {
                    recursive: true,
                  });

                  yield* fs.writeFile(at, content);
                }).pipe(
                  Effect.mapError(() => failed(`can't write ${file} to seed`))
                ),
              { discard: true }
            );

            yield* gitOk(as, dir, ["init", "--quiet", "--initial-branch=main"]);
            yield* gitOk(as, dir, ["add", "--all"]);

            yield* gitOk(as, dir, [
              "commit",
              "--quiet",
              "--message",
              `Start ${project}`,
            ]);

            yield* gitOk(as, dir, [
              "push",
              "--quiet",
              remoteOf(project),
              `HEAD:${MAIN_REF}`,
            ]);

            return yield* decoded(
              CommitSha,
              "the commit git made"
            )((yield* gitOk(as, dir, ["rev-parse", "HEAD"])).trim());
          })
        );

      return SeedTarget.of({
        clientFor: (handle) =>
          Option.match(tokenOf(handle), {
            onNone: () => Layer.effect(Client)(Effect.fail(missing([handle]))),
            onSome: (token) => clientAt(origin, token),
          }),
        operator: platform.operator,
        pushInitial,
        refsOf,
        requireSessions,
      });
    })
  );

// --------------------------------------------------------------- the world

/** The file that serves the Node world as a process, from the repo root. */
const SERVE_WORLD = "apps/platform/test/serve-world.ts";

/** How long the world has to start serving. */
const WORLD_START = Duration.seconds(60);

/** The line the world prints once it serves. */
const decodeServing = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ origin: Schema.String }))
);

/** The world's operator: a session of the world's own. */
export const worldOperator = Handle.make("operator");

/** A token for `handle` in a world on this machine: no secret, never leaves it. */
const worldToken = (handle: Handle) =>
  Redacted.make(`${handle.toLowerCase()}-seed-world-token-0123456789abcdef`);

/**
 * The Node world (`apps/platform/test/world.ts`) served by a process of its
 * own for as long as the scope lasts, with a session for each person in
 * `sessions`; gives where it serves.
 */
const servedWorld = (sessions: ReadonlyMap<Handle, Redacted.Redacted>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* repoRoot;

    const child = yield* spawner
      .spawn(
        ChildProcess.make("bun", [SERVE_WORLD], {
          cwd: root,
          env: {
            WORLD_SESSIONS: JSON.stringify(
              Object.fromEntries(
                [...sessions].map(([handle, token]) => [
                  Redacted.value(token),
                  handle,
                ])
              )
            ),
          },
          extendEnv: true,
        })
      )
      .pipe(
        Effect.mapError((error) =>
          failed(`bun ${SERVE_WORLD} didn't start: ${error.message}`)
        )
      );

    // Both streams are read to their end, so the world never blocks on a
    // full pipe; the last of what it said on stderr is kept for a failure.
    const said = yield* Ref.make("");
    const serving = yield* Deferred.make<string>();

    yield* Stream.decodeText(child.stderr).pipe(
      Stream.runForEach((chunk) =>
        Ref.update(said, (before) => `${before}${chunk}`.slice(-4000))
      ),
      Effect.ignore,
      Effect.forkScoped
    );

    yield* Stream.splitLines(Stream.decodeText(child.stdout)).pipe(
      Stream.runForEach((line) =>
        Option.match(decodeServing(line), {
          onNone: () => Effect.void,
          onSome: ({ origin }) => Deferred.succeed(serving, origin),
        })
      ),
      Effect.ignore,
      Effect.forkScoped
    );

    const ended = child.exitCode.pipe(
      Effect.ignore,
      Effect.andThen(Ref.get(said)),
      Effect.flatMap((stderr) =>
        Effect.fail(failed(`the world ended before it served: ${stderr}`))
      )
    );

    return yield* Effect.raceFirst(Deferred.await(serving), ended).pipe(
      Effect.timeoutOption(WORLD_START),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              failed(
                `the world didn't serve within ${Duration.format(WORLD_START)}`
              )
            ),
          onSome: Effect.succeed,
        })
      )
    );
  });

/**
 * The seed's target over the Node world, served for as long as the layer
 * lasts, where the operator and each of `people` have a session.
 */
export const worldTarget = (
  people: readonly Handle[]
): Layer.Layer<
  SeedTarget,
  SeedFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const tokens = new Map(
        [worldOperator, ...people].map((handle) => [handle, worldToken(handle)])
      );

      const origin = yield* servedWorld(tokens);

      return platformTarget({
        operator: worldOperator,
        origin,
        sessionsFrom: "the world's sessions (worldTarget's people)",
        tokens,
      });
    })
  );

// --------------------------------------------------------------- a stage

/** Where a stage's tokens come from: the env vars that hold them. */
export interface StageTokens {
  /** A JSON object from token to handle, as the platform's `SESSION_TOKENS` is. */
  readonly sessions: string;
  /** The operator's token, as the platform's `OPERATOR_TOKEN` is. */
  readonly operator: string;
}

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Handle))
);

/**
 * The seed's target over a deployed stage at `origin`. Every token comes
 * from the env (`bunx varlock run --path apps/platform/ -- …`), and none is
 * ever printed, not even in a failure: the operator's from `tokens.operator`,
 * everyone else's from `tokens.sessions`. The operator's handle is whoever
 * the platform says their token names (`status`).
 */
export const stageTarget = (
  origin: string,
  tokens: StageTokens
): Layer.Layer<
  SeedTarget,
  SeedFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const operatorToken = yield* Config.Redacted(tokens.operator).pipe(
        Effect.mapError(() =>
          failed(
            `no ${tokens.operator} in the environment: run the seed under \`bunx varlock run --path apps/platform/ --\``
          )
        )
      );

      const listed = yield* Config.option(Config.String(tokens.sessions)).pipe(
        Effect.mapError(() => failed(`${tokens.sessions} can't be read`))
      );

      const sessions = yield* decodeSessions(
        Option.getOrElse(listed, () => "{}")
      ).pipe(
        Effect.mapError(() =>
          failed(`${tokens.sessions} is not a JSON object from token to handle`)
        )
      );

      const { handle } = yield* Client.use((client) => client.status({})).pipe(
        Effect.provide(clientAt(origin, operatorToken)),
        Effect.mapError(
          failedCall(`status as the operator (${tokens.operator})`)
        )
      );

      return platformTarget({
        operator: handle,
        origin,
        sessionsFrom: tokens.sessions,
        // The operator's token wins, as it does on the platform.
        tokens: new Map([
          [handle, operatorToken],
          ...Object.entries(sessions)
            .filter(([, person]) => !sameHandle(person, handle))
            .map(([token, person]) => [person, Redacted.make(token)] as const),
        ]),
      });
    })
  );
