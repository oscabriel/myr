import { RepoHost } from "@repo/artifacts/repo-host";
import { packageOf, TagName } from "@repo/protocol/domain/code";
import type { RefsView, TagRef } from "@repo/protocol/domain/code";
import { Array, Effect, Option, Schema } from "effect";

import type { CodeProject } from "../code.ts";
import { tagNameOf } from "./revision.ts";

const runsOf = (name: string) => name.match(/\d+|\D+/gu) ?? [];

const isDigits = (run: string) => /^\d/u.test(run);

const compareText = (one: string, other: string) => {
  if (one === other) {
    return 0;
  }

  return one < other ? -1 : 1;
};

const compareNumbers = (one: string, other: string) => {
  const left = one.replace(/^0+(?=\d)/u, "");
  const right = other.replace(/^0+(?=\d)/u, "");

  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }

  return compareText(left, right);
};

/** Newest first: digit runs compare by value (`v1.10.0` before `v1.9.0`), and a release before its pre-releases. */
export const compareTags = (one: string, other: string): number => {
  const left = runsOf(one);
  const right = runsOf(other);

  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const mine = left[at] ?? "";
    const theirs = right[at] ?? "";

    const order =
      isDigits(mine) && isDigits(theirs)
        ? compareNumbers(mine, theirs)
        : compareText(mine, theirs);

    if (order !== 0) {
      return -order;
    }
  }

  if (left.length === right.length) {
    return 0;
  }

  // A pre-release (`-beta.1`) is older than its release, anything else newer.
  const longer = left.length > right.length ? left : right;
  const rest = longer[Math.min(left.length, right.length)] ?? "";
  const longerIsNewer = !rest.startsWith("-");
  const leftIsLonger = left.length > right.length;

  return leftIsLonger === longerIsNewer ? -1 : 1;
};

/** Unversioned tags first, then each package's tags together, most tags first; newest first within each. */
export const sortTags = <T extends { readonly name: string }>(
  tags: readonly T[]
): readonly T[] => {
  const keyed = tags.map((tag) => ({
    pkg: Option.getOrUndefined(packageOf(tag.name)),
    tag,
  }));

  const counts = new Map<string, number>();

  for (const { pkg } of keyed) {
    if (pkg !== undefined) {
      counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
    }
  }

  const runOrder = (one: string | undefined, other: string | undefined) => {
    if (one === other) {
      return 0;
    }

    if (one === undefined || other === undefined) {
      return one === undefined ? -1 : 1;
    }

    const more = (counts.get(other) ?? 0) - (counts.get(one) ?? 0);

    return more === 0 ? compareText(one, other) : Math.sign(more);
  };

  return keyed
    .toSorted(
      (one, other) =>
        runOrder(one.pkg, other.pkg) ||
        compareTags(one.tag.name, other.tag.name)
    )
    .map(({ tag }) => tag);
};

const decodeTag = Schema.decodeUnknownOption(TagName);

/** Only `refs/tags/*` is read: none of the platform's own refs and no branch but main ever shows. */
export const refsView = (
  project: CodeProject
): Effect.Effect<RefsView, never, RepoHost> =>
  Effect.gen(function* () {
    const landed = yield* project.head;
    const forks = yield* project.forks;

    const tags = yield* RepoHost.use((host) => host.tags(project.repo)).pipe(
      Effect.catchTag("RepoNotFound", () => Effect.succeed([]))
    );

    const named = Array.getSomes(
      tags.map(({ name, sha }) =>
        Option.map(
          Option.flatMap(tagNameOf(name), decodeTag),
          (tag): TagRef => ({ name: tag, sha })
        )
      )
    );

    return {
      forks,
      project: project.project,
      tags: sortTags(named),
      ...Option.match(landed, {
        onNone: () => ({}),
        onSome: (sha) => ({ landed: sha }),
      }),
    };
  });
