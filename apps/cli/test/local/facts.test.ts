import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import { Brand } from "@repo/brand";
import { isJudged, judgeClosure } from "@repo/checks/judge";
import { PushTarget } from "@repo/gate/facts";
import { addedLines, treeDiff } from "@repo/git/tree-diff";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  keyOf,
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
    const name = RepoName.make(keyOf(project));

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

/**
 * A tree whose judge reaches past the root and the CI folders, as
 * `packages/project/test/facts.test.ts` gives the platform: lefthook runs a
 * shell script that runs a hook script with a helper, Claude Code's settings
 * run `scripts/hooks/shell-policy.ts`, a package's tsconfig extends the base
 * and a file of its own, oxlint loads a plugin that imports a helper, and a
 * test outside the plugin's folder names it.
 */
const wideTree = {
  ".claude/settings.json": JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { command: "bun scripts/hooks/shell-policy.ts", type: "command" },
          ],
        },
      ],
    },
  }),
  "lefthook.yml":
    "pre-commit:\n  commands:\n    guard:\n      run: sh scripts/pre-commit.sh\n",
  "oxlint.config.ts":
    'export default { jsPlugins: ["./tools/lint/plugin.ts"] };\n',
  "package.json": JSON.stringify({
    name: "kit",
    scripts: { test: "vitest run" },
    workspaces: ["packages/*"],
  }),
  "packages/a/build.json": JSON.stringify({ compilerOptions: {} }),
  "packages/a/package.json": JSON.stringify({ name: "@kit/a" }),
  "packages/a/src/index.ts": "export const a = 1;\n",
  "packages/a/tsconfig.json": JSON.stringify({
    extends: ["../../tsconfig.base.json", "./build.json"],
  }),
  "scripts/hooks/guard.ts":
    'import { policy } from "./lib/policy.ts";\n\npolicy();\n',
  "scripts/hooks/lib/policy.ts": "export const policy = () => 0;\n",
  "scripts/hooks/shell-policy.ts": "export {};\n",
  "scripts/pre-commit.sh": "#!/bin/sh\nbun scripts/hooks/guard.ts\n",
  "src/app.ts": 'import { a } from "@kit/a";\n\nexport const app = a;\n',
  "test/plugin-cases.test.ts":
    'import plugin from "../tools/lint/plugin.ts";\n\nplugin;\n',
  "tools/lint/helper.ts": "export const rule = {};\n",
  "tools/lint/plugin.ts":
    'import { rule } from "./helper.ts";\n\nexport default { rules: { rule } };\n',
  "tsconfig.base.json": JSON.stringify({ compilerOptions: {} }),
} as const satisfies Readonly<Record<string, string>>;

describe(localPolicy, () => {
  it.live(
    "judges by the closure every file at main gives: hook scripts, the tsconfig chain, plugin imports and rule fixture tests",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());

        yield* gitOk(root, "init", "--quiet", "--initial-branch", "main");
        yield* commit(root, wideTree, "Start");

        const policy = yield* policyAt(root);

        const every = judgeClosure(
          policy.run,
          Object.entries(wideTree).map(([path, content]) => ({ content, path }))
        );

        expect(policy.judge).toStrictEqual({
          paths: every.paths,
          pointers: every.pointers,
        });
        expect(
          [
            "scripts/pre-commit.sh",
            "scripts/hooks/guard.ts",
            "scripts/hooks/lib/policy.ts",
            "scripts/hooks/shell-policy.ts",
            "packages/a/build.json",
            "tools/lint/helper.ts",
            "test/plugin-cases.test.ts",
          ].filter((path) => !isJudged(policy.judge, path))
        ).toStrictEqual([]);
        expect(policy.modules).toStrictEqual([
          { module: "@kit/a", paths: ["packages/a/**"] },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

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
