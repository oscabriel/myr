import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { MergeExit, MergeWire, Rebuild } from "@repo/project/lander/wire";
import { Verdict } from "@repo/protocol/domain/answer";
import { CommitSha, LandedSha, RepoPath } from "@repo/protocol/ids";
import type { TreeSha } from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { sdkVersion } from "@repo/rules/rules-evaluator";
import { gitOk } from "@repo/testkit/git";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Predicate,
  Queue,
  Redacted,
  Schema,
  Semaphore,
} from "effect";

import { Box } from "../src/box.ts";
import { Lander, landerJobs, runMerge } from "../src/lander.ts";
import { bundleRules, compose, land, merge } from "../src/lander/run.ts";
import { landScript, mergeScript } from "../src/lander/script.ts";
import {
  bob,
  box,
  bundleWire,
  config,
  configFolder,
  diverged,
  fork,
  inRepo,
  landedRefName,
  message,
  project,
  requestId,
  sdk,
  secret,
  startedWith,
  TestServices,
  verdictOn,
  world,
} from "./lander.fixtures.ts";
import type { Files, World } from "./lander.fixtures.ts";

const mergeWire = (
  repos: World,
  job: {
    readonly base: CommitSha;
    readonly head: CommitSha;
    readonly main: LandedSha;
  }
) => ({
  fork: repos.remote(repos.fork),
  job: { ...job, fork, repo: project },
  main: repos.remote(repos.canonical),
});

const landWire = (
  repos: World,
  job: {
    readonly base: CommitSha;
    readonly head: CommitSha;
    readonly main: LandedSha;
    readonly tree: TreeSha;
  }
) => ({
  fork: repos.remote(repos.fork),
  job: {
    author: bob,
    main: job.main,
    message,
    rebuild: Rebuild.cases.Merge.make({ base: job.base, fork, head: job.head }),
    repo: project,
    requestId,
    tree: job.tree,
    verdict: Option.some(verdictOn(job)),
  },
  main: repos.remote(repos.canonical),
});

const commitIn = (repo: string, sha: string) =>
  Effect.gen(function* () {
    const shown = yield* gitOk(
      repo,
      "show",
      "--no-patch",
      "--format=%an <%ae>%n%cn <%ce>%n%P%n%T",
      sha
    );

    const [author, committer, parents, tree] = shown.split("\n");
    const raw = yield* gitOk(repo, "cat-file", "commit", sha);

    return {
      author,
      committer,
      message: raw.slice(raw.indexOf("\n\n") + 2),
      parents: parents?.split(" "),
      tree,
    };
  });

const decodeNote = Schema.decodeEffect(Schema.fromJsonString(Verdict));

const pushesMain = (argv: readonly string[]) =>
  argv.includes("push") && argv.at(-1)?.endsWith(":refs/heads/main") === true;

const beforeMainIsPushed =
  (first: Effect.Effect<void>) =>
  (inner: Box["Service"]): Box["Service"] => ({
    ...inner,
    exec: (argv, options) =>
      pushesMain(argv)
        ? Effect.andThen(first, inner.exec(argv, options))
        : inner.exec(argv, options),
  });

const movedBy = (repos: World, parent: CommitSha) =>
  Effect.gen(function* () {
    const other = yield* repos.commit(
      parent,
      { "README.md": "datekit, by someone else\n" },
      "Retitle the readme"
    );

    yield* repos.push(repos.canonical, other);

    return other;
  });

interface Handed {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

const recording =
  (handed: Handed[]) =>
  (inner: Box["Service"]): Box["Service"] => ({
    ...inner,
    exec: (argv, options = {}) =>
      Effect.andThen(
        Effect.sync(() => handed.push({ argv, env: { ...options.env } })),
        inner.exec(argv, options)
      ),
  });

const mirrorRefused = (inner: Box["Service"]): Box["Service"] => ({
  ...inner,
  exec: (argv, options) =>
    argv.at(-1)?.endsWith(`:${landedRefName}`) === true
      ? Effect.succeed({
          exitCode: 1,
          stderr: "error: failed to push some refs\n",
          stdout: `!\t${argv.at(-1) ?? ""}\t[remote rejected] (refused)\nDone\n`,
        })
      : inner.exec(argv, options),
});

/** A busy Artifacts answers one side-band error packet and no report. */
const busyOnMain = (inner: Box["Service"]): Box["Service"] => ({
  ...inner,
  exec: (argv, options) =>
    pushesMain(argv)
      ? Effect.succeed({
          exitCode: 128,
          stderr:
            "remote: artifacts_git_receive_pack_busy\n\nfatal: the remote end hung up unexpectedly\nerror: failed to push some refs\n",
          stdout: "",
        })
      : inner.exec(argv, options),
});

const mainDeclined = (inner: Box["Service"]): Box["Service"] => ({
  ...inner,
  exec: (argv, options) =>
    pushesMain(argv)
      ? Effect.succeed({
          exitCode: 1,
          stderr: `remote: no push for ${secret}\nerror: failed to push some refs\n`,
          stdout: `!\t${argv.at(-1) ?? ""}\t[remote rejected] (pre-receive hook declined)\nDone\n`,
        })
      : inner.exec(argv, options),
});

const tracing = (inner: Box["Service"]): Box["Service"] => ({
  ...inner,
  exec: (argv, options = {}) =>
    options.env?.GIT_CONFIG_VALUE_0 === undefined
      ? inner.exec(argv, options)
      : Effect.succeed({
          exitCode: 128,
          stderr: `> ${options.env.GIT_CONFIG_VALUE_0}\nfatal: ${argv.join(" ")}`,
          stdout: "",
        }),
});

const keeping = (lines: string[]) =>
  Logger.layer([
    Logger.make((options) => {
      lines.push(JSON.stringify(Logger.formatStructured.log(options)));
    }),
  ]);

interface Imported {
  readonly default: unknown;
}

const importedFrom = (
  modules: Readonly<Record<string, string>>,
  file: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "modules-" });

    for (const [key, source] of Object.entries(modules)) {
      const at = path.join(root, key);

      yield* fs.makeDirectory(path.dirname(at), { recursive: true });
      yield* fs.writeFileString(at, source);
    }

    const target = path.join(root, file);

    return yield* Effect.promise((): Promise<Imported> => import(target));
  });

const SDK_NAMES = [`"${Brand.cliPackage}/rules"`, '"@repo/sdk"'];

const pointedAtSdk = (source: string) => {
  let pointed = source;

  for (const name of SDK_NAMES) {
    pointed = pointed.replaceAll(name, JSON.stringify(sdk.entry));
  }

  return pointed;
};

const asCommitted = (files: Files) =>
  Object.fromEntries(
    Object.entries(files).flatMap(([file, source]) =>
      source === null ? [] : [[file, pointedAtSdk(source)] as const]
    )
  );

const dataOf = ({ default: definition }: Imported) =>
  JSON.stringify(definition);

interface Claimant {
  readonly handle: string;
  readonly kind: string;
  readonly record: number;
  readonly territory: string;
  readonly vouched: boolean;
}

const FUNCTIONS = Symbol.for("@repo/sdk/Functions");

type Admit = (facts: Claimant) => boolean;

const isAdmit = (rule: unknown): rule is Admit => Predicate.isFunction(rule);

const admits = ({ default: definition }: Imported, facts: Claimant) => {
  const functions = Predicate.hasProperty(definition, FUNCTIONS)
    ? definition[FUNCTIONS]
    : undefined;

  const admit = Predicate.hasProperty(functions, "admit")
    ? functions.admit
    : undefined;

  return isAdmit(admit) ? admit(facts) : "no admit rule";
};

const claimant = (record: number): Claimant => ({
  handle: "bob",
  kind: "fix",
  record,
  territory: ".",
  vouched: true,
});

describe("the Lander's git", () => {
  describe(merge, () => {
    it.live(
      "merges a clean answer onto main: the tree git's own merge makes, the answer's changes, nothing written to canonical, and the merged commit kept on the fork for the Checker",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const { base, head, main } = yield* diverged(repos);
          const before = yield* repos.stateOf(repos.canonical);

          const merged = yield* merge(
            mergeWire(repos, { base, head, main })
          ).pipe(Effect.provide(box(repos.work)), Effect.exit);

          const tree = yield* repos.mergedTree(main, head);

          const kept = yield* repos.revision(
            repos.fork,
            `${Brand.refsPrefix}merge/${tree}`
          );

          expect(merged).toStrictEqual(
            Exit.succeed({
              changes: [
                {
                  after: yield* repos.blobAt(head, "src/date.ts"),
                  before: yield* repos.blobAt(base, "src/date.ts"),
                  path: RepoPath.make("src/date.ts"),
                  status: "modified",
                },
                {
                  after: yield* repos.blobAt(head, "test/iso.test.ts"),
                  path: RepoPath.make("test/iso.test.ts"),
                  status: "added",
                },
              ],
              tree,
            })
          );
          expect(yield* repos.stateOf(repos.canonical)).toStrictEqual(before);
          expect(
            yield* Effect.forEach(Option.toArray(kept), (commit) =>
              Effect.all([
                gitOk(repos.fork, "rev-parse", `${commit}^{tree}`),
                gitOk(repos.fork, "rev-parse", `${commit}^1`, `${commit}^2`),
              ])
            )
          ).toStrictEqual([[tree, `${main}\n${head}`]]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "refuses an answer that changed the same lines main did with StaleBase, naming the paths that conflict",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const { base, clash, main } = yield* diverged(repos);

          const merged = yield* merge(
            mergeWire(repos, { base, head: clash, main })
          ).pipe(Effect.provide(box(repos.work)), Effect.exit);

          expect(merged).toStrictEqual(
            Exit.fail(
              new StaleBase({
                base,
                conflicts: [RepoPath.make("src/date.ts")],
                main,
              })
            )
          );
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );
  });

  describe(land, () => {
    it.live(
      "lands one commit on main by the answerer, committed by the platform, with its trailers, then the mirror ref and the verdict note",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const wire = landWire(repos, { ...sides, tree });

          const landed = yield* land(wire).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          const tip = CommitSha.make(
            yield* gitOk(repos.canonical, "rev-parse", "refs/heads/main")
          );

          expect(landed).toStrictEqual(
            Exit.succeed({ pending: [], sha: LandedSha.make(tip) })
          );
          expect(yield* commitIn(repos.canonical, tip)).toStrictEqual({
            author: `bob <bob@users.${Brand.domain}>`,
            committer: `${Brand.name} <platform@${Brand.domain}>`,
            message: message.trim(),
            parents: [sides.main],
            tree,
          });
          expect(
            yield* repos.revision(repos.canonical, landedRefName)
          ).toStrictEqual(Option.some(tip));
          expect(
            yield* decodeNote(
              yield* gitOk(
                repos.canonical,
                "notes",
                `--ref=${Brand.slug}`,
                "show",
                tip
              )
            )
          ).toStrictEqual(Option.getOrThrow(wire.job.verdict));
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "blocks a land whose rebuilt tree is not the tree it was asked to land, and leaves main alone",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const checked = yield* repos.mergedTree(sides.main, sides.head);

          // The tree of main itself: not what merging the head again makes.
          const tree = yield* repos.mergedTree(sides.main, sides.main);

          expect(tree).not.toBe(checked);

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          expect(landed).toStrictEqual(Exit.fail(new VerifierBlocked({})));
          expect(
            yield* repos.revision(repos.canonical, "refs/heads/main")
          ).toStrictEqual(Option.some(sides.main));
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "refuses a land onto a main that moved since the job's main with StaleBase, and leaves main where it moved",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const other = yield* movedBy(repos, sides.main);

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          expect(landed).toStrictEqual(
            Exit.fail(
              new StaleBase({ base: sides.base, conflicts: [], main: other })
            )
          );
          expect(
            yield* Effect.all([
              repos.revision(repos.canonical, "refs/heads/main"),
              repos.revision(repos.canonical, landedRefName),
            ])
          ).toStrictEqual([Option.some(other), Option.none()]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "pushes main without force: when main moves between the Lander's fetch and its push, git refuses the push, the land is StaleBase, and the other commit stays",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const moved = yield* Deferred.make<CommitSha>();

          const move = movedBy(repos, sides.main).pipe(
            Effect.flatMap((other) => Deferred.succeed(moved, other)),
            Effect.asVoid,
            Effect.provide(TestServices),
            Effect.orDie
          );

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(box(repos.work, beforeMainIsPushed(move))),
            Effect.exit
          );

          const other = yield* Deferred.await(moved);

          expect(landed).toStrictEqual(
            Exit.fail(
              new StaleBase({ base: sides.base, conflicts: [], main: other })
            )
          );
          expect(
            yield* repos.revision(repos.canonical, "refs/heads/main")
          ).toStrictEqual(Option.some(other));
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "answers RepoBusy when Artifacts is busy with another push to the repo, and leaves main alone",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(box(repos.work, busyOnMain)),
            Effect.exit
          );

          expect(landed).toStrictEqual(Exit.fail(new RepoBusy({})));
          expect(
            yield* Effect.all([
              repos.revision(repos.canonical, "refs/heads/main"),
              repos.revision(repos.canonical, landedRefName),
            ])
          ).toStrictEqual([Option.some(sides.main), Option.none()]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "blocks a land whose push of main the remote refuses for a reason of its own, and logs what git said with the token taken out",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const lines: string[] = [];

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(
              Layer.merge(box(repos.work, mainDeclined), keeping(lines))
            ),
            Effect.exit
          );

          expect(landed).toStrictEqual(Exit.fail(new VerifierBlocked({})));
          expect(
            yield* repos.revision(repos.canonical, "refs/heads/main")
          ).toStrictEqual(Option.some(sides.main));
          expect([
            lines.filter(
              (line) =>
                line.includes("pre-receive hook declined") &&
                line.includes("no push for [token]")
            ).length,
            lines.filter((line) => line.includes(secret)),
          ]).toStrictEqual([1, []]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "keeps a landing whose mirror push fails: main has moved, the note is written, and the mirror comes back pending",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);

          const landed = yield* land(landWire(repos, { ...sides, tree })).pipe(
            Effect.provide(box(repos.work, mirrorRefused)),
            Effect.exit
          );

          const tip = yield* repos.revision(repos.canonical, "refs/heads/main");

          expect(landed).toStrictEqual(
            Exit.succeed({
              pending: ["mirror"],
              sha: LandedSha.make(Option.getOrThrow(tip)),
            })
          );
          expect(
            yield* Effect.all([
              repos.revision(repos.canonical, "refs/heads/main~1"),
              repos.revision(repos.canonical, landedRefName),
              Effect.map(
                repos.revision(repos.canonical, `refs/notes/${Brand.slug}`),
                Option.isSome
              ),
            ])
          ).toStrictEqual([Option.some(sides.main), Option.none(), true]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "lands a request once: landing it again finds its own commit by its Request-Id and writes only the bookkeeping that is missing",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const wire = landWire(repos, { ...sides, tree });
          const first = yield* land(wire).pipe(Effect.provide(box(repos.work)));

          // The mirror and the note were lost after main moved.
          yield* gitOk(repos.canonical, "update-ref", "-d", landedRefName);
          yield* gitOk(
            repos.canonical,
            "update-ref",
            "-d",
            `refs/notes/${Brand.slug}`
          );

          const again = yield* land(wire).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          expect(again).toStrictEqual(Exit.succeed(first));
          expect(
            yield* Effect.all([
              repos.revision(repos.canonical, "refs/heads/main~1"),
              repos.revision(repos.canonical, landedRefName),
              Effect.map(
                repos.revision(repos.canonical, `refs/notes/${Brand.slug}`),
                Option.isSome
              ),
            ])
          ).toStrictEqual([
            Option.some(sides.main),
            Option.some(first.sha),
            true,
          ]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );
  });

  describe(bundleRules, () => {
    it.live(
      "bundles the project module, the visibility module and each ask file with the sdk inlined, to the data and rules the committed folder gives, beside its other files",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const at = yield* startedWith(repos, configFolder);

          const bundled = yield* bundleRules(bundleWire(repos, at)).pipe(
            Effect.provide(box(repos.work))
          );

          const committed = asCommitted(configFolder);

          expect({
            ...bundled,
            modules: Object.keys(bundled.modules).toSorted(),
          }).toStrictEqual({
            entry: config("project.ts"),
            modules: [
              config("asks/parse-iso.ask.ts"),
              expect.stringMatching(/^\.[^/]+\/chunk-\w+\.js$/u),
              config("project.ts"),
              config("visibility.ts"),
              config("vouched.td"),
            ],
            sdkVersion,
          });
          expect(bundled.modules[config("vouched.td")]).toBe("dora\nbob\n");

          const visibilityModule = yield* importedFrom(
            bundled.modules,
            config("visibility.ts")
          );

          const visibilityAsCommitted = yield* importedFrom(
            committed,
            config("visibility.ts")
          );

          expect(dataOf(visibilityModule)).toStrictEqual(
            dataOf(visibilityAsCommitted)
          );

          const projectModule = yield* importedFrom(
            bundled.modules,
            config("project.ts")
          );

          const askModule = yield* importedFrom(
            bundled.modules,
            config("asks/parse-iso.ask.ts")
          );

          const projectAsCommitted = yield* importedFrom(
            committed,
            config("project.ts")
          );

          const askAsCommitted = yield* importedFrom(
            committed,
            config("asks/parse-iso.ask.ts")
          );

          expect([dataOf(projectModule), dataOf(askModule)]).toStrictEqual([
            dataOf(projectAsCommitted),
            dataOf(askAsCommitted),
          ]);
          expect([
            admits(projectModule, claimant(2)),
            admits(projectModule, claimant(1)),
          ]).toStrictEqual([true, false]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "gives no modules for a repo with no config folder, so the project runs on the defaults",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const at = yield* startedWith(repos, {});

          const bundled = yield* bundleRules(bundleWire(repos, at)).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          expect(bundled).toStrictEqual(
            Exit.succeed({
              entry: `${Brand.configDir}/project.ts`,
              modules: {},
              sdkVersion,
            })
          );
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );

    it.live(
      "never runs the folder's code while it bundles it: a macro import blocks the bundle and does not run",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const marker = path.join(path.dirname(repos.work), "macro-ran");

          const at = yield* startedWith(repos, {
            [`${Brand.configDir}/project.ts`]: [
              'import { stamp } from "./stamp.ts" with { type: "macro" };',
              "",
              "export default { stamp: stamp() };",
              "",
            ].join("\n"),
            [`${Brand.configDir}/stamp.ts`]: [
              "export const stamp = () => {",
              `  Bun.write(${JSON.stringify(marker)}, "ran");`,
              '  return "ran";',
              "};",
              "",
            ].join("\n"),
          });

          const bundled = yield* bundleRules(bundleWire(repos, at)).pipe(
            Effect.provide(box(repos.work)),
            Effect.exit
          );

          expect(bundled).toStrictEqual(Exit.fail(new VerifierBlocked({})));
          expect(yield* fs.exists(marker)).toBeFalsy();
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );
  });
  describe(compose, () => {
    it.live(
      "commits a decider's files onto main on a compose ref named by the tree, leaves main alone, and gives the same commit when asked again",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const ask = `${Brand.configDir}/asks/parse-iso.ask.ts`;

          const wire = {
            job: {
              files: [
                { content: "export default {};\n", path: RepoPath.make(ask) },
                {
                  content: "expect(week(1)).toBe(1);\n",
                  path: RepoPath.make("test/iso.test.ts"),
                },
              ] as const,
              main: sides.main,
              repo: project,
            },
            main: repos.remote(repos.canonical),
          };

          const composed = yield* compose(wire).pipe(
            Effect.provide(box(repos.work))
          );

          const ref = `${Brand.refsPrefix}compose/${composed.tree}`;

          expect(
            yield* Effect.all([
              repos.revision(repos.canonical, ref),
              repos.revision(repos.canonical, `${composed.commit}^`),
              repos.revision(repos.canonical, `${composed.commit}^{tree}`),
              gitOk(repos.canonical, "show", `${composed.commit}:${ask}`),
              gitOk(repos.canonical, "show", `${composed.commit}:README.md`),
              repos.revision(repos.canonical, "refs/heads/main"),
            ])
          ).toStrictEqual([
            Option.some(composed.commit),
            Option.some(sides.main),
            Option.some(composed.tree),
            "export default {};",
            "datekit",
            Option.some(sides.main),
          ]);
          expect(
            yield* compose(wire).pipe(
              Effect.provide(box(repos.work)),
              Effect.exit
            )
          ).toStrictEqual(Exit.succeed(composed));
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );
  });

  describe("tokens", () => {
    it.live(
      "hands git each remote's token only as an http.extraHeader through GIT_CONFIG env: never in a URL, a command line, a result or a log",
      () =>
        Effect.gen(function* () {
          const repos = yield* world;
          const sides = yield* diverged(repos);
          const tree = yield* repos.mergedTree(sides.main, sides.head);
          const handed: Handed[] = [];
          const lines: string[] = [];

          const recorded = Layer.merge(
            box(repos.work, recording(handed)),
            keeping(lines)
          );

          const traced = Layer.merge(box(repos.work, tracing), keeping(lines));

          const answer = {
            base: sides.base,
            head: sides.head,
            main: sides.main,
          };

          const outcomes = [
            yield* merge(mergeWire(repos, answer)).pipe(
              Effect.provide(recorded),
              Effect.exit
            ),
            yield* land(landWire(repos, { ...sides, tree })).pipe(
              Effect.provide(recorded),
              Effect.exit
            ),
            yield* bundleRules(bundleWire(repos, sides.main)).pipe(
              Effect.provide(recorded),
              Effect.exit
            ),
          ];

          const blocked = yield* merge(mergeWire(repos, answer)).pipe(
            Effect.provide(traced),
            Effect.exit
          );

          const reaching = handed.filter(({ argv }) =>
            argv.some((part) => [repos.canonical, repos.fork].includes(part))
          );

          expect(outcomes.map(({ _tag }) => _tag)).toStrictEqual([
            "Success",
            "Success",
            "Success",
          ]);
          expect(blocked).toStrictEqual(Exit.fail(new VerifierBlocked({})));
          expect(reaching.length).toBeGreaterThan(4);
          expect(
            reaching.map(({ env }) => [
              env.GIT_CONFIG_COUNT,
              env.GIT_CONFIG_KEY_0,
              env.GIT_CONFIG_VALUE_0,
            ])
          ).toStrictEqual(
            reaching.map(() => [
              "1",
              "http.extraHeader",
              `Authorization: Bearer ${secret}`,
            ])
          );
          expect(
            [
              ...handed.map(({ argv }) => argv.join(" ")),
              ...handed.flatMap((step) =>
                reaching.includes(step) ? [] : [JSON.stringify(step.env)]
              ),
              JSON.stringify([...outcomes, blocked]),
              ...lines,
            ].filter((text) => text.includes(secret))
          ).toStrictEqual([]);
        }).pipe(Effect.scoped, Effect.provide(TestServices))
    );
  });
});

const RootManifest = Schema.fromJsonString(
  Schema.Struct({
    workspaces: Schema.Struct({
      catalog: Schema.Struct({ effect: Schema.String }),
    }),
  })
);

describe("the land image", () => {
  it.effect(
    "installs the effect the repo's catalog pins beside its copy of the sdk, so a bundle inlines the effect the sdk was tested with",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const dockerfile = yield* fs.readFileString(
          inRepo("apps/sandbox/images/land.Dockerfile")
        );

        const manifest = yield* Schema.decodeEffect(RootManifest)(
          yield* fs.readFileString(inRepo("package.json"))
        );

        expect(
          /\beffect@(?<version>\S+)/u.exec(dockerfile)?.groups?.version
        ).toBe(manifest.workspaces.catalog.effect);
      }).pipe(Effect.provide(TestServices))
  );

  // A bare `bash` entrypoint exits at once with no stdin, which stops the
  // container and kills the first `exec` of every job (exit 137).
  it.effect.each(["check", "land"])(
    "keeps the %s container up until its Durable Object destroys it, since every command runs through exec",
    (image) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const dockerfile = yield* fs.readFileString(
          inRepo(`apps/sandbox/images/${image}.Dockerfile`)
        );

        const finalStage = dockerfile.split(/^FROM /mu).at(-1) ?? "";

        expect(/^CMD (?<command>.+)$/mu.exec(finalStage)?.groups?.command).toBe(
          '["sleep", "infinity"]'
        );
      }).pipe(Effect.provide(TestServices))
  );
});

describe("the Lander's script, as data", () => {
  const main = LandedSha.make("1".repeat(40));
  const base = CommitSha.make("2".repeat(40));
  const head = CommitSha.make("3".repeat(40));
  const landing = CommitSha.make("4".repeat(40));

  const remotes = {
    fork: "https://artifacts.invalid/datekit--parse-iso--bob.git",
    main: "https://artifacts.invalid/datekit.git",
  };

  const merging = mergeScript(
    { base, fork, head, main, repo: project },
    remotes
  );

  const pushes = landScript(
    { repo: project },
    remotes.main,
    landing,
    landedRefName
  );

  const steps = [
    ...merging.fetch,
    merging.merge,
    merging.changes,
    pushes.main,
    pushes.mirror,
  ];

  it("runs every git command with hooks off, no credential helper and no redirects, and names each remote only by its plain URL", () => {
    const gits = steps.filter(({ argv }) => argv[0] === "git");

    expect(gits).toHaveLength(steps.length);
    expect(
      gits.map(({ argv }) =>
        [
          "core.hooksPath=/dev/null",
          "credential.helper=",
          "http.followRedirects=false",
        ].every((setting) => argv[argv.indexOf(setting) - 1] === "-c")
      )
    ).toStrictEqual(gits.map(() => true));
    expect(
      steps.flatMap(({ argv }) => argv.filter((part) => part.includes("://")))
    ).toStrictEqual([remotes.main, remotes.fork, remotes.main, remotes.main]);
  });

  it("merges with merge-tree on the answer's own base, writing to neither remote", () => {
    expect(merging.merge.argv.slice(-8)).toStrictEqual([
      "merge-tree",
      "--write-tree",
      "-z",
      "--name-only",
      "--no-messages",
      `--merge-base=${base}`,
      main,
      head,
    ]);
    expect(
      [...merging.fetch, merging.merge, merging.changes].filter(({ argv }) =>
        argv.includes("push")
      )
    ).toStrictEqual([]);
  });

  it("lands with a plain push of main, then the mirror ref in a push of its own: no force, no lease, no atomic push", () => {
    expect([
      pushes.main.argv.slice(-2),
      pushes.mirror.argv.slice(-2),
    ]).toStrictEqual([
      [remotes.main, `${landing}:refs/heads/main`],
      [remotes.main, `${landing}:${landedRefName}`],
    ]);
    expect(
      [pushes.main, pushes.mirror].flatMap(({ argv }) =>
        argv.filter((part) => /^\+|--force|--atomic|--mirror/u.test(part))
      )
    ).toStrictEqual([]);
  });
});

const idleMerge = {
  fork: {
    token: Redacted.make(secret),
    url: "https://artifacts.invalid/datekit--parse-iso--bob.git",
  },
  job: {
    base: CommitSha.make("1".repeat(40)),
    fork,
    head: CommitSha.make("2".repeat(40)),
    main: LandedSha.make("3".repeat(40)),
    repo: project,
  },
  main: {
    token: Redacted.make(secret),
    url: "https://artifacts.invalid/datekit.git",
  },
};

describe("the Lander's Durable Objects", () => {
  it.live(
    "runs each job in the Lander named by the job's canonical repo: the wire decoded, the job run, its Exit encoded",
    () =>
      Effect.gen(function* () {
        const repos = yield* world;
        const sides = yield* diverged(repos);
        const named: string[] = [];
        const jobs = landerJobs(box(repos.work), Semaphore.makeUnsafe(1));

        const env = {
          LANDER: {
            getByName: (name: string) => {
              named.push(name);

              return jobs;
            },
          },
        };

        const wire = yield* Schema.encodeEffect(MergeWire)(
          mergeWire(repos, {
            base: sides.base,
            head: sides.clash,
            main: sides.main,
          })
        );

        const merged = yield* Schema.decodeEffect(MergeExit)(
          yield* Effect.promise(() => runMerge(env, wire))
        );

        expect(named).toStrictEqual([project]);
        expect(merged).toStrictEqual(
          Exit.fail(
            new StaleBase({
              base: sides.base,
              conflicts: [RepoPath.make("src/date.ts")],
              main: sides.main,
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(TestServices))
  );

  it.live(
    "runs one job at a time: a second job's first command waits until the first job is done",
    () =>
      Effect.gen(function* () {
        const ran: string[] = [];
        const finish = yield* Queue.unbounded<number>();

        // Every command waits until the test lets one finish, then exits 1.
        const held = Layer.succeed(
          Box,
          Box.of({
            destroy: () => Effect.void,
            exec: (argv) =>
              Effect.sync(() => ran.push(argv.join(" "))).pipe(
                Effect.andThen(Queue.take(finish)),
                Effect.as({ exitCode: 1, stderr: "", stdout: "" })
              ),
            writeFile: () => Effect.void,
          })
        );

        const jobs = landerJobs(held, Semaphore.makeUnsafe(1));
        const wire = yield* Schema.encodeEffect(MergeWire)(idleMerge);
        const first = jobs.merge(wire);
        const second = jobs.merge(wire);

        yield* Effect.sleep("50 millis");

        const whileFirstRuns = ran.length;

        yield* Queue.offer(finish, 1);
        yield* Effect.sleep("50 millis");

        const afterFirst = ran.length;

        yield* Queue.offer(finish, 2);

        const exits = yield* Effect.forEach([first, second], (outcome) =>
          Effect.flatMap(
            Effect.promise(() => outcome),
            Schema.decodeEffect(MergeExit)
          )
        );

        expect([whileFirstRuns, afterFirst]).toStrictEqual([1, 2]);
        expect(exits).toStrictEqual([
          Exit.fail(new VerifierBlocked({})),
          Exit.fail(new VerifierBlocked({})),
        ]);
      })
  );

  it.live(
    "starts its Durable Object's container from the land image with internet on",
    () =>
      Effect.gen(function* () {
        const started: ContainerStartupOptions[] = [];

        const container = untouchable<Container>("container", {
          exec: () =>
            Promise.resolve(
              untouchable<ExecProcess>("process", {
                output: () =>
                  Promise.resolve({
                    exitCode: 1,
                    stderr: new ArrayBuffer(0),
                    stdout: new ArrayBuffer(0),
                  }),
              })
            ),
          images: { check: "check-image", land: "land-image" },
          running: false,
          start: (options) => {
            if (options !== undefined) {
              started.push(options);
            }
          },
        });

        const lander = new Lander(
          untouchable<DurableObjectState>("ctx", { container }),
          untouchable<Env>("env")
        );

        const wire = yield* Schema.encodeEffect(MergeWire)(idleMerge);

        const merged = yield* Schema.decodeEffect(MergeExit)(
          yield* Effect.promise(() => lander.merge(wire))
        );

        expect(merged).toStrictEqual(Exit.fail(new VerifierBlocked({})));
        expect(started).toStrictEqual([
          { enableInternet: true, image: "land-image", instance: "standard-2" },
        ]);
      })
  );
});
