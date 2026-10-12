import { inRepoSession, ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { Commit, RepoNotFound } from "@repo/artifacts/repo-host";
import {
  blameFrom,
  isSettled,
  linesOf,
  settle,
  traceBack,
} from "@repo/git/blame";
import { Edit, lineDiff } from "@repo/git/line-diff";
import type { Rev, WhyRange, WhyView } from "@repo/protocol/domain/code";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Option, Ref, Stream } from "effect";

import type { CodeProject } from "../code.ts";
import { MAX_LANDINGS } from "../project.ts";
import { asOneView } from "./cache.ts";
import { versionAt, walkableAt } from "./file-walk.ts";
import type { FileVersion } from "./file-walk.ts";
import { contentsOf, contentsOfBytes, unlessTooLarge } from "./file.ts";
import {
  INCREMENT_REACH,
  keyOf,
  recall,
  throughHistory,
  whyKept,
} from "./history.ts";
import type { StoredWhy } from "./history.ts";
import { commitViews, pageOf } from "./log.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entryAt, READS_AT_ONCE } from "./tree.ts";

export const WHY_SCAN = 200;

interface Version {
  readonly blob: BlobSha;
  readonly commit: Commit;
}

interface Versions {
  readonly versions: readonly Version[];
  readonly stopped: boolean;
}

const blobAt = (repo: RepoName, commit: Commit, path: RepoPath) =>
  Effect.map(
    entryAt(repo, commit.tree, path),
    Option.flatMap((entry) =>
      entry.type === "blob"
        ? Option.some(BlobSha.make(entry.sha))
        : Option.none()
    )
  );

const lookups = <E, R>(
  commits: readonly Commit[],
  blobOf: (commit: Commit) => Effect.Effect<Option.Option<BlobSha>, E, R>
) =>
  Effect.gen(function* () {
    const missingAt = yield* Ref.make(commits.length);

    const found = yield* Effect.forEach(
      commits,
      (commit, at) =>
        Effect.gen(function* () {
          if (at > (yield* Ref.get(missingAt))) {
            return Option.none();
          }

          const blob = yield* blobOf(commit);

          if (Option.isNone(blob)) {
            yield* Ref.update(missingAt, (was) => Math.min(was, at));
          }

          return Option.some({ blob, commit });
        }),
      { concurrency: READS_AT_ONCE }
    );

    const looked = Array.getSomes(found);
    const missing = looked.findIndex(({ blob }) => Option.isNone(blob));

    return missing === -1 ? looked : looked.slice(0, missing + 1);
  });

const versionsOf = (
  newest: Version,
  found: readonly {
    readonly blob: Option.Option<BlobSha>;
    readonly commit: Commit;
  }[]
): Versions => {
  const versions: Version[] = [];
  let current = newest;

  for (const { blob, commit } of found) {
    if (Option.contains(blob, current.blob)) {
      current = { blob: current.blob, commit };
    } else {
      versions.push(current);

      if (Option.isNone(blob)) {
        // The file was born in the commit after this one.
        return { stopped: false, versions };
      }

      current = { blob: blob.value, commit };
    }
  }

  versions.push(current);

  return {
    stopped: current.commit.parents.length > 0,
    versions,
  };
};

// Read past the cache: old versions are seldom viewed, and keeping them would
// push out the reads a reader comes back to.
const textOf = (repo: RepoName, blob: BlobSha) =>
  unlessTooLarge(
    RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
      Effect.map(Option.flatMap((bytes) => contentsOfBytes(bytes).text))
    ),
    Option.none
  ).pipe(Effect.map(Option.getOrElse(() => "")));

const landingsOf = (project: CodeProject, shas: readonly CommitSha[]) =>
  Effect.map(
    Effect.forEach(Array.chunksOf(shas, MAX_LANDINGS), project.landings),
    Array.flatten
  );

const ownersOf = (ranges: readonly WhyRange[]): readonly CommitSha[] =>
  ranges.flatMap(({ end, sha, start }) =>
    Array.makeBy(end - start + 1, () => sha)
  );

const rangesOf = (owners: readonly CommitSha[]): readonly WhyRange[] => {
  const ranges: WhyRange[] = [];

  for (const [index, sha] of owners.entries()) {
    const last = ranges.at(-1);
    const line = index + 1;

    if (last !== undefined && last.sha === sha && last.end === index) {
      ranges[ranges.length - 1] = { ...last, end: line };
    } else {
      ranges.push({ end: line, sha, start: line });
    }
  }

  return ranges;
};

const carried = (
  before: { readonly text: string; readonly owners: readonly CommitSha[] },
  after: string,
  sha: CommitSha
): readonly CommitSha[] => {
  const lines = linesOf(after);
  const owners: CommitSha[] = lines.map(() => sha);

  for (const edit of lineDiff(linesOf(before.text), lines)) {
    if (Edit.$is("Equal")(edit)) {
      for (let at = 0; at < edit.count; at += 1) {
        owners[edit.newStart + at] = before.owners[edit.oldStart + at] ?? sha;
      }
    }
  }

  return owners;
};

const nearestKept = (
  repo: RepoName,
  path: RepoPath,
  log: readonly Commit[],
  scan: number
) =>
  Effect.map(
    Effect.forEach(
      log.slice(1, INCREMENT_REACH + 1),
      ({ sha }) =>
        Effect.flatMap(
          keyOf(whyKept, { commit: sha, path, repo, scan }),
          (key) => recall(whyKept, key)
        ),
      { concurrency: INCREMENT_REACH }
    ),
    (found) =>
      Array.findFirst(found, (kept, at) =>
        Option.map(kept, (value) => ({ back: at + 1, kept: value }))
      )
  );

const forward = (
  repo: RepoName,
  log: readonly Commit[],
  newest: BlobSha,
  between: readonly Option.Option<BlobSha>[],
  from: { readonly back: number; readonly kept: StoredWhy }
): Effect.Effect<Option.Option<StoredWhy>, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    if (!between.every(Option.isSome)) {
      return Option.none();
    }

    const blobs = [newest, ...between.map(Option.getOrThrow)];

    const changes = blobs
      .flatMap((blob, at) => {
        const parent = blobs[at + 1] ?? from.kept.blob;
        const commit = log[at];

        return blob === parent || commit === undefined
          ? []
          : [{ blob, sha: commit.sha }];
      })
      .toReversed();

    if (changes.length === 0) {
      return Option.some(from.kept);
    }

    const newestContents = yield* contentsOf(repo, newest);

    if (
      Option.isNone(newestContents) ||
      Option.isNone(newestContents.value.text)
    ) {
      return Option.some({ blob: newest, ranges: [], shas: [] });
    }

    const newestText = newestContents.value.text.value;

    const [base, ...texts] = yield* Effect.forEach(
      [{ blob: from.kept.blob }, ...changes],
      ({ blob }) =>
        blob === newest ? Effect.succeed(newestText) : textOf(repo, blob),
      { concurrency: READS_AT_ONCE }
    );

    let tracing = {
      owners: ownersOf(from.kept.ranges),
      text: base ?? "",
    };

    for (const [{ sha }, text] of Array.zip(changes, texts)) {
      tracing = { owners: carried(tracing, text, sha), text };
    }

    const named = new Set<string>(tracing.owners);
    const added = changes.map(({ sha }) => sha).toReversed();

    const shas = [...added, ...from.kept.shas].filter(
      (sha, at, all) => named.has(sha) && all.indexOf(sha) === at
    );

    const stoppedAt = Option.filter(
      Option.fromUndefinedOr(from.kept.stoppedAt),
      (sha) => named.has(sha)
    );

    return Option.some({
      blob: newest,
      ranges: rangesOf(tracing.owners),
      shas,
      ...Option.match(stoppedAt, {
        onNone: () => ({}),
        onSome: (sha) => ({ stoppedAt: sha }),
      }),
    });
  });

const blamed = <R>(
  head: Commit,
  newest: BlobSha,
  text: string,
  found: readonly {
    readonly blob: Option.Option<BlobSha>;
    readonly commit: Commit;
  }[],
  readText: (blob: BlobSha) => Effect.Effect<string, RepoNotFound, R>
): Effect.Effect<StoredWhy, RepoNotFound, R> =>
  Effect.gen(function* () {
    const none: StoredWhy = { blob: newest, ranges: [], shas: [] };

    const { stopped, versions } = versionsOf(
      { blob: newest, commit: head },
      found
    );

    const [first = { blob: newest, commit: head }, ...older] = versions;

    const tracing = yield* Stream.fromIterable(older).pipe(
      Stream.mapEffect(
        (version) =>
          Effect.map(readText(version.blob), (read) => ({
            sha: version.commit.sha,
            text: read,
          })),
        { concurrency: READS_AT_ONCE }
      ),
      Stream.scan(() => blameFrom({ sha: first.commit.sha, text }), traceBack),
      Stream.takeUntil(isSettled),
      Stream.runLast,
      Effect.map(Option.getOrThrow)
    );

    const { ranges, reachedEnd } = settle(tracing);
    const named = new Set<string>(ranges.map(({ sha }) => sha));

    const shas = versions
      .map(({ commit }) => commit.sha)
      .filter((sha) => named.has(sha));

    const last = versions.at(-1);

    // Lines the walk did not see brought: they point at where it stopped.
    return stopped && reachedEnd && last !== undefined
      ? { ...none, ranges, shas, stoppedAt: last.commit.sha }
      : { ...none, ranges, shas };
  });

const walkedByFile = (
  repo: RepoName,
  path: RepoPath,
  log: readonly Commit[],
  head: Commit,
  newest: FileVersion
): Effect.Effect<StoredWhy, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const { text } = contentsOfBytes(newest.bytes);

    if (Option.isNone(text)) {
      return { blob: newest.blob, ranges: [], shas: [] };
    }

    const texts = new Map<string, Uint8Array>([[newest.blob, newest.bytes]]);

    const found = yield* lookups(log.slice(1), (commit) =>
      versionAt(repo, commit.sha, path).pipe(
        Effect.map(
          Option.map(({ blob, bytes }) => {
            if (!texts.has(blob)) {
              texts.set(blob, bytes);
            }

            return blob;
          })
        )
      )
    );

    return yield* blamed(head, newest.blob, text.value, found, (blob) => {
      const bytes = texts.get(blob);

      return bytes === undefined
        ? textOf(repo, blob)
        : Effect.succeed(
            Option.getOrElse(contentsOfBytes(bytes).text, () => "")
          );
    });
  });

const walked = (
  repo: RepoName,
  at: CommitSha,
  path: RepoPath,
  log: readonly Commit[],
  head: Commit
): Effect.Effect<StoredWhy, UnknownPath | RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const whole = yield* walkableAt(repo, head.sha, path);

    if (Option.isSome(whole)) {
      return yield* walkedByFile(repo, path, log, head, whole.value);
    }

    const [headSide, found] = yield* Effect.all(
      [
        Effect.gen(function* () {
          const blob = yield* blobAt(repo, head, path);

          if (Option.isNone(blob)) {
            return yield* new UnknownPath({ commit: at, path });
          }

          return {
            blob: blob.value,
            contents: yield* contentsOf(repo, blob.value),
          };
        }),
        lookups(log.slice(1), (commit) => blobAt(repo, commit, path)),
      ],
      { concurrency: 2 }
    );

    const newest = headSide.blob;
    const { contents } = headSide;

    if (Option.isNone(contents) || Option.isNone(contents.value.text)) {
      return { blob: newest, ranges: [], shas: [] };
    }

    return yield* blamed(
      head,
      newest,
      contents.value.text.value,
      found,
      (blob) => textOf(repo, blob)
    );
  });

const computed = (
  repo: RepoName,
  at: CommitSha,
  path: RepoPath,
  scan: number
): Effect.Effect<StoredWhy, UnknownPath | RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const log = yield* pageOf(repo, at, 0, Math.max(1, scan));
    const [head] = log;

    if (head === undefined) {
      return yield* Effect.die(`${repo} has no log from ${at}`);
    }

    const kept = yield* nearestKept(repo, path, log, scan);

    if (Option.isSome(kept)) {
      const [newest, ...between] = yield* Effect.forEach(
        log.slice(0, kept.value.back),
        (commit) => blobAt(repo, commit, path),
        { concurrency: READS_AT_ONCE }
      );

      if (newest === undefined || Option.isNone(newest)) {
        return yield* new UnknownPath({ commit: at, path });
      }

      const carriedForward = yield* forward(
        repo,
        log,
        newest.value,
        between,
        kept.value
      );

      if (Option.isSome(carriedForward)) {
        return carriedForward.value;
      }
    }

    return yield* walked(repo, at, path, log, head);
  });

const viewOf = (
  project: CodeProject,
  at: CommitSha,
  path: RepoPath,
  kept: StoredWhy,
  scan: number
): Effect.Effect<WhyView, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const log =
      kept.shas.length === 0
        ? []
        : yield* pageOf(project.repo, at, 0, Math.max(1, scan));

    const bySha = new Map<string, Commit>(
      log.map((commit) => [commit.sha, commit])
    );

    const commits = yield* Effect.forEach(
      kept.shas,
      (sha) =>
        Option.match(Option.fromUndefinedOr(bySha.get(sha)), {
          onNone: () =>
            commitAt(project.repo, sha).pipe(
              Effect.flatMap(Effect.fromOption),
              Effect.catchTag("NoSuchElementError", () =>
                Effect.die(`${project.repo} has no commit ${sha}`)
              )
            ),
          onSome: Effect.succeed,
        }),
      { concurrency: READS_AT_ONCE }
    );

    const views = yield* commitViews(
      { ...project, landings: () => Effect.succeed([]) },
      commits
    );

    const landings = yield* landingsOf(project, kept.shas);

    return {
      at,
      commits: views,
      landings,
      path,
      ranges: kept.ranges,
      ...Option.match(Option.fromUndefinedOr(kept.stoppedAt), {
        onNone: () => ({}),
        onSome: (stoppedAt) => ({ stoppedAt }),
      }),
    };
  });

export const whyView = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath,
  scan: number = WHY_SCAN
): Effect.Effect<WhyView, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, at);
    const { repo } = project;
    const key = yield* keyOf(whyKept, { commit, path, repo, scan });

    const kept = yield* throughHistory(
      whyKept,
      key,
      asOneView(computed(repo, commit, path, scan))
    );

    return yield* viewOf(project, commit, path, kept, scan);
  }).pipe(inRepoSession, Effect.catchTag("RepoNotFound", Effect.die));
