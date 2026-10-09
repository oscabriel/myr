/**
 * A project's refs as readers see them: main's landed commit (the
 * project's record, never a ref), its tags peeled to their commits (the
 * repo's `tags`) and sorted by version, newest first, and its forks. Only
 * `refs/tags/*` is read: nothing of the platform's own (its landed mirror,
 * compose refs, notes) and no branch but main ever shows.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import { TagName } from "@repo/protocol/domain/code";
import type { RefsView, TagRef } from "@repo/protocol/domain/code";
import { Array, Effect, Option, Schema } from "effect";

import type { CodeProject } from "../code.ts";
import { tagNameOf } from "./revision.ts";

/** A name cut into runs of digits and runs of anything else. */
const runsOf = (name: string) => name.match(/\d+|\D+/gu) ?? [];

const isDigits = (run: string) => /^\d/u.test(run);

/** Two strings as written, code point by code point. */
const compareText = (one: string, other: string) => {
  if (one === other) {
    return 0;
  }

  return one < other ? -1 : 1;
};

/** Two runs of digits by their value, however long. */
const compareNumbers = (one: string, other: string) => {
  const left = one.replace(/^0+(?=\d)/u, "");
  const right = other.replace(/^0+(?=\d)/u, "");

  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }

  return compareText(left, right);
};

/**
 * Tags newest first, by version: runs of digits compare by value, so
 * `v1.10.0` comes before `v1.9.0`, and a release before its own
 * pre-releases (`v1.10.0` before `v1.10.0-beta.1`). Names are otherwise
 * compared as written, so a scoped package's tags stay together.
 */
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

  // One name runs on past the other: a pre-release (`-beta.1`) is older
  // than its release, anything else newer.
  const longer = left.length > right.length ? left : right;
  const rest = longer[Math.min(left.length, right.length)] ?? "";
  const longerIsNewer = !rest.startsWith("-");
  const leftIsLonger = left.length > right.length;

  return leftIsLonger === longerIsNewer ? -1 : 1;
};

const decodeTag = Schema.decodeUnknownOption(TagName);

/** Main's landed commit, its tags peeled and sorted newest first, and its forks. */
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
      tags: named.toSorted((one, other) => compareTags(one.name, other.name)),
      ...Option.match(landed, {
        onNone: () => ({}),
        onSome: (sha) => ({ landed: sha }),
      }),
    };
  });
