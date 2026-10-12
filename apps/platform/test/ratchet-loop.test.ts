import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Verdict } from "@repo/protocol/domain/answer";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  LaneName,
  ProjectName,
  RatchetName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Array, Effect, Order, Schema } from "effect";

import { pushRequestId } from "../src/adapters/custody.ts";
import { coreLoopWorld } from "./world.ts";
import type { CoreLoopWorld, GitClient, Someone } from "./world.ts";

const project = ProjectName.make("dora/burrow");

const noAnyInParser = AskId.make("no-any-in-parser");

const formatIso = AskId.make("format-iso");

const decodeRaw = AskId.make("decode-raw");

const ratchet = RatchetName.make("no-explicit-any");

const ratchetLane = LaneName.make(ratchet);

const lintToZero = LaneName.make("lintToZero");

const redThenGreen = LaneName.make("redThenGreen");

const lint = "oxlint --format json";

const rule = "typescript/no-explicit-any";

const sdk = `${Brand.cliPackage}/rules`;

const parsePath = "packages/parser/src/parse.ts";

const formatPath = "packages/format/src/format.ts";

const codecPath = "packages/parser/src/codec.ts";

const anyParse =
  "export const parse = (s: any): any => ({ year: Number(s as any) });\n";

const anyFormat = "export const format = (d: any, f: any) => String(d);\n";

const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { check, kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix, kinds.lintToZero],`,
    `  ratchets: {`,
    `    "${ratchet}": check.ratchet.count("${lint}", { rule: "${rule}" }),`,
    `  },`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: "alice\nbob\n",
  "package.json":
    '{ "name": "burrow", "private": true, "workspaces": ["packages/*"] }\n',
  "packages/format/package.json": '{ "name": "format" }\n',
  "packages/parser/package.json": '{ "name": "parser" }\n',
  [formatPath]: anyFormat,
  [parsePath]: anyParse,
};

const lintFiles = Array.make({
  content: [
    `import { kinds, territory } from "${sdk}";`,
    ``,
    `export default kinds.lintToZero.ask({`,
    `  command: "${lint}",`,
    `  rule: "${rule}",`,
    `  territory: territory.package("parser"),`,
    `  want: "parser types every value it reads",`,
    `});`,
    ``,
  ].join("\n"),
  path: RepoPath.make(`${Brand.configDir}/asks/${noAnyInParser}.ask.ts`),
});

const fixFiles = (
  ask: AskId,
  module: string,
  want: string,
  subject: {
    readonly file: string;
    readonly name: string;
    readonly call: string;
    readonly is: string;
  }
) =>
  Array.make(
    {
      content: [
        `import { kinds, territory } from "${sdk}";`,
        ``,
        `export default kinds.fix.ask({`,
        `  path: "packages/${module}/test/${ask}.test.ts",`,
        `  territory: territory.package("${module}"),`,
        `  want: "${want}",`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`),
    },
    {
      content: [
        `import { expect, it } from "bun:test";`,
        `import { ${subject.name} } from "../src/${subject.file}";`,
        ``,
        `it("${want}", () => {`,
        `  expect(${subject.call}).toBe(${subject.is});`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`packages/${module}/test/${ask}.test.ts`),
    }
  );

const isoFiles = fixFiles(formatIso, "format", "format writes ISO dates", {
  call: "format(new Date(0))",
  file: "format.ts",
  is: '"1970-01-01"',
  name: "format",
});

const rawFiles = fixFiles(decodeRaw, "parser", "parser decodes raw input", {
  call: 'decode("2026")',
  file: "codec.ts",
  is: '"2026"',
  name: "decode",
});

const anyAt = (filename: string, line: number) => ({
  code: "typescript(no-explicit-any)",
  filename,
  help: "Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct.",
  labels: [{ span: { column: 1, length: 3, line, offset: 0 } }],
  message: "Unexpected `any`. Specify a different type.",
  severity: "error",
  url: "https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-explicit-any.html",
});

const oxlintReport = (
  findings: readonly (readonly [path: string, line: number])[]
) =>
  JSON.stringify({
    diagnostics: findings.map(([path, line]) => anyAt(path, line)),
    number_of_files: 4,
    number_of_rules: 1,
    start_time: 0.01,
    threads_count: 4,
  });

const mainFindings = [
  [formatPath, 1],
  [formatPath, 1],
  [parsePath, 1],
  [parsePath, 1],
  [parsePath, 1],
] as const;

const formatOnly = [
  [formatPath, 1],
  [formatPath, 1],
] as const;

const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

const credited = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

type Baseline = readonly [ratchet: string, territory: string, count: number];

const baselines = (world: CoreLoopWorld) =>
  Effect.map(world.ratchets(project), (rows) =>
    Array.sort(
      rows.map(({ count, ratchet: name, territory }): Baseline => [
        name,
        territory,
        count,
      ]),
      Order.mapInput(Order.String, ([name, territory]: Baseline) =>
        [name, territory].join(" ")
      )
    )
  );

const treeOf = (git: GitClient, work: string, head: CommitSha) =>
  Effect.map(git.ok(work, "rev-parse", `${head}^{tree}`), (tree) =>
    CheckAt.cases.Tree.make({ tree: TreeSha.make(tree) })
  );

const noteOn = (git: GitClient, work: string, head: CommitSha) =>
  Effect.gen(function* () {
    const ref = `refs/notes/${Brand.slug}`;

    yield* git.ok(work, "fetch", "--quiet", "origin", `${ref}:${ref}`);

    const shown = yield* git.ok(
      work,
      "notes",
      `--ref=${Brand.slug}`,
      "show",
      head
    );

    return yield* Schema.decodeEffect(Schema.fromJsonString(Verdict))(
      shown
    ).pipe(Effect.orDie);
  });

const answer = (
  world: CoreLoopWorld,
  as: Someone,
  git: GitClient,
  input: {
    readonly ask: AskId;
    readonly files: Readonly<Record<string, string>>;
  }
) =>
  Effect.gen(function* () {
    const { claim } = yield* world.rpc(as).claim({ ask: input.ask, project });
    const work = yield* git.clone(claim.remote);
    const head = yield* git.commit(work, `Answer ${input.ask}`, input.files);
    const pushed = yield* git.push(work);
    const tree = yield* treeOf(git, work, head);

    return { claim, head, pushed, tree, work };
  });

const scriptAnswer = (
  world: CoreLoopWorld,
  tree: CheckAt,
  input: {
    readonly askLane: LaneName;
    readonly askResult: "passed" | "failed";
    readonly findings: readonly (readonly [string, number])[];
  }
) =>
  Effect.gen(function* () {
    const report = oxlintReport(input.findings);
    const linted = input.findings.length === 0 ? "passed" : "failed";

    yield* world.script(tree, ratchetLane, [linted]);
    yield* world.print(tree, ratchetLane, report);
    yield* world.script(tree, input.askLane, [input.askResult]);
    yield* world.print(tree, input.askLane, report);
  });

const ratchetStory = (world: CoreLoopWorld) =>
  Effect.gen(function* () {
    const dora = world.rpc("dora");
    const doraGit = world.git("dora");

    yield* dora.initProject({ project });

    const home = yield* doraGit.clone(`${world.origin}/${project}.git`);

    yield* doraGit.commit(home, "Start burrow", start);
    yield* doraGit.push(home);

    const composedLint = CheckAt.cases.Commit.make({
      commit: yield* world.composed(project, lintFiles),
    });

    yield* world.script(composedLint, lintToZero, ["failed", "failed"]);
    yield* world.print(composedLint, lintToZero, oxlintReport(mainFindings));

    const opened = yield* dora.openAsk({
      ask: noAnyInParser,
      files: lintFiles,
      project,
    });

    const afterOpening = yield* baselines(world);

    for (const [ask, files] of [
      [formatIso, isoFiles],
      [decodeRaw, rawFiles],
    ] as const) {
      yield* world.script(
        CheckAt.cases.Commit.make({
          commit: yield* world.composed(project, files),
        }),
        redThenGreen,
        ["failed", "failed"]
      );
      yield* dora.openAsk({ ask, files, project });
    }

    const harnessGit = yield* world.gitWithUsername(
      "alice",
      "audit;harness=pi&model=kimi-k3"
    );

    const typed = yield* answer(world, "alice", harnessGit, {
      ask: noAnyInParser,
      files: {
        [parsePath]:
          "export const parse = (s: string) => ({ year: Number(s) });\n",
      },
    });

    yield* scriptAnswer(world, typed.tree, {
      askLane: lintToZero,
      askResult: "failed",
      findings: formatOnly,
    });
    yield* world.settle();

    const landed = (yield* world.rpc("alice").status({ project })).answers;
    const afterLanding = yield* baselines(world);

    const pushLog = (yield* world.logged).filter(({ annotations }) =>
      annotations.has("harness")
    );

    const bobGit = world.git("bob");

    const widened = yield* answer(world, "bob", bobGit, {
      ask: formatIso,
      files: { [formatPath]: "export const format = (d: any, f: any) => d;\n" },
    });

    yield* scriptAnswer(world, widened.tree, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: [...formatOnly, [parsePath, 1]],
    });
    yield* world.settle();

    const bob = world.rpc("bob");

    return {
      afterLanding,
      afterOpening,
      bobsAnswers: (yield* bob.status({ project })).answers,
      bobsNote: yield* noteOn(bobGit, widened.work, widened.head),
      bobsVerdict: (yield* bob.verdict({ ask: formatIso, project })).verdict,
      home,
      landed,
      opened,
      pushLog,
      typed,
      widened,
    };
  });

const escapeStory = (world: CoreLoopWorld, choice: Choice) =>
  Effect.gen(function* () {
    const aliceGit = world.git("alice");

    const escaped = yield* answer(world, "alice", aliceGit, {
      ask: decodeRaw,
      files: {
        [codecPath]: [
          "// oxlint-disable-next-line no-explicit-any -- the codec boundary erases types",
          "export const decode = (raw: any) => raw;",
          "",
        ].join("\n"),
      },
    });

    yield* scriptAnswer(world, escaped.tree, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: formatOnly,
    });
    yield* world.settle();

    const dora = world.rpc("dora");
    const alice = world.rpc("alice");
    const waiting = (yield* alice.status({ project })).answers;
    const today = yield* dora.today({ project });
    const before = yield* baselines(world);

    const [waiver] = today.decisions;

    if (waiver === undefined) {
      return { before, today, waiting };
    }

    yield* dora.decide({ choice, decision: waiver.id, project });
    yield* world.settle();

    return {
      after: yield* baselines(world),
      afterDecision: (yield* alice.status({ project })).answers,
      before,
      claims: (yield* alice.status({ project })).claims,
      escaped,
      today,
      waiting,
      waiver,
    };
  });

const raiseStory = (world: CoreLoopWorld) =>
  Effect.gen(function* () {
    const raised = yield* answer(world, "alice", world.git("alice"), {
      ask: decodeRaw,
      files: {
        [codecPath]: [
          "// @ts-expect-error -- the codec boundary erases types",
          "export const decode = (raw: any) => raw;",
          "",
        ].join("\n"),
      },
    });

    yield* scriptAnswer(world, raised.tree, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: [...formatOnly, [codecPath, 2]],
    });
    yield* world.settle();

    const dora = world.rpc("dora");
    const today = yield* dora.today({ project });
    const before = yield* baselines(world);

    for (const { id } of today.decisions) {
      yield* dora.decide({ choice: "accept", decision: id, project });
    }

    yield* world.settle();

    return {
      after: yield* baselines(world),
      answers: (yield* world.rpc("alice").status({ project })).answers,
      before,
      subjects: today.decisions.map(({ subject }) => subject),
    };
  });

const againStory = (world: CoreLoopWorld) =>
  Effect.gen(function* () {
    const aliceGit = world.git("alice");
    const escape = "// @ts-expect-error -- the codec boundary erases types";

    const first = yield* answer(world, "alice", aliceGit, {
      ask: decodeRaw,
      files: {
        [codecPath]: [
          escape,
          "export const decode = (raw: any) => raw;",
          "",
        ].join("\n"),
      },
    });

    yield* scriptAnswer(world, first.tree, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: [...formatOnly, [codecPath, 2]],
    });
    yield* world.settle();

    const dora = world.rpc("dora");

    for (const { id, subject } of (yield* dora.today({ project })).decisions) {
      yield* dora.decide({
        choice: DecisionSubject.guards.Waiver(subject) ? "accept" : "decline",
        decision: id,
        project,
      });
    }

    yield* world.settle();

    const head = yield* aliceGit.commit(first.work, "Type decode", {
      [codecPath]: [
        escape,
        "export const decode = (raw: unknown) => raw;",
        "",
      ].join("\n"),
    });

    yield* aliceGit.push(first.work);

    yield* scriptAnswer(world, yield* treeOf(aliceGit, first.work, head), {
      askLane: redThenGreen,
      askResult: "passed",
      findings: formatOnly,
    });
    yield* world.settle();

    return {
      answers: (yield* world.rpc("alice").status({ project })).answers,
      baselines: yield* baselines(world),
      today: (yield* dora.today({ project })).decisions,
    };
  });

const movedStory = (world: CoreLoopWorld, widened: { readonly work: string }) =>
  Effect.gen(function* () {
    const aliceGit = world.git("alice");
    const bobGit = world.git("bob");

    const escaped = yield* answer(world, "alice", aliceGit, {
      ask: decodeRaw,
      files: {
        [codecPath]: [
          "// oxlint-disable-next-line no-explicit-any -- the codec boundary erases types",
          "export const decode = (raw: any) => raw;",
          "",
        ].join("\n"),
      },
    });

    yield* scriptAnswer(world, escaped.tree, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: formatOnly,
    });
    yield* world.settle();

    const typed = yield* bobGit.commit(widened.work, "Type format", {
      [formatPath]:
        "export const format = (d: Date) => d.toISOString().slice(0, 10);\n",
    });

    yield* bobGit.push(widened.work);
    yield* scriptAnswer(world, yield* treeOf(bobGit, widened.work, typed), {
      askLane: redThenGreen,
      askResult: "passed",
      findings: [],
    });
    yield* world.settle();

    yield* aliceGit.ok(
      escaped.work,
      "fetch",
      "--quiet",
      `${world.origin}/${project}.git`,
      "main"
    );

    const remerged = CheckAt.cases.Tree.make({
      tree: TreeSha.make(
        yield* aliceGit.ok(
          escaped.work,
          "merge-tree",
          "--write-tree",
          "FETCH_HEAD",
          escaped.head
        )
      ),
    });

    yield* scriptAnswer(world, remerged, {
      askLane: redThenGreen,
      askResult: "passed",
      findings: [],
    });

    const dora = world.rpc("dora");
    const asked = (yield* dora.today({ project })).decisions;

    for (const { id } of asked) {
      yield* dora.decide({ choice: "accept", decision: id, project });
    }

    yield* world.settle();

    return {
      answers: (yield* world.rpc("alice").status({ project })).answers,
      asked: asked.map(({ subject }) => subject._tag),
      baselines: yield* baselines(world),
      today: (yield* dora.today({ project })).decisions,
    };
  });

const parserZero: Baseline = [ratchet, "parser", 0];

const formatTwo: Baseline = [ratchet, "format", 2];

describe("ratchets and lint-to-zero asks, through the platform's fetch handler with real git", () => {
  it.live(
    "a lint-to-zero ask opens red first by its count, its answer lowers the baseline, and an answer that raises a count is refused Weakened",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const seen = yield* ratchetStory(world);
        const { typed, widened } = seen;

        const weakened = new Weakened({
          weakening: { after: 1, before: 0, ratchet, territory: "parser" },
        });

        expect({
          afterLanding: seen.afterLanding,
          afterOpening: seen.afterOpening,
          bobsNote: seen.bobsNote.outcome,
          bobsOutcomes: seen.bobsAnswers.map(({ outcome }) => outcome),
          bobsPush: {
            exitCode: widened.pushed.exitCode,
            remote: remoteLines(widened.pushed.stderr),
          },
          bobsVerdict: seen.bobsVerdict?.outcome,
          landed: seen.landed.map(({ outcome }) => outcome._tag),
          opened: seen.opened.ask.check._tag,
        }).toStrictEqual({
          afterLanding: [formatTwo, parserZero],
          afterOpening: [formatTwo, [ratchet, "parser", 3]],
          bobsNote: Outcome.cases.Refused.make({ refusals: [weakened] }),
          bobsOutcomes: [Outcome.cases.Refused.make({ refusals: [weakened] })],
          bobsPush: {
            exitCode: 0,
            remote: [
              `remote: checking ${formatIso} at ${widened.head.slice(0, 7)}; follow with ${Brand.cli} status`,
            ],
          },
          bobsVerdict: Outcome.cases.Refused.make({ refusals: [weakened] }),
          landed: ["Landed"],
          opened: "LintToZero",
        });

        expect(
          seen.pushLog.map(({ annotations }) => ({
            harness: annotations.get("harness"),
            model: annotations.get("model"),
            pusher: annotations.get("pusher"),
          }))
        ).toContainEqual({ harness: "pi", model: "kimi-k3", pusher: "alice" });
        expect(seen.landed.map(({ requestId }) => requestId)).toStrictEqual([
          pushRequestId(typed.claim.claimant, typed.head),
        ]);
      }),
    60_000
  );

  it.live(
    "a reasoned escape waits on one Waiver, and accepting it lands the answer and raises its territory's escapes by one",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const { home } = yield* ratchetStory(world);
        const seen = yield* escapeStory(world, "accept");
        const doraGit = world.git("dora");

        yield* doraGit.ok(home, "fetch", "--quiet", "origin");

        const landed = yield* doraGit.ok(home, "rev-parse", "origin/main");

        expect({
          after: seen.after,
          afterDecision: seen.afterDecision?.map(({ outcome }) => outcome._tag),
          before: seen.before,
          decidedBy: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%(trailers:key=Decided-by,valueonly)",
            landed
          ),
          subjects: seen.today.decisions.map(({ subject }) => subject),
          waiting: seen.waiting.map(({ outcome }) => outcome._tag),
        }).toStrictEqual({
          after: [
            [RatchetName.make("escapes-parser"), "parser", 1],
            formatTwo,
            parserZero,
          ],
          afterDecision: ["Landed", "Landed"],
          before: [formatTwo, parserZero],
          decidedBy: credited("dora"),
          subjects: [
            DecisionSubject.cases.Waiver.make({
              ask: decodeRaw,
              at: { line: 1, path: RepoPath.make(codecPath) },
              marker: "oxlint-disable",
              reason: "the codec boundary erases types",
            }),
          ],
          waiting: ["Landed", "AwaitingDecision"],
        });
      }),
    60_000
  );

  it.live(
    "declining the Waiver leaves the answer unlanded, the claim live, and the escapes where they were",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const { landed } = yield* ratchetStory(world);
        const seen = yield* escapeStory(world, "decline");

        expect({
          after: seen.after,
          afterDecision: seen.afterDecision?.map(({ outcome }) => outcome),
          claims: seen.claims?.map(({ ask, state }) => [ask, state]),
        }).toStrictEqual({
          after: [formatTwo, parserZero],
          afterDecision: [
            ...landed.map(({ outcome }) => outcome),
            Outcome.cases.Refused.make({
              refusals: [
                new Weakened({
                  at: { line: 1, path: RepoPath.make(codecPath) },
                  weakening: {
                    marker: "oxlint-disable",
                    reason: "the codec boundary erases types",
                  },
                }),
              ],
            }),
          ],
          claims: [
            [noAnyInParser, "answered"],
            [decodeRaw, "live"],
          ],
        });
      }),
    60_000
  );

  it.live(
    "a raise explained by a reasoned escape in its territory waits on RaiseRatchet beside the Waiver, and accepting both raises both baselines",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        yield* ratchetStory(world);
        const seen = yield* raiseStory(world);

        expect({
          after: seen.after,
          answers: seen.answers.map(({ outcome }) => outcome._tag),
          before: seen.before,
          subjects: seen.subjects,
        }).toStrictEqual({
          after: [
            [RatchetName.make("escapes-parser"), "parser", 1],
            formatTwo,
            [ratchet, "parser", 1],
          ],
          answers: ["Landed", "Landed"],
          before: [formatTwo, parserZero],
          subjects: [
            DecisionSubject.cases.Waiver.make({
              ask: decodeRaw,
              at: { line: 1, path: RepoPath.make(codecPath) },
              marker: "@ts-expect-error",
              reason: "the codec boundary erases types",
            }),
            DecisionSubject.cases.RaiseRatchet.make({
              after: 1,
              ask: decodeRaw,
              before: 0,
              ratchet,
              territory: "parser",
            }),
          ],
        });
      }),
    60_000
  );

  it.live(
    "a Waiver accepted for one answer is asked again of the next answer to the same ask",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        yield* ratchetStory(world);
        const seen = yield* againStory(world);

        expect({
          answers: seen.answers.map(({ outcome }) => outcome._tag),
          baselines: seen.baselines,
          today: seen.today.map(({ subject }) => subject),
        }).toStrictEqual({
          answers: ["Landed", "Refused", "AwaitingDecision"],
          baselines: [formatTwo, parserZero],
          today: [
            DecisionSubject.cases.Waiver.make({
              ask: decodeRaw,
              at: { line: 1, path: RepoPath.make(codecPath) },
              marker: "@ts-expect-error",
              reason: "the codec boundary erases types",
            }),
          ],
        });
      }),
    60_000
  );

  it.live(
    "an accepted Waiver is not asked again when its answer is checked again after main moved",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const { widened } = yield* ratchetStory(world);
        const seen = yield* movedStory(world, widened);

        expect({
          answers: seen.answers.map(({ outcome }) => outcome._tag),
          asked: seen.asked,
          baselines: seen.baselines,
          today: seen.today,
        }).toStrictEqual({
          answers: ["Landed", "Landed"],
          asked: ["Waiver"],
          baselines: [
            [RatchetName.make("escapes-parser"), "parser", 1],
            [ratchet, "format", 0],
            parserZero,
          ],
          today: [],
        });
      }),
    60_000
  );
});
