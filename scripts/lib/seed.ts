import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { AskListing } from "@repo/protocol/domain/ask";
import { LayerManifest } from "@repo/protocol/domain/visibility";
import {
  addressOfRepo,
  AskId,
  CommitSha,
  Handle,
  keyOf,
  LayerName,
  ProjectName,
  RepoName,
  RepoPath,
  sameHandle,
} from "@repo/protocol/ids";
import { ProjectExists, Refusal } from "@repo/protocol/refusal";
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
  Schedule,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { repoRoot } from "../../infra/stages.ts";

export class SeedFailed extends Schema.TaggedError<SeedFailed>()("SeedFailed", {
  reason: Schema.String,
  refusals: Schema.optionalKey(Schema.NonEmptyArray(Refusal)),
}) {
  override get message() {
    return this.reason;
  }
}

export interface SeedFile {
  readonly path: RepoPath;
  readonly content: Uint8Array;
}

export interface AskFile {
  readonly path: RepoPath;
  readonly content: string;
}

export interface AskStep {
  readonly id: AskId;
  readonly kind: string;
  readonly files: Array.NonEmptyReadonlyArray<AskFile>;
}

/**
 * A parentless commit at the seed's fixed dates, so it is the same commit on
 * every platform and the layer's manifest can name it.
 */
export interface KnownBadStep {
  readonly branch: string;
  readonly commit: CommitSha;
  readonly message: string;
  readonly files: Array.NonEmptyReadonlyArray<SeedFile>;
}

export interface LayerStep {
  readonly layer: LayerName;
  readonly repo: RepoName;
  readonly files: Array.NonEmptyReadonlyArray<SeedFile>;
  readonly knownBad: readonly KnownBadStep[];
}

export interface SeedPlan {
  readonly project: ProjectName;
  readonly decider: Handle;
  readonly initFiles: Array.NonEmptyReadonlyArray<SeedFile>;
  readonly asks: readonly AskStep[];
  readonly ratchets: readonly string[];
  readonly layers: readonly LayerStep[];
  readonly copyOf?: ProjectName;
}

const ASKS = `${Brand.configDir}/asks/`;

/** Nothing under it enters the public tree. */
const LAYERS = "layers/";

const KNOWN_BAD = /^known-bad\/(?<area>[^/]+)\.patch$/u;

const MANIFEST_FILE = `${Brand.configDir}/layer.json`;

const DIFF_START = /^(?:diff --git |--- )/mu;

const PROJECT_FILE = `${Brand.configDir}/project.ts`;

const ASK_FILE = /^(?<id>[^/]+)\.ask\.ts$/u;

/** Env files whose values stay on each machine: an example that tracks one is refused, never read. */
const CLOSED_ENV = /^\.env(?:\.local|\.[^/]+\.local)?$/u;

const KIND = /\bkinds\.(?<kind>\w+)\.ask\(/u;

// The check file is the `path` the ask's kind takes; a kind that counts (`migrate`) names none.
const CHECK_PATH = /\bpath:\s*"(?<path>[^"]+)"/u;

const WHOLE_TREE_DECIDER = /"\*\*"\s*:\s*\[\s*"(?<handle>[^"]+)"/u;

const RATCHET = /"(?<name>[^"]+)"\s*:\s*check\.ratchet\./gu;

const failed = (reason: string) => new SeedFailed({ reason });

const decoded =
  <S extends Schema.Codec<unknown, string>>(schema: S, what: string) =>
  (raw: string) =>
    Schema.decodeEffect(schema)(raw).pipe(
      Effect.mapError(() => failed(`${what} ${JSON.stringify(raw)} is not one`))
    );

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

const textOf = (fs: FileSystem.FileSystem, at: string, path: string) =>
  fs
    .readFileString(at)
    .pipe(Effect.mapError(() => failed(`can't read ${path}`)));

// Fixed dates and no machine config, so the same files make the same commit everywhere.
const authorEnv = (handle: Handle) => ({
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
});

const streamText = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

const runGit = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  settings: readonly string[] = []
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("git", [...settings, ...args], {
          cwd,
          env,
          extendEnv: true,
        })
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [streamText(child.stdout), streamText(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { code: Number(code), stderr, stdout };
    })
  ).pipe(
    Effect.mapError(({ message }) =>
      failed(`git ${args[0] ?? ""} didn't run: ${message}`)
    )
  );

const okOutput =
  (args: readonly string[]) =>
  ({ code, stderr, stdout }: Effect.Success<ReturnType<typeof runGit>>) =>
    code === 0
      ? Effect.succeed(stdout)
      : Effect.fail(
          failed(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`)
        );

const writeTree = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  files: readonly { readonly path: string; readonly content: Uint8Array }[]
) =>
  Effect.forEach(
    files,
    ({ content, path: file }) =>
      Effect.gen(function* () {
        const at = path.join(dir, file);

        yield* fs.makeDirectory(path.dirname(at), { recursive: true });
        yield* fs.writeFile(at, content);
      }).pipe(Effect.mapError(() => failed(`can't write ${file} to seed`))),
    { discard: true }
  );

const knownBadOf = (input: {
  readonly area: string;
  readonly decider: Handle;
  readonly initFiles: SeedPlan["initFiles"];
  readonly patch: string;
  readonly named: string;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const env = authorEnv(input.decider);

      const git = (dir: string, args: readonly string[]) =>
        Effect.flatMap(runGit(spawner, dir, args, env), okOutput(args));

      const words = yield* textOf(fs, input.patch, input.named);
      const message = words.split(DIFF_START)[0]?.trim() ?? "";

      if (message === "" || !DIFF_START.test(words)) {
        return yield* failed(
          `${input.named} needs a few words on what it breaks, then its diff`
        );
      }

      const dir = yield* fs
        .makeTempDirectoryScoped({ prefix: "seed-known-bad-" })
        .pipe(Effect.mapError(() => failed("can't make a temporary folder")));

      yield* writeTree(fs, path, dir, input.initFiles);
      yield* git(dir, ["init", "--quiet", "--initial-branch=main"]);
      yield* git(dir, ["apply", input.patch]);
      yield* git(dir, ["add", "--all"]);
      yield* git(dir, ["commit", "--quiet", "--message", `${message}\n`]);

      const commit = yield* decoded(
        CommitSha,
        `the commit ${input.named} makes`
      )((yield* git(dir, ["rev-parse", "HEAD"])).trim());

      const paths = (yield* git(dir, ["ls-files", "-z"]))
        .split("\0")
        .filter((file) => file.length > 0);

      const files = yield* Effect.forEach(paths, (file) =>
        fs.readFile(path.join(dir, file)).pipe(
          Effect.map((content) => ({ content, path: RepoPath.make(file) })),
          Effect.mapError(() => failed(`can't read back ${file}`))
        )
      );

      if (!Array.isReadonlyArrayNonEmpty(files)) {
        return yield* failed(`${input.named} leaves no file in the tree`);
      }

      return {
        branch: `known-bad/${input.area}`,
        commit,
        files,
        message,
      } satisfies KnownBadStep;
    })
  );

const layerRepo = (project: ProjectName, layer: LayerName) =>
  RepoName.make(`${keyOf(project)}--${layer}`);

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(LayerManifest)
);

const layersOf = (input: {
  readonly decider: Handle;
  readonly folder: string;
  readonly initFiles: SeedPlan["initFiles"];
  readonly project: ProjectName;
  readonly tracked: readonly string[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const at = (file: string) => path.join(root, input.folder, file);

    const names = Array.dedupe(
      input.tracked.flatMap((file) =>
        file.startsWith(LAYERS)
          ? [file.slice(LAYERS.length).split("/")[0] ?? ""]
          : []
      )
    );

    return yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const layer = yield* decoded(LayerName, "the layer name")(name);
        const prefix = `${LAYERS}${name}/`;

        const inLayer = input.tracked
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length));

        const files = yield* Effect.forEach(inLayer, (file) =>
          fs.readFile(at(`${prefix}${file}`)).pipe(
            Effect.map((content) => ({ content, path: RepoPath.make(file) })),
            Effect.mapError(() =>
              failed(`can't read ${input.folder}/${prefix}${file}`)
            )
          )
        );

        if (!Array.isReadonlyArrayNonEmpty(files)) {
          return yield* failed(
            `git tracks nothing under ${input.folder}/${prefix}`
          );
        }

        const knownBad = yield* Effect.forEach(
          inLayer.flatMap((file) => {
            const area = KNOWN_BAD.exec(file)?.groups?.area;

            return area === undefined ? [] : [{ area, file }];
          }),
          ({ area, file }) =>
            knownBadOf({
              area,
              decider: input.decider,
              initFiles: input.initFiles,
              named: `${input.folder}/${prefix}${file}`,
              patch: at(`${prefix}${file}`),
            })
        );

        if (inLayer.includes(MANIFEST_FILE)) {
          const named = `${input.folder}/${prefix}${MANIFEST_FILE}`;

          const raw = yield* textOf(fs, at(`${prefix}${MANIFEST_FILE}`), named);

          const manifest = yield* decodeManifest(raw).pipe(
            Effect.mapError((error) =>
              failed(`${named} is no layer manifest: ${error.message}`)
            )
          );

          const made = knownBad.map(({ commit }) => commit);

          if (manifest.layer !== layer) {
            return yield* failed(
              `${named} is the manifest of ${manifest.layer}, not ${layer}`
            );
          }

          if (
            manifest.knownBad.toSorted().join(",") !== made.toSorted().join(",")
          ) {
            return yield* failed(
              `${named} names the known-bad commits ${JSON.stringify(manifest.knownBad)}, but its patches make ${JSON.stringify(made)}: write those into knownBad in layer.ts and layer.json`
            );
          }
        }

        return {
          files,
          knownBad,
          layer,
          repo: layerRepo(input.project, layer),
        } satisfies LayerStep;
      })
    );
  });

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
        failed(`${folder}/${PROJECT_FILE} names no maintainer for "**"`)
      ),
      Effect.flatMap(decoded(Handle, "the maintainer"))
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

    // A layer's files never enter the public tree.
    const initPaths = tracked.filter(
      (file) =>
        !file.startsWith(ASKS) && !file.startsWith(LAYERS) && !held.has(file)
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

    const layers = yield* layersOf({
      decider,
      folder,
      initFiles,
      project,
      tracked,
    });

    return {
      asks,
      decider,
      initFiles,
      layers,
      project,
      ratchets,
    } satisfies SeedPlan;
  });

export const renameSeedPlan = (plan: SeedPlan, as: ProjectName): SeedPlan => ({
  ...plan,
  copyOf: plan.copyOf ?? plan.project,
  layers: plan.layers.map((layer) => ({
    ...layer,
    repo: layerRepo(as, layer.layer),
  })),
  project: as,
});

export const StepResult = Schema.Literals(["done", "already"]);

export type StepResult = typeof StepResult.Type;

const step = { result: StepResult, target: Schema.String };

export const SeedStep = Schema.TaggedUnion({
  Init: step,
  Layer: step,
  OpenAsk: step,
  Push: step,
});

export type SeedStep = typeof SeedStep.Type;

export class SeedTarget extends Context.Service<
  SeedTarget,
  {
    readonly operator: Handle;
    readonly clientFor: (handle: Handle) => Layer.Layer<Client, SeedFailed>;
    readonly requireSessions: (
      handles: readonly Handle[]
    ) => Effect.Effect<void, SeedFailed>;
    readonly refsOf: (
      project: ProjectName
    ) => Effect.Effect<ReadonlyMap<string, CommitSha>, SeedFailed>;
    readonly pushInitial: (
      project: ProjectName,
      files: SeedPlan["initFiles"],
      as: Handle
    ) => Effect.Effect<CommitSha, SeedFailed>;
    readonly refsAt: (
      repo: RepoName,
      as: Handle
    ) => Effect.Effect<
      Option.Option<ReadonlyMap<string, CommitSha>>,
      SeedFailed
    >;
    readonly pathsAt: (
      repo: RepoName,
      ref: string,
      as: Handle
    ) => Effect.Effect<readonly RepoPath[], SeedFailed>;
    readonly pushCommit: (input: {
      readonly repo: RepoName;
      readonly ref: string;
      readonly files: Array.NonEmptyReadonlyArray<SeedFile>;
      readonly as: Handle;
      readonly message: string;
    }) => Effect.Effect<CommitSha, SeedFailed>;
  }
>()("seed/SeedTarget") {}

const isRefusal = Schema.is(Refusal);

const isProjectExists = Schema.is(ProjectExists);

interface CallFailure {
  readonly _tag: string;
  readonly message: string;
}

const failedCall = (call: string) => (error: CallFailure) =>
  isRefusal(error)
    ? new SeedFailed({
        reason: `${call} was refused: ${explain([error])
          .map((line) => line.trim())
          .join("; ")}`,
        refusals: [error],
      })
    : failed(`${call} got no answer from the platform: ${error.message}`);

export const MAIN_REF = "refs/heads/main";

export const ready = (
  plans: readonly SeedPlan[]
): Effect.Effect<void, SeedFailed, SeedTarget> =>
  Effect.flatMap(Effect.service(SeedTarget), (target) =>
    target.requireSessions([
      target.operator,
      ...plans.map(({ decider }) => decider),
    ])
  );

export interface SeededProject {
  readonly project: ProjectName;
  readonly asks: readonly AskListing[];
  readonly refs: readonly (readonly [string, CommitSha])[];
}

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

const LAYER_WAIT = { every: Duration.seconds(1), times: 30 } as const;

class NotMadeYet extends Schema.TaggedError<NotMadeYet>()("NotMadeYet", {
  repo: RepoName,
}) {}

// Known-bad commits go first, so admission finds every commit the manifest names.
const seedLayer = (
  layer: LayerStep,
  decider: Handle
): Effect.Effect<SeedStep, SeedFailed, SeedTarget> =>
  Effect.gen(function* () {
    const target = yield* SeedTarget;

    const refs = yield* target.refsAt(layer.repo, decider).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new NotMadeYet({ repo: layer.repo })),
          onSome: Effect.succeed,
        })
      ),
      Effect.retry({
        schedule: Schedule.spaced(LAYER_WAIT.every),
        times: LAYER_WAIT.times,
        while: Schema.is(NotMadeYet),
      }),
      Effect.catchTag("NotMadeYet", ({ repo }) =>
        Effect.fail(
          failed(
            `the platform never made ${repo}: does the project's config declare the layer ${layer.layer}, and is its visibility cartridge plugged in?`
          )
        )
      )
    );

    const reported = (result: StepResult) =>
      SeedStep.cases.Layer.make({ result, target: layer.repo });

    if (refs.has(MAIN_REF)) {
      return reported("already");
    }

    yield* Effect.forEach(
      layer.knownBad.filter(
        ({ branch, commit }) => refs.get(`refs/heads/${branch}`) !== commit
      ),
      ({ branch, commit, files, message }) =>
        Effect.flatMap(
          target.pushCommit({
            as: decider,
            files,
            message,
            ref: `refs/heads/${branch}`,
            repo: layer.repo,
          }),
          (made) =>
            made === commit
              ? Effect.void
              : Effect.fail(
                  failed(
                    `${layer.repo}'s ${branch} came out as ${made}, not the ${commit} its manifest names`
                  )
                )
        ),
      { discard: true }
    );

    yield* target.pushCommit({
      as: decider,
      files: layer.files,
      message: `Start ${layer.repo}`,
      ref: MAIN_REF,
      repo: layer.repo,
    });

    return reported("done");
  });

/** `made` runs as soon as the project exists, so a run that fails later still records it. */
export const runSeedWith = <R>(
  plan: SeedPlan,
  made: (plan: SeedPlan) => Effect.Effect<void, SeedFailed, R>
): Effect.Effect<readonly SeedStep[], SeedFailed, SeedTarget | R> =>
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
        Effect.catchTag("ProjectExists", (exists) =>
          plan.copyOf === undefined
            ? Effect.succeed<StepResult>("already")
            : Effect.fail(exists)
        ),
        Effect.mapError((error) =>
          isProjectExists(error) && plan.copyOf !== undefined
            ? new SeedFailed({
                reason: `${project} is taken: --as makes a fresh copy of ${plan.copyOf}, so name a project nobody has`,
                refusals: [error],
              })
            : failedCall(`initProject ${project}`)(error)
        )
      );

      if (init === "done") {
        yield* made(plan);
      }

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

      const layers = yield* Effect.forEach(plan.layers, (layer) =>
        seedLayer(layer, decider)
      );

      return [
        SeedStep.cases.Init.make({ result: init, target: project }),
        SeedStep.cases.Push.make({ result: push, target: project }),
        ...asks,
        ...layers,
      ];
    })
  );

export const runSeed = (
  plan: SeedPlan
): Effect.Effect<readonly SeedStep[], SeedFailed, SeedTarget> =>
  runSeedWith(plan, () => Effect.void);

export interface Platform {
  readonly origin: string;
  readonly operator: Handle;
  readonly tokens: ReadonlyMap<Handle, Redacted.Redacted>;
  readonly sessionsFrom: string;
}

const refsIn = (listed: string) =>
  Effect.map(
    Effect.forEach(
      listed.split("\n").filter((line) => line.length > 0),
      (line) => {
        const [sha = "", ref = ""] = line.split("\t");

        return ref.length === 0
          ? Effect.fail(failed(`git ls-remote listed ${JSON.stringify(line)}`))
          : Effect.map(
              decoded(CommitSha, `the commit ls-remote lists for ${ref}`)(sha),
              (commit) => [ref, commit] as const
            );
      }
    ),
    (refs): ReadonlyMap<string, CommitSha> => new Map(refs)
  );

const NOT_SERVED = /\bnot found\b|\b404\b/u;

// The token reaches git through its env, never its argv.
const TOKEN_VAR = "SEED_GIT_TOKEN";

const helperFor = (handle: Handle) =>
  `!f() { test "$1" = get || exit 0; echo username=${handle}; echo "password=$${TOKEN_VAR}"; }; f`;

const gitEnv = (handle: Handle, token: Redacted.Redacted) => ({
  ...authorEnv(handle),
  [TOKEN_VAR]: Redacted.value(token),
});

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

      const remoteOf = (repo: ProjectName | RepoName) =>
        repo.includes("/")
          ? `${origin}/${repo}.git`
          : `${origin}/${Option.getOrElse(addressOfRepo(RepoName.make(repo)), () => repo)}.git`;

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

      const gitAs = (as: Handle, cwd: string, args: readonly string[]) =>
        Effect.flatMap(
          Effect.fromOption(tokenOf(as)).pipe(
            Effect.mapError(() => missing([as]))
          ),
          (token) =>
            runGit(spawner, cwd, args, gitEnv(as, token), [
              "-c",
              "credential.helper=",
              "-c",
              `credential.helper=${helperFor(as)}`,
            ])
        );

      const gitOk = (as: Handle, cwd: string, args: readonly string[]) =>
        Effect.flatMap(gitAs(as, cwd, args), okOutput(args));

      // An empty folder, so git reads no repo's config.
      const scratch = fs
        .makeTempDirectoryScoped({ prefix: "seed-" })
        .pipe(Effect.mapError(() => failed("can't make a temporary folder")));

      const refsOf = (project: ProjectName) =>
        Effect.scoped(
          Effect.gen(function* () {
            const listed = yield* gitOk(platform.operator, yield* scratch, [
              "ls-remote",
              remoteOf(project),
            ]);

            return yield* refsIn(listed);
          })
        );

      const refsAt = (repo: RepoName, as: Handle) =>
        Effect.scoped(
          Effect.gen(function* () {
            const listed = yield* gitAs(as, yield* scratch, [
              "ls-remote",
              remoteOf(repo),
            ]);

            if (listed.code === 0) {
              return Option.some(yield* refsIn(listed.stdout));
            }

            return NOT_SERVED.test(listed.stderr)
              ? Option.none<ReadonlyMap<string, CommitSha>>()
              : yield* failed(
                  `git ls-remote ${repo} as ${as} exited ${listed.code}: ${listed.stderr.trim()}`
                );
          })
        );

      const pathsAt = (repo: RepoName, ref: string, as: Handle) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* scratch;

            yield* gitOk(as, dir, ["init", "--quiet"]);
            yield* gitOk(as, dir, ["fetch", "--quiet", remoteOf(repo), ref]);

            const listed = yield* gitOk(as, dir, [
              "ls-tree",
              "-r",
              "-z",
              "--name-only",
              "FETCH_HEAD",
            ]);

            return listed
              .split("\0")
              .filter((file) => file.length > 0)
              .map((file) => RepoPath.make(file));
          })
        );

      const pushCommit = (input: {
        readonly repo: ProjectName | RepoName;
        readonly ref: string;
        readonly files: Array.NonEmptyReadonlyArray<SeedFile>;
        readonly as: Handle;
        readonly message: string;
      }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* scratch;
            const { as } = input;

            yield* writeTree(fs, path, dir, input.files);
            yield* gitOk(as, dir, ["init", "--quiet", "--initial-branch=main"]);
            yield* gitOk(as, dir, ["add", "--all"]);

            yield* gitOk(as, dir, [
              "commit",
              "--quiet",
              "--message",
              `${input.message}\n`,
            ]);

            yield* gitOk(as, dir, [
              "push",
              "--quiet",
              remoteOf(input.repo),
              `HEAD:${input.ref}`,
            ]);

            return yield* decoded(
              CommitSha,
              "the commit git made"
            )((yield* gitOk(as, dir, ["rev-parse", "HEAD"])).trim());
          })
        );

      // git ends a message with one newline whether given one or not.
      const pushInitial = (
        project: ProjectName,
        files: SeedPlan["initFiles"],
        as: Handle
      ) =>
        pushCommit({
          as,
          files,
          message: `Start ${project}`,
          ref: MAIN_REF,
          repo: project,
        });

      return SeedTarget.of({
        clientFor: (handle) =>
          Option.match(tokenOf(handle), {
            onNone: () => Layer.effect(Client)(Effect.fail(missing([handle]))),
            onSome: (token) => clientAt(origin, token),
          }),
        operator: platform.operator,
        pathsAt,
        pushCommit,
        pushInitial,
        refsAt,
        refsOf,
        requireSessions,
      });
    })
  );

const SERVE_WORLD = "apps/platform/test/serve-world.ts";

const WORLD_START = Duration.seconds(60);

const decodeServing = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ origin: Schema.String }))
);

/** The stages' operator handle, so the examples get the namespace they have on a stage. */
export const worldOperator = Handle.make("oscabriel");

const worldToken = (handle: Handle) =>
  Redacted.make(`${handle.toLowerCase()}-seed-world-token-0123456789abcdef`);

export const servedWorld = (sessions: ReadonlyMap<Handle, Redacted.Redacted>) =>
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

    // Both streams are drained so the world never blocks on a full pipe.
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

export interface StageTokens {
  readonly sessions: string;
  readonly operator: string;
}

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Handle))
);

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
