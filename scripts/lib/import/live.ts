/**
 * The import run's real target and backfill: a platform over `/rpc` as the
 * operator, git's `ls-remote` anonymously through the gateway, and the tag
 * backfill through `@repo/artifacts`' REST adapter with the ops
 * credentials, as `infra/teardown.ts` reaches Artifacts. No token is ever
 * printed: the operator's goes only into the `Authorization` header of
 * `/rpc` calls, and the backfill's write token only into git's env.
 */
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost, RepoName } from "@repo/artifacts/repo-host";
import { RepoHostRest } from "@repo/artifacts/repo-host/rest";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { ProjectName } from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Config,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Redacted,
  Schema,
  Stream,
} from "effect";
import type { Path } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";

import {
  platformOrigin,
  recordedSubdomain,
  resources,
  subdomainFile,
} from "../../../infra/stages.ts";
import type { Stage } from "../../../infra/stages.ts";
import { servedWorld, worldOperator } from "../seed.ts";
import { shownCommand, tagBackfillCommands } from "./plan.ts";
import type { Command } from "./plan.ts";
import {
  ImportExamplesFailed,
  ImportTarget,
  initUntilAnswered,
  TagBackfill,
} from "./run.ts";

const failed = (reason: string) => new ImportExamplesFailed({ reason });

const isRefusal = Schema.is(Refusal);

/** A call the platform refused, said as `explain` says it; or one it never answered. */
const failedCall =
  (call: string) =>
  (error: { readonly _tag: string; readonly message: string }) =>
    isRefusal(error)
      ? failed(
          `${call} was refused: ${explain([error])
            .map((line) => line.trim())
            .join("; ")}`
        )
      : failed(`${call} got no answer from the platform: ${error.message}`);

/** git's env for a run of its own: no machine config, no prompt. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const streamText = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/**
 * `command` run to its end; what it printed when it ended well. A failure
 * says what git said, with every secret of the command's env cut out.
 */
const runCommand = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  command: Command
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const [file = "git", ...args] = command.argv;
      const secrets = Object.values(command.env ?? {}).map(Redacted.value);

      const scrub = (text: string) => {
        let said = text;

        for (const secret of secrets) {
          said = said.replaceAll(secret, "<token>");
        }

        return said;
      };

      const child = yield* spawner
        .spawn(
          ChildProcess.make(file, args, {
            env: {
              ...GIT_ENV,
              ...Object.fromEntries(
                Object.entries(command.env ?? {}).map(([name, value]) => [
                  name,
                  Redacted.value(value),
                ])
              ),
            },
            extendEnv: true,
          })
        )
        .pipe(
          Effect.mapError(({ message }) =>
            failed(`${shownCommand(command)} didn't run: ${scrub(message)}`)
          )
        );

      const [stdout, stderr, code] = yield* Effect.all(
        [streamText(child.stdout), streamText(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.mapError(({ message }) =>
          failed(`${shownCommand(command)} failed: ${scrub(message)}`)
        )
      );

      return Number(code) === 0
        ? stdout
        : yield* failed(
            `${shownCommand(command)} exited ${Number(code)}: ${scrub(stderr.trim())}`
          );
    })
  );

/** The refs `git ls-remote` lists, counted: branches, and tags without their peeled lines. */
const countsOf = (listed: string) => {
  const refs = listed
    .split("\n")
    .map((line) => line.split("\t")[1] ?? "")
    .filter((ref) => ref.length > 0);

  return {
    heads: refs.filter((ref) => ref.startsWith("refs/heads/")).length,
    tags: refs.filter(
      (ref) => ref.startsWith("refs/tags/") && !ref.endsWith("^{}")
    ).length,
  };
};

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

/** The platform at `origin`, reached as the operator with `token`. */
export const platformTarget = (input: {
  readonly origin: string;
  readonly token: Redacted.Redacted;
  readonly label: string;
}): Layer.Layer<ImportTarget, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    ImportTarget,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const client = yield* Client;

      return ImportTarget.of({
        counts: (project) =>
          runCommand(spawner, {
            argv: ["git", "ls-remote", `${input.origin}/${project}.git`],
          }).pipe(Effect.map(countsOf)),
        initProject: ({ branch, project, url }) =>
          initUntilAnswered(
            client.initProject({ import: { branch, url }, project }),
            isRefusal
          ).pipe(Effect.mapError(failedCall(`initProject ${project}`))),
        label: input.label,
        listProjects: client.listProjects({}).pipe(
          Effect.map(
            ({ projects }): ReadonlySet<ProjectName> =>
              new Set(projects.map(({ project }) => project))
          ),
          Effect.mapError(failedCall("listProjects"))
        ),
      });
    })
  ).pipe(Layer.provide(clientAt(input.origin, input.token)));

/**
 * A deployed dev stage at `url`, or at the workers.dev origin bootstrap
 * recorded, as the operator: `OPERATOR_TOKEN` from the env
 * (`bunx varlock run --path apps/platform/ -- …`), never printed.
 */
export const stageTarget = (
  stage: Stage,
  url: string | undefined
): Layer.Layer<
  ImportTarget,
  ImportExamplesFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const token = yield* Config.Redacted("OPERATOR_TOKEN").pipe(
        Effect.mapError(() =>
          failed(
            "no OPERATOR_TOKEN in the environment: run under `bunx varlock run --path apps/platform/ --`"
          )
        )
      );

      const origin =
        url ??
        platformOrigin(
          stage,
          yield* recordedSubdomain.pipe(
            Effect.flatMap(Effect.fromOption),
            Effect.mapError(() =>
              failed(
                `no --url, and ${subdomainFile} doesn't record the account's workers.dev subdomain`
              )
            )
          )
        );

      return platformTarget({ label: `${stage} (${origin})`, origin, token });
    })
  );

/** The operator's token in the Node world: no secret, never leaves this machine. */
const worldToken = Redacted.make(
  "operator-import-world-token-0123456789abcdef"
);

/** The Node world, served for as long as the layer lasts, with the operator's session. */
export const worldTarget: Layer.Layer<
  ImportTarget,
  ImportExamplesFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Layer.unwrap(
  servedWorld(new Map([[worldOperator, worldToken]])).pipe(
    Effect.mapError(({ reason }) => failed(reason)),
    Effect.map((origin) =>
      platformTarget({
        label: `the Node world (${origin})`,
        origin,
        token: worldToken,
      })
    )
  )
);

/** The `Fetch` port over the runtime's own fetch, as effect/http finds it. */
const RuntimeFetch = Layer.effect(
  Fetch,
  Effect.gen(function* () {
    const send = yield* FetchHttpClient.Fetch;

    return Fetch.of({
      fetch: (request) =>
        Effect.tryPromise({
          catch: () =>
            new FetchFailed({
              reason: "the request got no response",
              url: new URL(request.url).origin,
            }),
          try: () => send(request),
        }),
    });
  })
);

/** How long the backfill's write token lives: one backfill, at most. */
const TOKEN_TTL = Duration.minutes(10);

/**
 * The backfill on `stage`: its public namespace's repos through
 * `RepoHostRest`, with the ops credentials (`CLOUDFLARE_ACCOUNT_ID`,
 * `CLOUDFLARE_API_TOKEN`, from `bunx varlock run --path infra/ -- …`).
 * Each backfill mints a write token on the canonical repo for at most ten
 * minutes, fetches the source's tags into a temporary bare repo, pushes
 * `refs/tags/*` only, and revokes the token, whatever came of the push.
 */
export const restBackfill = (
  stage: Stage
): Layer.Layer<
  TagBackfill,
  ImportExamplesFailed,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Layer.effect(
    TagBackfill,
    Effect.gen(function* () {
      const { accountId, token } = yield* Config.all({
        accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
        token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      }).pipe(
        Effect.mapError(() =>
          failed(
            "--tags needs the ops credentials: run under `bunx varlock run --path infra/ --`"
          )
        )
      );

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;

      const host = Context.get(
        yield* Layer.build(
          RepoHostRest.layer({
            accountId,
            namespace: resources(stage).projects,
            token,
          }).pipe(
            Layer.provide(RuntimeFetch),
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        RepoHost
      );

      return TagBackfill.of({
        backfill: ({ project, url }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const name = RepoName.make(project);

              const notFound = () =>
                failed(
                  `${project} has no repo in ${resources(stage).projects}`
                );

              const dir = yield* fs
                .makeTempDirectoryScoped({ prefix: "import-tags-" })
                .pipe(
                  Effect.mapError(() => failed("can't make a temporary folder"))
                );

              const mirror = `${dir}/${project}.git`;

              const remote = yield* host
                .remote(name)
                .pipe(Effect.mapError(notFound));

              const minted = yield* host
                .mintToken(name, "write", TOKEN_TTL)
                .pipe(Effect.mapError(notFound));

              const pushed = Effect.gen(function* () {
                yield* Effect.forEach(
                  tagBackfillCommands({
                    mirror,
                    remote: { token: minted.secret, url: remote },
                    source: url,
                  }),
                  (command) => runCommand(spawner, command),
                  { discard: true }
                );

                return countsOf(
                  (yield* runCommand(spawner, {
                    argv: [
                      "git",
                      "--git-dir",
                      mirror,
                      "for-each-ref",
                      "--format=%(objectname)\t%(refname)",
                      "refs/tags",
                    ],
                  })).trim()
                ).tags;
              });

              // Revoked whatever came of the push; a revoke that fails is
              // said, and the token still expires within ten minutes.
              return yield* pushed.pipe(
                Effect.ensuring(
                  host
                    .revokeToken(name, minted.id)
                    .pipe(
                      Effect.catch(() =>
                        Effect.logWarning(
                          `the backfill's write token on ${project} was not revoked; it expires in ten minutes`
                        )
                      )
                    )
                )
              );
            })
          ),
      });
    })
  );
