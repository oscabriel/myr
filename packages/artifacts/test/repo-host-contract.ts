import { describe, expect, it } from "@effect/vitest";
import { RepoPath } from "@repo/protocol/ids";
import { DateTime, Duration, Effect, Option, Redacted } from "effect";
import type { Layer } from "effect";

import {
  BranchName,
  RefName,
  RefOutcome,
  RepoExists,
  RepoHost,
  RepoName,
  RepoNotFound,
  Revision,
} from "../src/repo-host.ts";
import { gitClient } from "./git-client.ts";

const main = RefName.make("refs/heads/main");

const landed = RefName.make("refs/asked/landed");

const notes = RefName.make("refs/notes/commits");

const path = RepoPath.make("src/a.ts");

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * What every RepoHost adapter must do, written against the port. `/memory`
 * runs it on every `verify`; `/binding` runs it against live Artifacts.
 */
export const describeRepoHost = (
  adapter: string,
  host: Layer.Layer<RepoHost>
) => {
  describe(`RepoHost over ${adapter}`, () => {
    it.effect("reads a file at a branch and at an older commit", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("v1", [["src/a.ts", "v1"]]);

        const second = yield* client.commit(
          "v2",
          [["src/a.ts", "v2"]],
          [first]
        );

        const name = RepoName.make("reads");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: second },
        ]);

        const at = (revision: Revision) =>
          repos
            .readFile(name, revision, path)
            .pipe(Effect.map(Option.map(text)));

        expect(
          yield* at(Revision.Branch({ name: BranchName.make("main") }))
        ).toStrictEqual(Option.some("v2"));
        expect(yield* at(Revision.Commit({ sha: first }))).toStrictEqual(
          Option.some("v1")
        );
        expect(
          yield* at(Revision.Branch({ name: BranchName.make("absent") }))
        ).toStrictEqual(Option.none());
      }).pipe(Effect.provide(host))
    );

    it.effect("logs first parents from a revision, newest first", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("first", [["a", "1"]]);
        const side = yield* client.commit("side", [["b", "1"]]);

        const merge = yield* client.commit(
          "merge",
          [["a", "2"]],
          [first, side]
        );

        const name = RepoName.make("history");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: merge },
        ]);

        const messages = (at: Revision, limit: number) =>
          repos
            .log(name, at, limit)
            .pipe(
              Effect.map((commits) => commits.map((commit) => commit.message))
            );

        const tip = Revision.Branch({ name: BranchName.make("main") });

        expect(yield* messages(tip, 10)).toStrictEqual(["merge", "first"]);
        expect(yield* messages(tip, 1)).toStrictEqual(["merge"]);
        expect(
          yield* messages(Revision.Commit({ sha: side }), 10)
        ).toStrictEqual(["side"]);
        expect(
          yield* messages(
            Revision.Branch({ name: BranchName.make("absent") }),
            10
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(host))
    );

    // S1 #6: Artifacts refuses `--atomic`, so landing pushes main by itself and
    // treats each ref's outcome on its own.
    it.effect("applies each ref's compare-and-swap on its own", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("first", [["a", "1"]]);
        const second = yield* client.commit("second", [["a", "2"]], [first]);
        const name = RepoName.make("compare-and-swap");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
          { from: Option.none(), ref: landed, to: first },
        ]);

        const outcomes = yield* repos.push(name, client.source, [
          { from: Option.some(first), ref: main, to: second },
          { from: Option.some(second), ref: landed, to: second },
        ]);

        expect(outcomes).toStrictEqual([
          RefOutcome.Updated({ ref: main }),
          RefOutcome.Stale({ ref: landed, tip: Option.some(first) }),
        ]);
        expect(
          yield* repos.log(
            name,
            Revision.Branch({ name: BranchName.make("main") }),
            1
          )
        ).toMatchObject([{ sha: second }]);
      }).pipe(Effect.provide(host))
    );

    it.effect("refuses to create a ref that already exists", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("first", [["a", "1"]]);
        const other = yield* client.commit("other", [["a", "x"]]);
        const name = RepoName.make("create-only");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
        ]);

        expect(
          yield* repos.push(name, client.source, [
            { from: Option.none(), ref: main, to: other },
          ])
        ).toStrictEqual([
          RefOutcome.Stale({ ref: main, tip: Option.some(first) }),
        ]);
      }).pipe(Effect.provide(host))
    );

    // S1 #10 and #19: a fork shares what it inherited and nothing a sibling
    // adds later.
    it.effect("keeps each fork's own commits to itself", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("first", [["a", "1"]]);
        const onlyA = yield* client.commit("only in a", [["a", "a"]], [first]);
        const base = RepoName.make("fork-base");
        const forkA = RepoName.make("fork-a");
        const forkB = RepoName.make("fork-b");

        yield* repos.create(base);
        yield* repos.push(base, client.source, [
          { from: Option.none(), ref: main, to: first },
        ]);
        yield* repos.fork(base, forkA);
        yield* repos.fork(base, forkB);
        yield* repos.push(forkA, client.source, [
          { from: Option.some(first), ref: main, to: onlyA },
        ]);

        const has = (name: RepoName, sha: typeof first) =>
          repos.readCommit(name, sha).pipe(Effect.map(Option.isSome));

        expect(yield* has(forkA, onlyA)).toBeTruthy();
        expect(yield* has(forkB, onlyA)).toBeFalsy();
        expect(yield* has(base, onlyA)).toBeFalsy();
        expect(yield* has(forkB, first)).toBeTruthy();
        expect(
          yield* repos.log(
            forkB,
            Revision.Branch({ name: BranchName.make("main") }),
            10
          )
        ).toMatchObject([{ sha: first }]);
      }).pipe(Effect.provide(host))
    );

    // S1 #7 and #20: custom refs are kept and listed, but the binding's reads
    // resolve branch names only, so the platform reads them from this list.
    it.effect("lists custom refs that no read can name", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient;
        const first = yield* client.commit("first", [["a", "1"]]);
        const name = RepoName.make("custom-refs");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
          { from: Option.none(), ref: landed, to: first },
          { from: Option.none(), ref: notes, to: first },
        ]);

        expect(yield* repos.refs(name)).toStrictEqual(
          new Map([
            [landed, first],
            [main, first],
            [notes, first],
          ])
        );
        expect(
          yield* repos.readFile(
            name,
            Revision.Branch({ name: BranchName.make("asked/landed") }),
            RepoPath.make("a")
          )
        ).toStrictEqual(Option.none());
      }).pipe(Effect.provide(host))
    );

    it.effect("names the repo it could not find or could not create", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const taken = RepoName.make("taken");
        const missing = RepoName.make("missing");

        yield* repos.create(taken);

        expect(yield* Effect.flip(repos.create(taken))).toStrictEqual(
          new RepoExists({ name: taken })
        );
        expect(yield* Effect.flip(repos.fork(missing, taken))).toStrictEqual(
          new RepoNotFound({ name: missing })
        );
        expect(yield* Effect.flip(repos.fork(taken, taken))).toStrictEqual(
          new RepoExists({ name: taken })
        );
        expect(yield* Effect.flip(repos.refs(missing))).toStrictEqual(
          new RepoNotFound({ name: missing })
        );
      }).pipe(Effect.provide(host))
    );

    it.effect(
      "mints a token that expires after its ttl, and revokes it once",
      () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("tokens");

          yield* repos.create(name);

          const now = yield* DateTime.now;
          const token = yield* repos.mintToken(name, "read", Duration.hours(1));

          expect(token.scope).toBe("read");
          expect(Redacted.value(token.secret)).not.toBe("");
          expect(token.expiresAt).toStrictEqual(
            DateTime.add(now, { hours: 1 })
          );
          expect(yield* repos.revokeToken(name, token.id)).toBeTruthy();
          expect(yield* repos.revokeToken(name, token.id)).toBeFalsy();
        }).pipe(Effect.provide(host))
    );

    it.effect("removes a repo once, freeing its name", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("removed");

        yield* repos.create(name);
        expect(yield* repos.remote(name)).not.toBe("");
        expect(yield* repos.remove(name)).toBeTruthy();
        expect(yield* repos.remove(name)).toBeFalsy();
        expect(yield* Effect.flip(repos.remote(name))).toStrictEqual(
          new RepoNotFound({ name })
        );
        expect(
          yield* repos.refs((yield* repos.create(name)).name)
        ).toStrictEqual(new Map());
      }).pipe(Effect.provide(host))
    );
  });
};
