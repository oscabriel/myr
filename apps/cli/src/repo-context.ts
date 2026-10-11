/**
 * The repo the CLI stands in: its root, the remote that reaches a platform,
 * and what that remote's repo name says it is. Read once per
 * command, from git itself.
 */
import { AskId, Handle, LayerName, ProjectName } from "@repo/protocol/ids";
import { Array, Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Credentials } from "./credentials.ts";

/** What a repo is: a project's own, a claim's fork, a person's working fork, or a layer's. */
export type RepoKind = "canonical" | "claim" | "working" | "layer";

/** What a repo's name says, part by part. */
export interface RepoRef {
  readonly kind: RepoKind;
  readonly project: ProjectName;
  /** A claim's fork: the ask it answers. */
  readonly ask?: AskId;
  /** A claim's or a working fork: whose it is, in lowercase as the name spells it. */
  readonly handle?: Handle;
  /** A layer's repo: the layer. */
  readonly layer?: LayerName;
}

const asProject = Schema.decodeOption(ProjectName);

const asAsk = Schema.decodeOption(AskId);

const asLayer = Schema.decodeOption(LayerName);

/** A handle as a fork's name spells it: valid, and in lowercase. */
const asForkHandle = (part: string) =>
  Option.filter(
    Schema.decodeOption(Handle)(part),
    (handle) => handle === handle.toLowerCase()
  );

/** The word a working fork has where a claim's fork has its ask. */
const WORKING = "me";

/** What a three-part name `<project>--<second>--<third>` is. */
const forkOf = (
  project: ProjectName,
  second: string,
  third: string
): Option.Option<RepoRef> =>
  second === WORKING
    ? Option.map(asForkHandle(third), (handle): RepoRef => ({
        handle,
        kind: "working",
        project,
      }))
    : Option.map(
        Option.all({ ask: asAsk(second), handle: asForkHandle(third) }),
        ({ ask, handle }): RepoRef => ({ ask, handle, kind: "claim", project })
      );

/**
 * What a repo's address says it is: `<project>`, `<project>--<ask>--<handle>`,
 * `<project>--me--<handle>` or `<project>--<layer>`, where the project is its
 * name (`alice/datekit`, `github.com/pallets/click`) or a key a project kept
 * from before owners (`datekit`). `--` occurs in no name or ask, so an
 * address splits back into its parts; any other is none of the platform's.
 */
export const parseRepoName = (name: string): Option.Option<RepoRef> => {
  const slash = name.lastIndexOf("/");
  const [first = "", ...rest] = name.slice(slash + 1).split("--");
  const spelled = slash === -1 ? first : `${name.slice(0, slash)}/${first}`;

  return Option.flatMap(asProject(spelled), (project) => {
    const [second, third] = rest;

    if (second === undefined) {
      return Option.some<RepoRef>({ kind: "canonical", project });
    }

    if (third === undefined) {
      return Option.map(asLayer(second), (layer): RepoRef => ({
        kind: "layer",
        layer,
        project,
      }));
    }

    return rest.length === 2 ? forkOf(project, second, third) : Option.none();
  });
};

const asUrl = Option.liftThrowable((url: string) => new URL(url));

/** `url`'s scheme and host, if it is an HTTP(S) url. */
const webOrigin = (url: string) =>
  Option.map(
    Option.filter(asUrl(url), ({ protocol }) =>
      ["http:", "https:"].includes(protocol)
    ),
    ({ host, pathname, protocol }) => ({
      origin: `${protocol}//${host}`,
      pathname,
    })
  );

/**
 * A remote url as a platform serves repos: `https://<host>/<address>.git`,
 * the address one to three path segments (a project's name, a fork's parts
 * on the last), over HTTP(S). The origin drops any user the url carries.
 */
export const parseRemote = (
  url: string
): Option.Option<{ readonly origin: string; readonly repo: string }> =>
  Option.flatMap(webOrigin(url), ({ origin, pathname }) => {
    const repo = pathname
      .replace(/^\//u, "")
      .replace(/\/$/u, "")
      .replace(/\.git$/u, "");

    return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,2}$/u.test(repo)
      ? Option.some({ origin, repo })
      : Option.none();
  });

/** Where the CLI stands, as git sees it. */
export interface RepoContext {
  /** The work tree's top folder. */
  readonly root: string;
  /** The remote that reaches a platform: the signed-in one's, else `origin`. */
  readonly remote: Option.Option<{
    readonly name: string;
    readonly url: string;
  }>;
  /** That remote's platform origin, if its url is a platform's. */
  readonly origin: Option.Option<string>;
  /** What that remote's repo name says it is, if it is the platform's. */
  readonly repo: Option.Option<RepoRef>;
}

/** `cwd` is in no git work tree. */
export class NotARepo extends Schema.TaggedError<NotARepo>()("NotARepo", {
  cwd: Schema.String,
}) {
  override get message() {
    return `${this.cwd} is not inside a git repo`;
  }
}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Runs git in `cwd` to the end: its stdout and exit code; stderr is dropped. */
const git = (cwd: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd,
          stderr: "ignore",
          stdin: "ignore",
        })
      );

      const [stdout, exitCode] = yield* Effect.all(
        [text(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { exitCode, stdout };
    })
  );

/** `git remote -v`'s fetch urls, by remote, in git's order. */
const remotesOf = (listing: string) =>
  listing.split("\n").flatMap((line) => {
    const match = /^(?<name>\S+)\t(?<url>\S+) \(fetch\)$/u.exec(line);

    return match?.groups?.name === undefined || match.groups.url === undefined
      ? []
      : [{ name: match.groups.name, url: match.groups.url }];
  });

/**
 * Reads the repo at `cwd`: `git rev-parse --show-toplevel`, then `git
 * remote -v`. The remote is the one on the signed-in platform's origin when
 * `Credentials` is there to say which, else `origin`.
 */
export const repoContext = (
  cwd: string
): Effect.Effect<
  RepoContext,
  NotARepo,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const top = yield* git(cwd, ["rev-parse", "--show-toplevel"]);

    if (top.exitCode !== 0) {
      return yield* new NotARepo({ cwd });
    }

    const remotes = remotesOf((yield* git(cwd, ["remote", "-v"])).stdout);

    const signedIn = yield* Effect.serviceOption(Credentials).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (credentials) => credentials.current,
        })
      ),
      Effect.map(Option.flatMap(({ url }) => webOrigin(url)))
    );

    const remote = Option.orElse(
      Option.flatMap(signedIn, ({ origin }) =>
        Array.findFirst(remotes, ({ url }) =>
          Option.exists(parseRemote(url), (parsed) => parsed.origin === origin)
        )
      ),
      () => Array.findFirst(remotes, ({ name }) => name === "origin")
    );

    const parsed = Option.flatMap(remote, ({ url }) => parseRemote(url));

    return {
      origin: Option.map(parsed, ({ origin }) => origin),
      remote,
      repo: Option.flatMap(parsed, ({ repo }) => parseRepoName(repo)),
      root: top.stdout.trim(),
    };
  }).pipe(
    Effect.catchTag("PlatformError", () => Effect.fail(new NotARepo({ cwd })))
  );
