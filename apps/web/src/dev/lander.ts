// The scripted `/memory` Lander answers in a fixed order, which a world people click through can't follow,
// so this one does the work over the memory repo host.
import { RefName, RefOutcome, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { composeRef, Lander, landedRef, Rebuild } from "@repo/project/lander";
import type { Change, LandJob } from "@repo/project/lander";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { LandedSha, RepoPath, TreeSha } from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { sdkVersion } from "@repo/rules/rules-evaluator";
import { Array, DateTime, Effect, Layer, Option, Ref } from "effect";

import {
  filesAt,
  overlay,
  personIdentity,
  platformIdentity,
  scratch,
  textOf,
} from "./git.ts";
import type { Files, Snapshot } from "./git.ts";

const mainRef = RefName.make("refs/heads/main");

const blocked = () => new VerifierBlocked({});

const read = (repo: RepoName, commit: CommitSha) =>
  filesAt(repo, commit).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.mapError(blocked)
  );

const changesOf = (base: Snapshot, head: Snapshot): readonly Change[] =>
  Array.dedupe([...base.keys(), ...head.keys()])
    .toSorted()
    .flatMap((path): readonly Change[] => {
      const before = base.get(path);
      const after = head.get(path);
      const at = RepoPath.make(path);

      if (before === undefined) {
        return after === undefined
          ? []
          : [{ after: after.blob, path: at, status: "added" }];
      }

      if (after === undefined) {
        return [{ before: before.blob, path: at, status: "deleted" }];
      }

      return before.blob === after.blob
        ? []
        : [
            {
              after: after.blob,
              before: before.blob,
              path: at,
              status: "modified",
            },
          ];
    });

const merged = (input: {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly fork: RepoName;
  readonly base: CommitSha;
  readonly head: CommitSha;
}) =>
  Effect.gen(function* () {
    const base = yield* read(input.fork, input.base);
    const head = yield* read(input.fork, input.head);
    const main = yield* read(input.repo, input.main);
    const changes = changesOf(base, head);

    // Main moved this path since the answer's base, to something else.
    const conflicts = changes.flatMap(({ path }) =>
      main.get(path)?.blob !== base.get(path)?.blob &&
      main.get(path)?.blob !== head.get(path)?.blob
        ? [path]
        : []
    );

    if (Array.isReadonlyArrayNonEmpty(conflicts)) {
      return yield* new StaleBase({
        base: input.base,
        conflicts,
        main: input.main,
      });
    }

    const files = new Map(textOf(main));

    for (const { path } of changes) {
      const text = head.get(path)?.text;

      if (text === undefined) {
        files.delete(path);
      } else {
        files.set(path, text);
      }
    }

    return { changes, files: files satisfies Files };
  });

const rebuilt = (job: LandJob) =>
  Rebuild.$match(job.rebuild, {
    Compose: ({ files }) =>
      Effect.map(read(job.repo, job.main), (main) =>
        overlay(
          textOf(main),
          files.map(({ content, path }) => [path, content] as const)
        )
      ),
    Existing: ({ commit }) => Effect.map(read(job.repo, commit), textOf),
    Merge: ({ base, fork, head }) =>
      Effect.map(
        merged({ base, fork, head, main: job.main, repo: job.repo }),
        ({ files }) => files
      ),
  });

const baseOf = (job: LandJob) =>
  Rebuild.$is("Merge")(job.rebuild) ? job.rebuild.base : job.main;

export const DevLander: Layer.Layer<Lander, never, RepoHost> = Layer.effect(
  Lander,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const provided = Effect.provideService(RepoHost, host);

    // A request landed before: its commit, so a second land returns it.
    const landedBy = yield* Ref.make<ReadonlyMap<string, LandedSha>>(new Map());

    const tipOf = (repo: RepoName, ref: RefName) =>
      host.refs(repo).pipe(
        Effect.map((refs) => Option.fromNullishOr(refs.get(ref))),
        Effect.mapError(blocked)
      );

    const land = (job: LandJob) =>
      Effect.gen(function* () {
        const before = (yield* Ref.get(landedBy)).get(job.requestId);

        if (before !== undefined) {
          return { pending: [], sha: before };
        }

        const tip = yield* tipOf(job.repo, mainRef);

        if (!Option.contains(tip, job.main)) {
          return yield* new StaleBase({
            base: baseOf(job),
            conflicts: [],
            main: Option.getOrElse(tip, () => job.main),
          });
        }

        const into = yield* scratch;
        const tree = yield* into.tree(yield* rebuilt(job));

        if (TreeSha.make(tree) !== job.tree) {
          return yield* blocked();
        }

        const commit = yield* into.commit({
          at: yield* DateTime.now,
          author: personIdentity(job.author),
          committer: platformIdentity,
          message: job.message,
          parents: [job.main],
          tree,
        });

        // Never forced: if main moved since `job.main`, the push is refused.
        const [outcome] = yield* host
          .push(job.repo, into.source, [
            { from: Option.some(job.main), ref: mainRef, to: commit },
          ])
          .pipe(
            Effect.catchTags({
              HostBusy: () => Effect.fail(new RepoBusy({})),
              RepoNotFound: () => Effect.fail(blocked()),
            })
          );

        if (outcome === undefined || !RefOutcome.$is("Updated")(outcome)) {
          return yield* new StaleBase({
            base: baseOf(job),
            conflicts: [],
            main: job.main,
          });
        }

        const sha = LandedSha.make(commit);

        yield* Ref.update(landedBy, (all) =>
          new Map(all).set(job.requestId, sha)
        );

        // The mirror follows main in a push of its own.
        const mirror = yield* tipOf(job.repo, landedRef);

        yield* host
          .push(job.repo, into.source, [
            { from: mirror, ref: landedRef, to: commit },
          ])
          .pipe(Effect.ignore);

        return { pending: [], sha };
      });

    return Lander.of({
      bundleRules: ({ at, repo }) =>
        provided(
          Effect.map(read(repo, at), (files) => ({
            entry: `${Brand.configDir}/project.ts`,
            modules: Object.fromEntries(
              [...textOf(files)].filter(([path]) =>
                path.startsWith(`${Brand.configDir}/`)
              )
            ),
            sdkVersion,
          }))
        ),
      compose: ({ files, main, repo }) =>
        provided(
          Effect.gen(function* () {
            const onMain = yield* read(repo, main);
            const into = yield* scratch;

            const tree = yield* into.tree(
              overlay(
                textOf(onMain),
                files.map(({ content, path }) => [path, content] as const)
              )
            );

            const commit = yield* into.commit({
              at: yield* DateTime.now,
              author: platformIdentity,
              committer: platformIdentity,
              message: "Compose files onto main for a check",
              parents: [main],
              tree,
            });

            const ref = composeRef(TreeSha.make(tree));
            const existing = yield* tipOf(repo, ref);

            if (!Option.contains(existing, commit)) {
              yield* host
                .push(repo, into.source, [{ from: existing, ref, to: commit }])
                .pipe(Effect.mapError(blocked));
            }

            return { commit, tree: TreeSha.make(tree) };
          })
        ),
      land: (job) => provided(land(job)),
      merge: (job) =>
        provided(
          Effect.gen(function* () {
            const { changes, files } = yield* merged(job);
            const into = yield* scratch;

            return { changes, tree: TreeSha.make(yield* into.tree(files)) };
          })
        ),
    });
  })
);
