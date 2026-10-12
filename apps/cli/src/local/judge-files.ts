// A git that fails reads as nothing: the closure is then the defaults.
import { judgeInputs } from "@repo/checks/judge";
import type { JudgeInput } from "@repo/checks/judge";
import { Array, Effect, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { readOnlyGit } from "./facts.ts";

export interface ListedBlob {
  readonly mode: string;
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

const decoder = new TextDecoder();

const gitBytes = (root: string, args: readonly string[], stdin?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd: root,
          env: readOnlyGit,
          extendEnv: true,
          stderr: "ignore",
          stdin:
            stdin === undefined
              ? "ignore"
              : Stream.make(new TextEncoder().encode(stdin)),
        })
      );

      const [stdout, exitCode] = yield* Effect.all(
        [Stream.mkUint8Array(child.stdout), child.exitCode],
        { concurrency: "unbounded" }
      );

      return exitCode === 0 ? Option.some(stdout) : Option.none();
    })
  ).pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));

const ENTRY =
  /^(?<mode>\d+) blob (?<sha>[0-9a-f]+) +(?<size>\d+)\t(?<path>.+)$/su;

export const blobsAt = (
  root: string,
  revision: string
): Effect.Effect<
  readonly ListedBlob[],
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.map(
    gitBytes(root, [
      "ls-tree",
      "-r",
      "-l",
      "-z",
      "--full-tree",
      "--end-of-options",
      revision,
    ]),
    Option.match({
      onNone: () => [],
      onSome: (listing) =>
        decoder
          .decode(listing)
          .split("\0")
          .flatMap((entry) => {
            const groups = ENTRY.exec(entry)?.groups;

            return groups?.mode === undefined ||
              groups.sha === undefined ||
              groups.size === undefined ||
              groups.path === undefined
              ? []
              : [
                  {
                    mode: groups.mode,
                    path: groups.path,
                    sha: groups.sha,
                    size: Number(groups.size),
                  },
                ];
          }),
    })
  );

/** Output is `<sha> <type> <size>\n<bytes>\n` per object, in the order asked. */
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

export const judgeFilesIn = (
  root: string,
  listing: readonly ListedBlob[]
): Effect.Effect<
  readonly JudgeInput[],
  never,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  const shas = new Map(listing.map(({ path, sha }) => [path, sha]));

  return judgeInputs(listing, (paths) => {
    const asked = paths.flatMap((path) =>
      Option.toArray(
        Option.map(Option.fromUndefinedOr(shas.get(path)), (sha) => ({
          path,
          sha,
        }))
      )
    );

    return asked.length === 0
      ? Effect.succeed([])
      : Effect.map(
          gitBytes(
            root,
            ["cat-file", "--batch"],
            asked.map(({ sha }) => `${sha}\n`).join("")
          ),
          Option.match({
            onNone: () => [],
            onSome: (bytes) =>
              Array.zipWith(asked, objectsIn(bytes), ({ path }, read) => ({
                bytes: read,
                path,
              })),
          })
        );
  });
};

export const judgeFilesAt = (root: string, revision: string) =>
  Effect.flatMap(blobsAt(root, revision), (listing) =>
    judgeFilesIn(root, listing)
  );
