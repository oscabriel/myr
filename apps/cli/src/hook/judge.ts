import { findRunBlock } from "@repo/checks/finder";
import type { RepoFile } from "@repo/checks/finder";
/**
 * The judge closure a hook session decides by: the closure `@repo/checks`
 * computes over the repo's files at the claim's base (the files the
 * platform reads: those at the root and in the CI folders), plus the ask's
 * own files, which the gate's shape stage judges for every answer.
 */
import { judgeClosure } from "@repo/checks/judge";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, Glob } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import { Array, Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * The closure with the ask's own files (its file in the config folder, and
 * a `redThenGreen` check's file), each anchored at the root: the gate's shape
 * stage judges them for every answer to the ask.
 */
export const askJudge = (
  closure: Policy["judge"],
  ask: Ask
): Policy["judge"] => {
  const own = [
    ask.file,
    ...(CheckSpec.guards.RedThenGreen(ask.check) ? [ask.check.path] : []),
  ].map((path) => Glob.make(`/${path}`));

  return {
    paths: Array.dedupe([...closure.paths, ...own]),
    pointers: closure.pointers,
  };
};

// ------------------------------------------------------------ at the base

/** The folders whose files the platform's run-block finder reads, beside the root's. */
const CI_FOLDERS = [".github/workflows", ".forgejo/workflows", ".husky"];

/** A file the finder reads is small; a large one is no config. */
const MAX_FACT_BYTES = 256 * 1024;

const decoder = new TextDecoder();

const bytesOf = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.runFold(
    stream,
    () => new Uint8Array(0),
    (all, chunk) => {
      const joined = new Uint8Array(all.length + chunk.length);

      joined.set(all);
      joined.set(chunk, all.length);

      return joined;
    }
  );

/** Runs git in `root` to the end: stdout as bytes, or none if it failed. */
const git = (root: string, args: readonly string[], stdin?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd: root,
          stderr: "ignore",
          stdin:
            stdin === undefined
              ? "ignore"
              : Stream.make(new TextEncoder().encode(stdin)),
        })
      );

      const [stdout, exitCode] = yield* Effect.all(
        [bytesOf(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return exitCode === 0 ? Option.some(stdout) : Option.none();
    })
  ).pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));

/** One blob `git ls-tree -l` lists: its id, size and path. */
interface Listed {
  readonly sha: string;
  readonly size: number;
  readonly path: string;
}

/** `git ls-tree -l -z`'s blob entries. */
const blobsIn = (listing: string): readonly Listed[] =>
  listing.split("\0").flatMap((entry) => {
    const match =
      /^\d+ blob (?<sha>[0-9a-f]+) +(?<size>\d+)\t(?<path>.+)$/su.exec(entry);

    return match?.groups?.sha === undefined ||
      match.groups.size === undefined ||
      match.groups.path === undefined
      ? []
      : [
          {
            path: match.groups.path,
            sha: match.groups.sha,
            size: Number(match.groups.size),
          },
        ];
  });

/**
 * `git cat-file --batch`'s output, split back into each object's bytes:
 * `<sha> <type> <size>\n<bytes>\n` per object, in the order asked.
 */
const objectsIn = (output: Uint8Array): readonly Uint8Array[] => {
  const objects: Uint8Array[] = [];
  let at = 0;

  while (at < output.length) {
    const end = output.indexOf(0x0a, at);

    if (end === -1) {
      break;
    }

    // `<sha> <type> <size>`: the size is the third word.
    const length = Number(
      decoder.decode(output.subarray(at, end)).split(" ").at(2)
    );

    if (Number.isInteger(length)) {
      objects.push(output.subarray(end + 1, end + 1 + length));
      at = end + 1 + length + 1;
    } else {
      // A missing object: `<sha> missing`, with no body.
      objects.push(new Uint8Array(0));
      at = end + 1;
    }
  }

  return objects;
};

/**
 * The files the platform hands the judge closure, at `base`: each blob at
 * the root and in the CI folders, of at most 256 KiB. None when git cannot
 * read `base`.
 */
export const filesAt = (
  root: string,
  base: string
): Effect.Effect<
  readonly RepoFile[],
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const listing = yield* git(root, [
      "ls-tree",
      "-l",
      "-z",
      base,
      "--",
      ".",
      ...CI_FOLDERS.map((folder) => `${folder}/`),
    ]);

    const blobs = Option.match(listing, {
      onNone: () => [],
      onSome: (bytes) =>
        blobsIn(decoder.decode(bytes)).filter(
          ({ size }) => size <= MAX_FACT_BYTES
        ),
    });

    if (blobs.length === 0) {
      return [];
    }

    const contents = yield* git(
      root,
      ["cat-file", "--batch"],
      blobs.map(({ sha }) => `${sha}\n`).join("")
    );

    return Option.match(contents, {
      onNone: () => [],
      onSome: (bytes) =>
        Array.zipWith(blobs, objectsIn(bytes), ({ path }, content) => ({
          content: decoder.decode(content),
          path,
        })),
    });
  });

const decodeRun = Schema.decodeUnknownOption(RunBlock);

/**
 * The judge closure at `base`, as `@repo/checks` computes it over the files
 * the platform reads there. The run block is the one the finder finds in
 * those files, with the claim's check command as its `test` when it finds
 * none: the config folder's own run block needs the config evaluated, which
 * only `<cli> check` does.
 */
export const judgeAt = (input: {
  readonly root: string;
  readonly base: string;
  readonly test: string;
}): Effect.Effect<
  Policy["judge"],
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.map(filesAt(input.root, input.base), (files) => {
    const found = findRunBlock(files).run;

    const run = Option.getOrElse(
      decodeRun({ checks: {}, test: input.test, ...found }),
      (): RunBlock => ({ checks: {}, test: Command.make(input.test) })
    );

    return judgeClosure(run, files);
  });
