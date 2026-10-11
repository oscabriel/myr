import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { AskId, Handle, LayerName, ProjectName } from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Layer, Option, Path, Redacted } from "effect";

import { Credentials } from "../src/credentials.ts";
import type { Profile } from "../src/credentials.ts";
import {
  NotARepo,
  parseRemote,
  parseRepoName,
  repoContext,
} from "../src/repo-context.ts";

const project = ProjectName.make("oscabriel/datekit");

const platform = "https://platform-dev.example.workers.dev";

describe("a repo's name", () => {
  it("names a project's canonical repo", () => {
    expect(parseRepoName("datekit")).toStrictEqual(
      Option.some({ kind: "canonical", project })
    );
  });

  it("names a claim's fork: project, ask and handle", () => {
    expect(parseRepoName("datekit--fix-week--alice")).toStrictEqual(
      Option.some({
        ask: AskId.make("fix-week"),
        handle: Handle.make("alice"),
        kind: "claim",
        project,
      })
    );
  });

  it("names a person's working fork", () => {
    expect(parseRepoName("datekit--me--alice")).toStrictEqual(
      Option.some({ handle: Handle.make("alice"), kind: "working", project })
    );
  });

  it("names a layer's repo", () => {
    expect(parseRepoName("datekit--maintainers")).toStrictEqual(
      Option.some({
        kind: "layer",
        layer: LayerName.make("maintainers"),
        project,
      })
    );
  });

  it.each([
    "",
    "Datekit",
    "datekit--fix-week--Alice",
    "datekit--fix-week--alice--again",
    "datekit--me--",
    "datekit--layer--alice",
  ])("names nothing the platform makes: %j", (name) => {
    expect(parseRepoName(name)).toStrictEqual(Option.none());
  });
});

describe("a remote's url", () => {
  it("splits into the platform's origin and the repo's name", () => {
    expect(
      parseRemote(`${platform}/datekit--fix-week--alice.git`)
    ).toStrictEqual(
      Option.some({ origin: platform, repo: "datekit--fix-week--alice" })
    );
  });

  it("leaves out a trailing .git or slash, and any user in the url", () => {
    expect(
      parseRemote("https://someone@platform-dev.example.workers.dev/datekit/")
    ).toStrictEqual(Option.some({ origin: platform, repo: "datekit" }));
  });

  it.each([
    "git@github.com:owner/datekit.git",
    "https://github.com/owner/datekit.git",
    "file:///srv/datekit.git",
    "not a url",
  ])("is no platform remote: %j", (url) => {
    expect(parseRemote(url)).toStrictEqual(Option.none());
  });
});

/** A fresh git repo, its real path, with `remotes` added in order. */
const aRepo = (remotes: readonly (readonly [string, string])[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

    yield* gitOk(dir, "init", "--quiet");

    for (const [name, url] of remotes) {
      yield* gitOk(dir, "remote", "add", name, url);
    }

    return dir;
  });

/** Credentials whose current profile is on `url`. */
const signedIn = (url: string) => {
  const profile: Profile = {
    token: Redacted.make("tok-0123456789abcdefghijklmnopqrstuvwxyz"),
    url,
  };

  return Layer.succeed(Credentials)({
    current: Effect.succeedSome(profile),
    forHost: () => Effect.succeedSome(profile),
    put: () => Effect.void,
    remove: () => Effect.succeed(false),
  });
};

describe("the repo the CLI stands in", () => {
  it.live(
    "is found from a folder inside it: its root, remote, project, ask and handle",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const url = `${platform}/datekit--fix-week--alice.git`;
        const root = yield* aRepo([["origin", url]]);
        const inside = path.join(root, "src");

        yield* fs.makeDirectory(inside);

        const context = yield* repoContext(inside);

        expect(context).toStrictEqual({
          origin: Option.some(platform),
          remote: Option.some({ name: "origin", url }),
          repo: Option.some({
            ask: AskId.make("fix-week"),
            handle: Handle.make("alice"),
            kind: "claim",
            project,
          }),
          root,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("prefers the remote on the signed-in platform over `origin`", () =>
    Effect.gen(function* () {
      const url = `${platform}/datekit.git`;

      const root = yield* aRepo([
        ["origin", "https://github.com/owner/datekit.git"],
        ["platform", url],
      ]);

      const context = yield* repoContext(root).pipe(
        Effect.provide(signedIn(platform))
      );

      expect(context.remote).toStrictEqual(
        Option.some({ name: "platform", url })
      );
      expect(context.repo).toStrictEqual(
        Option.some({ kind: "canonical", project })
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("is NotARepo outside any git repo", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      expect(yield* Effect.flip(repoContext(dir))).toStrictEqual(
        new NotARepo({ cwd: dir })
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
