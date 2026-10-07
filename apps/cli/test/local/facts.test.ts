import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import { Brand } from "@repo/brand";
import { PushTarget } from "@repo/gate/facts";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  TreeSha,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { defaultPolicyInput } from "@repo/rules/defaults";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { localFacts } from "../../src/local/facts.ts";
import { ConfigBundlerBun, localPolicy } from "../../src/local/local-policy.ts";
import {
  aCheckRepo,
  ask,
  commit,
  handle,
  policyFile,
  policyText,
  project,
} from "./fixture.ts";
import type { CheckRepo } from "./fixture.ts";

const about = {
  initializer: Handle.make(handle),
  project: ProjectName.make(project),
};

/** The policy at `main`, with this CLI's own bundler for a TypeScript folder. */
const policyAt = (root: string) =>
  localPolicy(root, "main", about).pipe(Effect.provide(ConfigBundlerBun));

const pusher = Person.make({ handle: Handle.make(handle) });

const target = PushTarget.ClaimFork({
  ask: AskId.make(ask),
  claimant: Handle.make(handle),
  project: ProjectName.make(project),
});

/** A `Fetch` for a host that reaches nothing over the network. */
const offline = Layer.succeed(Fetch)({
  fetch: (request) =>
    Effect.fail(new FetchFailed({ reason: "offline", url: request.url })),
});

/**
 * `@repo/git`'s change list and added lines from the merge base of `main`
 * and `head` to `head`, over a bare copy of the repo that `RepoHost`
 * `/local` opens as it opens any repo it hosts.
 */
const gitSays = (repo: CheckRepo, head: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hosted = yield* fs.makeTempDirectoryScoped();
    const name = RepoName.make(project);

    yield* gitOk(
      repo.root,
      "clone",
      "--bare",
      "--quiet",
      repo.root,
      path.join(hosted, `${name}.git`)
    );

    const base = yield* gitOk(repo.root, "merge-base", "main", head);

    const treeOf = (sha: string) =>
      RepoHost.use((repos) => repos.readCommit(name, CommitSha.make(sha))).pipe(
        Effect.flatMap(Effect.fromOption),
        Effect.map(({ tree }) => TreeSha.make(tree))
      );

    return yield* Effect.gen(function* () {
      const changes = yield* treeDiff(
        name,
        yield* treeOf(base),
        yield* treeOf(head)
      );

      return { addedLines: yield* addedLines(name, changes), changes };
    }).pipe(
      Effect.provide(
        RepoHostLocal.layer({ remoteBase: "http://unused", root: hosted }).pipe(
          Layer.provide(offline)
        )
      )
    );
  });

describe(localFacts, () => {
  it.live(
    "gives the change list and added lines @repo/git gives from the merge base of main and HEAD",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;
        const policy = yield* policyAt(repo.root);

        const facts = yield* localFacts({
          ask: Option.none(),
          base: "main",
          claim: Option.none(),
          claimsHeld: 0,
          head: "HEAD",
          policy,
          pusher,
          root: repo.root,
          target,
        });

        const expected = yield* gitSays(repo, repo.straying);

        expect(facts.changes).toStrictEqual(expected.changes);
        expect(facts.addedLines).toStrictEqual(expected.addedLines);
        expect(facts.base).toBe(repo.main);
        expect(facts.head).toBe(repo.straying);
        expect(facts.landed).toBe(LandedSha.make(repo.main));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "reads a repo whose objects live in another, through a bare copy",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repo = yield* aCheckRepo;
        const policy = yield* policyAt(repo.root);
        const shared = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

        // `--shared` keeps the objects in the original: isomorphic-git, under
        // `/local`, reads no alternates.
        yield* gitOk(shared, "clone", "--shared", "--quiet", repo.root, ".");
        yield* gitOk(shared, "checkout", "--quiet", repo.straying);

        const facts = yield* localFacts({
          ask: Option.none(),
          base: "origin/main",
          claim: Option.none(),
          claimsHeld: 0,
          head: "HEAD",
          policy,
          pusher,
          root: shared,
          target,
        });

        const expected = yield* gitSays(repo, repo.straying);

        expect(facts.changes).toStrictEqual(expected.changes);
        expect(facts.addedLines).toStrictEqual(expected.addedLines);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe(localPolicy, () => {
  it.live("reads the config folder's policy.json at main, not at HEAD", () =>
    Effect.gen(function* () {
      const repo = yield* aCheckRepo;

      yield* commit(
        repo.root,
        {
          [policyFile]: (yield* policyText).replace(
            '"bad": "false"',
            '"worse": "false"'
          ),
        },
        "Drop the failing lane"
      );

      const policy = yield* policyAt(repo.root);

      expect(policy.at).toBe(repo.main);
      expect(policy.source).toBe("config");
      expect(policy.run).toStrictEqual({
        checks: { bad: "false", ok: "true" },
        test: "true {path}",
      });
      expect(
        policy.asks.map(({ id, project: of, territory }) => ({
          id,
          of,
          territory,
        }))
      ).toStrictEqual([
        {
          id: ask,
          of: project,
          territory: {
            module: "a",
            paths: ["packages/a/**"],
            publicFiles: ["packages/a/src/a.ts"],
          },
        },
      ]);
      expect(policy.modules).toStrictEqual([
        {
          module: "a",
          paths: ["packages/a/**"],
          publicFiles: ["packages/a/src/a.ts"],
        },
        { module: "b", paths: ["packages/b/**"] },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("gives the defaults when main has no config folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

      yield* gitOk(root, "init", "--quiet", "--initial-branch", "main");

      const main = yield* commit(
        root,
        {
          "package.json": JSON.stringify({
            name: "plain",
            scripts: { test: "vitest run" },
          }),
        },
        "Start"
      );

      const policy = yield* policyAt(root);

      expect(policy.at).toBe(main);
      expect(policy.source).toBe("defaults");
      expect(policy.asks).toStrictEqual([]);
      expect({ caps: policy.caps, kinds: policy.kinds }).toStrictEqual({
        caps: defaultPolicyInput.caps,
        kinds: defaultPolicyInput.kinds,
      });
      expect(policy.modules).toStrictEqual([{ module: ".", paths: ["**"] }]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "holds the config folder as the Lander bundles it: regular files, and no code it leaves out",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

        yield* gitOk(root, "init", "--quiet", "--initial-branch", "main");
        yield* fs.makeDirectory(path.join(root, Brand.configDir));

        // A policy.json that is a link, and a helper no entry imports: the
        // Lander's bundle holds neither, so the project runs on the defaults.
        yield* fs.symlink("../policy.json", path.join(root, policyFile));

        yield* commit(
          root,
          {
            [`${Brand.configDir}/helper.tsx`]: "export const helper = 1;\n",
            "package.json": JSON.stringify({
              name: "plain",
              scripts: { test: "vitest run" },
            }),
            "policy.json": "{}\n",
          },
          "Start"
        );

        const source = yield* policyAt(root).pipe(
          Effect.map((policy) => policy.source),
          Effect.catchTag("RulesFailed", ({ detail }) => Effect.succeed(detail))
        );

        expect(source).toBe("defaults");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "evaluates a TypeScript config folder at main, bundled with this CLI's own sdk",
    () =>
      Effect.gen(function* () {
        const repo = yield* aCheckRepo;

        yield* gitOk(repo.root, "checkout", "--quiet", "main");

        const main = yield* commit(
          repo.root,
          {
            [`${Brand.configDir}/project.ts`]: [
              `import { project } from "${Brand.cliPackage}/rules";`,
              "",
              "export default project({",
              '  run: { checks: { unit: "true" }, test: "true {path}" },',
              "});",
              "",
            ].join("\n"),
          },
          "Write the project in TypeScript"
        );

        const policy = yield* policyAt(repo.root);

        expect(policy.at).toBe(main);
        expect(policy.run).toStrictEqual({
          checks: { unit: "true" },
          test: "true {path}",
        });
        expect(policy.asks).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
