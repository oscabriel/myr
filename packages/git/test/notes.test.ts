import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  ObjectId,
  RefName,
  RefOutcome,
  RepoHost,
  RepoName,
} from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { Verdict } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CheckVersion,
  CommitSha,
  LaneName,
  PatchId,
  ProjectName,
  TreeSha,
} from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { gitClient } from "@repo/testkit/git-client";
import { DateTime, Effect, FileSystem, Layer, Option, Schema } from "effect";

import { noteCommit, notesRef } from "../src/notes.ts";
import type { ScratchSource } from "../src/notes.ts";
import { committerLine } from "../src/trailers.ts";

const repo = RepoName.make("demo");

const main = RefName.make("refs/heads/main");

/** A verdict on the answer whose head is `head`. */
const verdictOn = (head: CommitSha) =>
  Verdict.make({
    ask: AskId.make("week-at-year-end"),
    at: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
    base: CommitSha.make("1".repeat(40)),
    checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
    head,
    heldBack: [],
    lanes: [
      {
        command: "bun test",
        durationMs: 1200,
        lane: LaneName.make("unit"),
        result: "passed",
      },
    ],
    outcome: Outcome.cases.Checking.make({ stage: "checks" }),
    patchId: PatchId.make("2".repeat(64)),
    project: ProjectName.make("datekit"),
    stage: "checks",
    tree: TreeSha.make("3".repeat(40)),
    verifier: "platform",
  });

const encodeVerdict = Schema.encodeEffect(Verdict);

/** The note's text as a verdict, encoded again: compared with what was written. */
const reencoded = (note: Option.Option<string>) =>
  Schema.decodeEffect(Schema.fromJsonString(Verdict))(
    Option.getOrElse(note, () => "")
  ).pipe(Effect.flatMap(encodeVerdict));

const now = DateTime.makeUnsafe("2026-10-07T12:30:00Z");

/** Two commits on `demo`'s main, the targets the notes are written on. */
const targets = Effect.gen(function* () {
  const repos = yield* RepoHost;
  const client = yield* gitClient(memoryFs());
  const first = yield* client.commit("first", [["a.ts", "1\n"]]);
  const second = yield* client.commit("second", [["a.ts", "2\n"]], [first]);

  yield* repos.create(repo);
  yield* repos.push(repo, client.source, [
    { from: Option.none(), ref: main, to: second },
  ]);

  return { first, second };
});

/**
 * The notes commit at `notesRef`, the names in its tree, and the note on
 * `target`: read through the port as plain git would find them.
 */
const notesThroughPort = (target: CommitSha) =>
  Effect.gen(function* () {
    const repos = yield* RepoHost;
    const tip = (yield* repos.refs(repo)).get(notesRef);

    if (tip === undefined) {
      return yield* Effect.die(`${notesRef} is not on ${repo}`);
    }

    const commit = Option.getOrThrow(yield* repos.readCommit(repo, tip));

    const entries = Option.getOrThrow(yield* repos.readTree(repo, commit.tree));

    const entry = entries.find(({ name }) => name === target);

    const blob =
      entry === undefined
        ? Option.none()
        : yield* repos.readBlob(repo, ObjectId.make(entry.sha));

    return {
      commit,
      names: entries.map(({ name }) => name),
      note: Option.map(blob, (bytes) => new TextDecoder().decode(bytes)),
    };
  });

/** Copies a scratch git directory onto disk, so git itself can read it. */
const onDisk = (source: ScratchSource) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const { promises } = source.fs;

    const copy = (path: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const stat = yield* Effect.promise(() => promises.stat(path));

        if (stat.isDirectory()) {
          const names = yield* Effect.promise(() => promises.readdir(path));

          yield* fs
            .makeDirectory(`${root}${path}`, { recursive: true })
            .pipe(Effect.orDie);
          yield* Effect.forEach(names, (name) => copy(`${path}/${name}`));

          return;
        }

        const bytes = yield* Effect.promise(() => promises.readFile(path));

        yield* fs
          .writeFile(
            `${root}${path}`,
            bytes instanceof Uint8Array
              ? bytes
              : new TextEncoder().encode(bytes)
          )
          .pipe(Effect.orDie);
      });

    yield* copy(source.gitdir);

    return `${root}${source.gitdir}`;
  });

describe("verdicts as git notes", () => {
  it.live(
    "writes a verdict as a JSON note that the port and git both read",
    () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const { first } = yield* targets;
        const verdict = verdictOn(first);

        const { commit, source } = yield* noteCommit({
          notesParent: Option.none(),
          now,
          repo,
          target: first,
          verdict,
        });

        expect(notesRef).toBe(`refs/notes/${Brand.slug}`);
        expect(
          yield* repos.push(repo, source, [
            { from: Option.none(), ref: notesRef, to: commit },
          ])
        ).toStrictEqual([RefOutcome.Updated({ ref: notesRef })]);

        const read = yield* notesThroughPort(first);

        expect({
          author: read.commit.author,
          committer: read.commit.committer,
          names: read.names,
          parents: read.commit.parents,
          sha: read.commit.sha,
        }).toStrictEqual({
          author: committerLine,
          committer: committerLine,
          names: [first],
          parents: [],
          sha: commit,
        });
        expect(yield* reencoded(read.note)).toStrictEqual(
          yield* encodeVerdict(verdict)
        );

        // git's own notes layout: `git notes show` finds the same note.
        const gitdir = yield* onDisk(source);

        expect(
          yield* gitOk(
            gitdir,
            `--git-dir=${gitdir}`,
            "notes",
            `--ref=${Brand.slug}`,
            "show",
            first
          )
        ).toBe(Option.getOrElse(read.note, () => "").trim());
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(RepoHostMemory, NodeServices.layer))
      ),
    20_000
  );

  it.live(
    "keeps every earlier note when it writes the next",
    () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const { first, second } = yield* targets;

        const one = yield* noteCommit({
          notesParent: Option.none(),
          now,
          repo,
          target: first,
          verdict: verdictOn(first),
        });

        yield* repos.push(repo, one.source, [
          { from: Option.none(), ref: notesRef, to: one.commit },
        ]);

        const two = yield* noteCommit({
          notesParent: Option.some(one.commit),
          now,
          repo,
          target: second,
          verdict: verdictOn(second),
        });

        expect(
          yield* repos.push(repo, two.source, [
            { from: Option.some(one.commit), ref: notesRef, to: two.commit },
          ])
        ).toStrictEqual([RefOutcome.Updated({ ref: notesRef })]);

        const read = yield* notesThroughPort(first);

        expect({
          names: new Set(read.names),
          parents: read.commit.parents,
        }).toStrictEqual({
          names: new Set([first, second]),
          parents: [one.commit],
        });
        expect(yield* reencoded(read.note)).toStrictEqual(
          yield* encodeVerdict(verdictOn(first))
        );

        // git lists both notes from the second notes commit's tree.
        const gitdir = yield* onDisk(two.source);

        const listed = yield* gitOk(
          gitdir,
          `--git-dir=${gitdir}`,
          "notes",
          `--ref=${Brand.slug}`,
          "list"
        );

        expect(
          new Set(listed.split("\n").map((line) => line.split(" ")[1]))
        ).toStrictEqual(new Set([first, second]));
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(RepoHostMemory, NodeServices.layer))
      ),
    20_000
  );
});
