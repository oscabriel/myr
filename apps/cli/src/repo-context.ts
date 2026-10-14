import { AskId, Handle, LayerName, ProjectName } from "@repo/protocol/ids";
import { Array, Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Credentials } from "./credentials.ts";

export type RepoKind = "canonical" | "claim" | "working" | "layer";

export interface RepoRef {
  readonly kind: RepoKind;
  readonly project: ProjectName;
  readonly ask?: AskId;
  readonly handle?: Handle;
  readonly layer?: LayerName;
}

const asProject = Schema.decodeOption(ProjectName);

const asAsk = Schema.decodeOption(AskId);

const asLayer = Schema.decodeOption(LayerName);

const asForkHandle = (part: string) =>
  Option.filter(
    Schema.decodeOption(Handle)(part),
    (handle) => handle === handle.toLowerCase()
  );

const WORKING = "me";

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

/** `--` occurs in no name or ask, so an address splits back into its parts. */
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

export interface Remote {
  readonly name: string;
  readonly url: string;
}

export interface RepoContext {
  readonly root: string;
  readonly remote: Option.Option<Remote>;
  /** Every remote the repo has, as `git remote -v` lists them. */
  readonly remotes: readonly Remote[];
  readonly origin: Option.Option<string>;
  readonly repo: Option.Option<RepoRef>;
}

export class NotARepo extends Schema.TaggedError<NotARepo>()("NotARepo", {
  cwd: Schema.String,
}) {
  override get message() {
    return `${this.cwd} is not inside a git repo`;
  }
}

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

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

const remotesOf = (listing: string): readonly Remote[] =>
  listing.split("\n").flatMap((line) => {
    const match = /^(?<name>\S+)\t(?<url>\S+) \(fetch\)$/u.exec(line);

    return match?.groups?.name === undefined || match.groups.url === undefined
      ? []
      : [{ name: match.groups.name, url: match.groups.url }];
  });

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
      remotes,
      repo: Option.flatMap(parsed, ({ repo }) => parseRepoName(repo)),
      root: top.stdout.trim(),
    };
  }).pipe(
    Effect.catchTag("PlatformError", () => Effect.fail(new NotARepo({ cwd })))
  );
