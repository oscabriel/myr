/**
 * A folder and its README, read on the server for the project's page and a
 * folder's page: the README is asked for beside the folder, not after it,
 * as `README.md`, the name most folders give it, and the folder's own
 * README is read when it names another (or the guess was read at another
 * commit). Over a stub platform that answers `readTree` and `readFile`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { FileView, TreeListing } from "@repo/protocol/domain/code";
import { BlobSha, CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { Deferred, Duration, Effect, Layer, Option, Ref } from "effect";
import type { Types } from "effect";
import { RpcTest } from "effect/rpc";

import { readFolderWithReadme } from "../src/server/folder.ts";

const project = ProjectName.make("datekit");

const landed = CommitSha.make("a".repeat(40));

const moved = CommitSha.make("b".repeat(40));

const fileAt = (path: string, at = landed): FileView => ({
  at,
  binary: false,
  path: RepoPath.make(path),
  sha: BlobSha.make("c".repeat(40)),
  size: 5,
  text: `# ${path}`,
  truncated: false,
});

/** A folder at the landed commit holding nothing but its README, when `readme` names one. */
const folder = (readme?: string, path?: string): TreeListing => {
  const listing: Types.Mutable<TreeListing> = {
    at: landed,
    entries: [],
  };

  if (path !== undefined) {
    listing.path = RepoPath.make(path);
  }

  if (readme !== undefined) {
    listing.readme = {
      path: RepoPath.make(readme),
      sha: BlobSha.make("c".repeat(40)),
    };
  }

  return listing;
};

/**
 * A platform whose `readTree` answers `listing` once `treeWaits` lets it,
 * and whose `readFile` answers each path in `files` with the file kept
 * there (at its own commit), refusing any other; every path `readFile` is
 * asked for is kept in `asked`, and the first ask lets `readStarted` go.
 */
const platform = (input: {
  readonly asked: Ref.Ref<readonly string[]>;
  readonly files: ReadonlyMap<string, FileView>;
  readonly listing: TreeListing;
  readonly readStarted?: Deferred.Deferred<string>;
  readonly treeWaits?: Effect.Effect<void>;
}) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("readTree", () =>
          Effect.as(input.treeWaits ?? Effect.void, input.listing)
        ),
        Contracts.toLayerHandler("readFile", ({ path }) =>
          Effect.gen(function* () {
            yield* Ref.update(input.asked, (all) => [...all, path]);

            if (input.readStarted !== undefined) {
              yield* Deferred.succeed(input.readStarted, path);
            }

            const file = input.files.get(path);

            return file ?? (yield* new UnknownPath({ commit: landed, path }));
          })
        )
      ),
      asTester,
    ])
  );

/** The folder at `path` (the root when none) at main, with the paths of its README and the files asked for. */
const readWith = (
  input: Omit<Parameters<typeof platform>[0], "asked">,
  path?: string
) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make<readonly string[]>([]);

    const { readme } = yield* readFolderWithReadme({
      path: Option.map(Option.fromNullishOr(path), (at) => RepoPath.make(at)),
      project,
      rev: "main",
    }).pipe(Effect.provide(platform({ ...input, asked })));

    return {
      asked: yield* Ref.get(asked),
      readme: Option.getOrUndefined(
        Option.map(
          readme,
          ({ at, path: found }) => `${found}@${at.slice(0, 1)}`
        )
      ),
    };
  });

describe(readFolderWithReadme, () => {
  it.live("asks for the README while the folder is still being read", () =>
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<string>();

      // The folder answers only once a README was asked for: read one after
      // the other, the read would never end.
      const done = yield* readWith({
        files: new Map([["README.md", fileAt("README.md")]]),
        listing: folder("README.md"),
        readStarted,
        treeWaits: Deferred.await(readStarted),
      }).pipe(Effect.timeoutOption(Duration.seconds(2)));

      expect(Option.getOrUndefined(done)).toStrictEqual({
        asked: ["README.md"],
        readme: "README.md@a",
      });
    })
  );

  it.effect("reads the README the folder names when it is not README.md", () =>
    Effect.gen(function* () {
      expect(
        yield* readWith({
          files: new Map([["readme.markdown", fileAt("readme.markdown")]]),
          listing: folder("readme.markdown"),
        })
      ).toStrictEqual({
        asked: ["README.md", "readme.markdown"],
        readme: "readme.markdown@a",
      });
    })
  );

  it.effect(
    "reads the folder's README again when the guess was read at another commit",
    () =>
      Effect.gen(function* () {
        expect(
          yield* readWith({
            files: new Map([["README.md", fileAt("README.md", moved)]]),
            listing: folder("README.md"),
          })
        ).toStrictEqual({
          asked: ["README.md", "README.md"],
          readme: "README.md@b",
        });
      })
  );

  it.effect("guesses the README inside the folder it reads", () =>
    Effect.gen(function* () {
      expect(
        yield* readWith(
          {
            files: new Map([
              ["packages/parse/README.md", fileAt("packages/parse/README.md")],
            ]),
            listing: folder("packages/parse/README.md", "packages/parse"),
          },
          "packages/parse"
        )
      ).toStrictEqual({
        asked: ["packages/parse/README.md"],
        readme: "packages/parse/README.md@a",
      });
    })
  );

  it.effect("leaves a folder with no README without one", () =>
    Effect.gen(function* () {
      expect(
        yield* readWith({ files: new Map(), listing: folder() })
      ).toStrictEqual({ asked: ["README.md"], readme: undefined });
    })
  );
});
