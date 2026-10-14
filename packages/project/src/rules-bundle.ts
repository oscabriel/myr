/**
 * A commit's rules bundle, kept by its config folder's tree id: the Lander
 * bundles only the files under `<configDir>/` against one SDK, so two commits
 * whose folders are one tree bundle to one bundle, and a landing that leaves
 * the folder as it was bundles nothing. Keys:
 * `<repo>/rules-bundle/v<version>/<sdkVersion>/<tree id>`, under a canonical
 * repo alone; a commit without the folder is keyed `none`.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { ObjectId } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { ConfigBundle, sdkVersion } from "@repo/rules/rules-evaluator";
import { Effect, Option } from "effect";

import { throughHistory } from "./code/history.ts";
import type { Kept } from "./code/history.ts";

export const BUNDLE_VERSION = 1;

export const rulesBundleKept: Kept<ConfigBundle> = {
  kind: "rules-bundle",
  schema: ConfigBundle,
  version: BUNDLE_VERSION,
};

const NO_FOLDER = "none";

/** The config folder's tree id at a commit; `none` without the folder, and no key when the commit can't be read. */
export const bundleKeyAt = (
  repo: RepoName,
  at: CommitSha
): Effect.Effect<Option.Option<string>, never, RepoHost> =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const commit = yield* host.readCommit(repo, at);

    if (Option.isNone(commit)) {
      return Option.none<string>();
    }

    const folder = yield* Effect.reduce(
      Brand.configDir.split("/"),
      (): Option.Option<ObjectId> => Option.some(commit.value.tree),
      (found, segment) =>
        Option.match(found, {
          onNone: () => Effect.succeedNone,
          onSome: (tree) =>
            Effect.map(host.readTree(repo, tree), (entries) =>
              Option.flatMap(entries, (listed) =>
                Option.map(
                  Option.fromUndefinedOr(
                    listed.find(
                      (entry) => entry.name === segment && entry.type === "tree"
                    )
                  ),
                  ({ sha }) => sha
                )
              )
            ),
        })
    );

    return Option.some(
      `${repo}/${rulesBundleKept.kind}/v${BUNDLE_VERSION}/${sdkVersion}/${Option.getOrElse(folder, () => NO_FOLDER)}`
    );
  }).pipe(Effect.orElseSucceed(() => Option.none<string>()));

/** Bundles only when no bundle is kept under the key; a bundle it made is kept. */
export const bundleThrough = <E, R>(
  key: Option.Option<string>,
  bundle: Effect.Effect<ConfigBundle, E, R>
): Effect.Effect<ConfigBundle, E, R> =>
  Option.match(key, {
    onNone: () => bundle,
    onSome: (found) => throughHistory(rulesBundleKept, found, bundle),
  });
