import { NodeServices } from "@effect/platform-node";
import { Brand } from "@repo/brand";
import { formatLanding } from "@repo/git/trailers";
import { Verdict } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CheckVersion,
  CommitSha,
  Handle,
  LandedSha,
  PatchId,
  ProjectName,
  RepoName,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { sdkVersion } from "@repo/rules/rules-evaluator";
import { git, gitOk } from "@repo/testkit/git";
import {
  Config,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
} from "effect";

import { Box } from "../src/box.ts";
import { Layout } from "../src/lander/run.ts";
import { LocalBox } from "./local-box.ts";

export const project = RepoName.make("datekit");

export const fork = RepoName.make("datekit--parse-iso--bob");

export const bob = Handle.make("bob");

export const dora = Handle.make("dora");

export const requestId = RequestId.make("push-parse-iso-1");

/** The token every remote carries: no command line, result or log may show it. */
export const secret = "art_v1_0123456789abcdef0123456789abcdef01234567";

export const inRepo = (path: string) =>
  new URL(`../../../${path}`, import.meta.url).pathname;

export const sdk = {
  entry: inRepo("packages/sdk/src/index.ts"),
  modules: inRepo("packages/sdk/node_modules"),
};

export type Files = Readonly<Record<string, string | null>>;

export const message = formatLanding({
  assisted: [],
  credits: [
    { handle: dora, role: "Asked-by" },
    { handle: bob, role: "Signed-off-by" },
  ],
  requestId,
  subject: "Parse ISO weeks",
});

export const verdictOn = (input: {
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly tree: TreeSha;
}) =>
  Verdict.make({
    ask: AskId.make("parse-iso"),
    at: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
    base: input.base,
    checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
    head: input.head,
    heldBack: [],
    lanes: [],
    outcome: Outcome.cases.Checking.make({ stage: "checks" }),
    patchId: PatchId.make("2".repeat(64)),
    project: ProjectName.make("oscabriel/datekit"),
    stage: "checks",
    tree: input.tree,
    verifier: "platform",
  });

const refsOf = (repo: string) =>
  gitOk(repo, "for-each-ref", "--format=%(refname) %(objectname)");

const stateOf = (repo: string) =>
  Effect.all({
    objects: gitOk(repo, "count-objects", "-v"),
    refs: refsOf(repo),
  });

const revision = (repo: string, rev: string) =>
  Effect.map(
    git(repo, "rev-parse", "--verify", "--quiet", rev),
    ({ exitCode, stdout }) =>
      exitCode === 0 ? Option.some(stdout.trim()) : Option.none()
  );

const remote = (url: string) => ({ token: Redacted.make(secret), url });

export const world = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "lander-" });
  const canonical = path.join(root, "canonical.git");
  const forkDir = path.join(root, "fork.git");
  const clone = path.join(root, "clone");
  const work = path.join(root, "box");

  yield* gitOk(root, "init", "--quiet", "--bare", "-b", "main", canonical);
  yield* gitOk(root, "init", "--quiet", "--bare", "-b", "main", forkDir);
  yield* gitOk(root, "init", "--quiet", "-b", "main", clone);
  yield* fs.makeDirectory(work);

  const commit = (
    parent: CommitSha | undefined,
    files: Files,
    subject: string
  ) =>
    Effect.gen(function* () {
      yield* parent === undefined
        ? gitOk(clone, "checkout", "--quiet", "--orphan", "fresh")
        : gitOk(clone, "checkout", "--quiet", "--detach", parent);

      for (const [file, content] of Object.entries(files)) {
        const at = path.join(clone, file);

        if (content === null) {
          yield* gitOk(clone, "rm", "--quiet", "--", file);
        } else {
          yield* fs.makeDirectory(path.dirname(at), { recursive: true });
          yield* fs.writeFileString(at, content);
          yield* gitOk(clone, "add", "--", file);
        }
      }

      yield* gitOk(clone, "commit", "--quiet", "--allow-empty", "-m", subject);

      return CommitSha.make(yield* gitOk(clone, "rev-parse", "HEAD"));
    });

  const push = (repo: string, sha: CommitSha, ref = "refs/heads/main") =>
    gitOk(clone, "push", "--quiet", "--force", repo, `${sha}:${ref}`);

  const blobAt = (at: CommitSha, file: string) =>
    Effect.map(gitOk(clone, "rev-parse", `${at}:${file}`), (blob) =>
      BlobSha.make(blob)
    );

  const mergedTree = (ours: CommitSha, theirs: CommitSha) =>
    Effect.gen(function* () {
      yield* gitOk(clone, "checkout", "--quiet", "--detach", ours);
      yield* gitOk(clone, "merge", "--quiet", "--no-edit", theirs);

      return TreeSha.make(yield* gitOk(clone, "rev-parse", "HEAD^{tree}"));
    });

  return {
    blobAt,
    canonical,
    clone,
    commit,
    fork: forkDir,
    mergedTree,
    push,
    refsOf,
    remote,
    revision,
    stateOf,
    work,
  };
});

export type World = Effect.Success<typeof world>;

const start = {
  "README.md": "datekit\n",
  "src/date.ts":
    "export const year = 1;\nexport const month = 2;\nexport const day = 3;\n",
} satisfies Files;

/**
 * datekit's history: `base` on both repos, then main changed `day` while
 * bob's answer on the fork changed `year` and added a test, and a second
 * answer changed `day` too, which conflicts.
 */
export const diverged = (repos: World) =>
  Effect.gen(function* () {
    const base = yield* repos.commit(undefined, start, "Start");

    yield* repos.push(repos.canonical, base);
    yield* repos.push(repos.fork, base);

    const main = yield* repos.commit(
      base,
      {
        "src/date.ts":
          "export const year = 1;\nexport const month = 2;\nexport const day = 30;\n",
      },
      "Widen days"
    );

    yield* repos.push(repos.canonical, main);

    const head = yield* repos.commit(
      base,
      {
        "src/date.ts":
          "export const year = 10;\nexport const month = 2;\nexport const day = 3;\n",
        "test/iso.test.ts": "expect(week(1)).toBe(1);\n",
      },
      "Parse ISO weeks"
    );

    yield* repos.push(repos.fork, head);

    const clash = yield* repos.commit(
      base,
      {
        "src/date.ts":
          "export const year = 1;\nexport const month = 2;\nexport const day = 31;\n",
      },
      "Change days too"
    );

    yield* repos.push(repos.fork, clash, "refs/heads/clash");

    return { base, clash, head, main: LandedSha.make(main) };
  });

export const landedRefName = `${Brand.refsPrefix}landed`;

export const layout = (work: string) =>
  Layer.effect(
    Layout,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const version = path.join(path.dirname(work), "sdk-version");

      yield* fs.writeFileString(version, `${sdkVersion}\n`);

      return {
        path: yield* Config.String("PATH"),
        sdk: { ...sdk, version },
        work,
      };
    }).pipe(Effect.orDie)
  ).pipe(Layer.provide(NodeServices.layer));

export const box = (
  work: string,
  wrap: (inner: Box["Service"]) => Box["Service"] = (inner) => inner
) =>
  Layer.mergeAll(
    Layer.effect(Box, Box.useSync(wrap)).pipe(Layer.provide(LocalBox)),
    layout(work)
  );

export const TestServices = NodeServices.layer;

export const config = (file: string) => `${Brand.configDir}/${file}`;

/** The ask's check imports a test runner the Lander never has. */
export const configFolder = {
  [config("asks/parse-iso.ask.ts")]: [
    'import { kinds, territory } from "@repo/sdk";',
    "",
    "export default kinds.fix.ask({",
    '  path: "test/iso.test.ts",',
    '  territory: territory.paths("src/date.ts"),',
    '  want: "Parse ISO weeks",',
    "});",
    "",
  ].join("\n"),
  [config("asks/parse-iso.check.ts")]: [
    'import { expect, it } from "vitest";',
    "",
    'it("parses ISO weeks", () => expect(1).toBe(1));',
    "",
  ].join("\n"),
  [config("people.ts")]:
    'export const deciders = { "**": ["dora"] } as const;\n',
  [config("project.ts")]: [
    `import { project } from "${Brand.cliPackage}/rules";`,
    "",
    'import { deciders } from "./people.ts";',
    "",
    "export default project({",
    "  admit: (claimant) => claimant.vouched && claimant.record > 1,",
    '  budget: { decisionsPerDay: 3, expire: "7 days" },',
    "  deciders,",
    "});",
    "",
  ].join("\n"),
  [config("visibility.ts")]: [
    `import { layer, sealedChecks, visibility } from "${Brand.cliPackage}/rules";`,
    "",
    "export default visibility({",
    '  checks: sealedChecks({ areas: { parse: "src/date.ts" } }),',
    "  layers: {",
    '    maintainers: layer({ disclose: "sealed", holds: ["checks"], reason: "Held-back checks" }),',
    "  },",
    "});",
    "",
  ].join("\n"),
  [config("vouched.td")]: "dora\nbob\n",
} satisfies Files;

export const startedWith = (repos: World, files: Files) =>
  Effect.gen(function* () {
    const at = yield* repos.commit(undefined, { ...start, ...files }, "Start");

    yield* repos.push(repos.canonical, at);

    return LandedSha.make(at);
  });

export const bundleWire = (repos: World, at: LandedSha) => ({
  job: { at, repo: project },
  main: repos.remote(repos.canonical),
});
