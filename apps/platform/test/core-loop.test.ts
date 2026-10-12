import { describe, expect, it } from "@effect/vitest";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { draftRunsInline } from "@repo/drafting/draft-runs/inline";
import type { InlinePorts } from "@repo/drafting/draft-runs/inline";
import type { DraftedAsk } from "@repo/drafting/drafted";
import { DrafterMemory } from "@repo/drafting/drafter/memory";
import { draftedFiles } from "@repo/drafting/render";
import type { Projects } from "@repo/project/projects";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  Handle,
  LandedSha,
  LaneName,
  ProjectName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import {
  AskFull,
  DirectPush,
  OutOfScope,
  StaleBase,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Array, Context, Deferred, Effect, Layer } from "effect";

import { pushRequestId } from "../src/adapters/custody.ts";
import { coreLoopWorld } from "./world.ts";

const project = ProjectName.make("dora/datekit");

const parseIso = AskId.make("parse-iso");

const parseMonth = AskId.make("parse-month");

const redThenGreen = LaneName.make("redThenGreen");

const mainRef = "refs/heads/main";

const sdk = `${Brand.cliPackage}/rules`;

const readme = "datekit: dates, parsed\n";

const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: "alice\nbob\n",
  "README.md": readme,
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/parse.ts":
    "export const parse = (iso: string) => ({ month: 0, year: 0 });\n",
};

const askFiles = (ask: AskId, want: string, assertion: string) =>
  Array.make(
    {
      content: [
        `import { kinds, territory } from "${sdk}";`,
        ``,
        `export default kinds.fix.ask({`,
        `  path: "test/${ask}.test.ts",`,
        `  territory: territory.paths("src/parse.ts"),`,
        `  want: "${want}",`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`),
    },
    {
      content: [
        `import { expect, it } from "bun:test";`,
        `import { parse } from "../src/parse.ts";`,
        ``,
        `it("${want}", () => {`,
        `  ${assertion}`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`test/${ask}.test.ts`),
    }
  );

const isoFiles = askFiles(
  parseIso,
  "parse reads the year of an ISO date",
  'expect(parse("2026-10-07").year).toBe(2026);'
);

const monthFiles = askFiles(
  parseMonth,
  "parse reads the month of an ISO date",
  'expect(parse("2026-10-07").month).toBe(10);'
);

const yearRead =
  "export const parse = (iso: string) => ({ month: 0, year: Number(iso.slice(0, 4)) });\n";

const monthRead =
  "export const parse = (iso: string) => ({ month: Number(iso.slice(5, 7)), year: 0 });\n";

const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

const rendered = (refusals: Parameters<typeof explain>[0]) =>
  explain(refusals).map((line) => `remote: ${line}`);

const credited = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

describe("the core loop, through the platform's fetch handler with real git", () => {
  it.live(
    "an ask opens red first, an out-of-scope answer is refused, the fixed answer lands with its credit, a stale one is refused, and a replay lands nothing",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const dora = world.rpc("dora");
        const alice = world.rpc("alice");
        const bob = world.rpc("bob");
        const doraGit = world.git("dora");
        const aliceGit = world.git("alice");
        const bobGit = world.git("bob");

        const made = yield* dora.initProject({ project });
        const home = yield* doraGit.clone(made.remote);
        const first = yield* doraGit.commit(home, "Start datekit", start);
        const firstPush = yield* doraGit.push(home);

        const afterFirst = yield* doraGit.ok(
          home,
          "ls-remote",
          "origin",
          mainRef
        );

        yield* doraGit.commit(home, "Straight to main", {
          "README.md": "datekit, pushed around the gate\n",
        });

        const direct = yield* doraGit.push(home);

        expect({
          afterDirect: yield* doraGit.ok(home, "ls-remote", "origin", mainRef),
          afterFirst,
          direct: {
            exitCode: direct.exitCode,
            rejected: direct.stderr.includes("HEAD -> main (DirectPush)"),
            remote: remoteLines(direct.stderr),
          },
          first: {
            exitCode: firstPush.exitCode,
            remote: remoteLines(firstPush.stderr),
          },
          remote: made.remote,
        }).toStrictEqual({
          afterDirect: `${first}\t${mainRef}`,
          afterFirst: `${first}\t${mainRef}`,
          direct: {
            exitCode: 1,
            rejected: true,
            remote: rendered([new DirectPush({ ref: mainRef })]),
          },
          first: { exitCode: 0, remote: [] },
          remote: `${world.origin}/${project}.git`,
        });

        yield* world.script(
          CheckAt.cases.Commit.make({
            commit: yield* world.composed(project, isoFiles),
          }),
          redThenGreen,
          ["failed", "failed"]
        );

        const iso = yield* dora.openAsk({
          ask: parseIso,
          files: isoFiles,
          project,
        });

        yield* world.script(
          CheckAt.cases.Commit.make({
            commit: yield* world.composed(project, monthFiles),
          }),
          redThenGreen,
          ["failed", "failed"]
        );

        const month = yield* dora.openAsk({
          ask: parseMonth,
          files: monthFiles,
          project,
        });

        yield* doraGit.ok(home, "fetch", "--quiet", "origin");

        expect({
          askedBy: iso.ask.askedBy,
          files: yield* doraGit.ok(
            home,
            "show",
            "--format=",
            "--name-only",
            iso.landed
          ),
          main: yield* doraGit.ok(home, "rev-parse", "origin/main"),
          parents: yield* doraGit.ok(
            home,
            "log",
            "-2",
            "--format=%P",
            month.landed
          ),
          trailer: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%(trailers:key=Asked-by,valueonly)",
            iso.landed
          ),
        }).toStrictEqual({
          askedBy: "dora",
          files: isoFiles.map(({ path }) => path).join("\n"),
          main: month.landed,
          parents: [iso.landed, first].join("\n"),
          trailer: credited("dora"),
        });

        const { claim } = yield* alice.claim({ ask: parseIso, project });
        const full = yield* Effect.flip(bob.claim({ ask: parseIso, project }));
        const { claim: bobs } = yield* bob.claim({ ask: parseMonth, project });

        const work = yield* aliceGit.clone(claim.remote);

        const wide = yield* aliceGit.commit(work, "Read the year, and say so", {
          "README.md": "datekit: dates, parsed, years first\n",
          "src/parse.ts": yearRead,
        });

        const refused = yield* aliceGit.push(work);

        expect({
          base: claim.base,
          checkCommand: claim.checkCommand,
          fork: yield* aliceGit.ok(work, "ls-remote", "origin", mainRef),
          full,
          refused: {
            exitCode: refused.exitCode,
            rejected: refused.stderr.includes("HEAD -> main (OutOfScope)"),
            remote: remoteLines(refused.stderr),
          },
          remote: claim.remote,
        }).toStrictEqual({
          base: month.landed,
          checkCommand: `bun test test/${parseIso}.test.ts`,
          fork: `${wide}\t${mainRef}`,
          full: new AskFull({ ask: parseIso }),
          refused: {
            exitCode: 1,
            rejected: true,
            remote: rendered([
              new OutOfScope({ paths: [RepoPath.make("README.md")] }),
            ]),
          },
          remote: `${world.origin}/${project}--parse-iso--alice.git`,
        });

        const fix = yield* aliceGit.commit(work, "Leave the readme alone", {
          "README.md": readme,
        });

        const harnessGit = yield* world.gitWithUsername(
          "alice",
          "audit;harness=claude-code&model=haiku"
        );

        const offered = yield* harnessGit.push(work);
        const tree = yield* aliceGit.ok(work, "rev-parse", `${fix}^{tree}`);

        yield* world.script(
          CheckAt.cases.Tree.make({ tree: TreeSha.make(tree) }),
          redThenGreen,
          ["passed"]
        );

        yield* world.settle();
        yield* doraGit.ok(home, "fetch", "--quiet", "origin");

        const landed = LandedSha.make(
          yield* doraGit.ok(home, "rev-parse", "origin/main")
        );

        const status = yield* alice.status({ project });
        const { verdict } = yield* alice.verdict({ ask: parseIso, project });

        const { landing } = yield* world
          .rpc("anonymous")
          .landing({ project, sha: landed });

        expect({
          assisted: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%(trailers:key=Assisted-by)",
            landed
          ),
          commit: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%P%n%T%n%an%n%cn",
            landed
          ),
          landing: {
            ask: landing.ask,
            assisted: landing.assisted,
            author: landing.author,
            credits: landing.credits,
            parent: landing.parent,
          },
          mirror: yield* doraGit.ok(
            home,
            "ls-remote",
            "origin",
            `${Brand.refsPrefix}landed`
          ),
          offered: {
            exitCode: offered.exitCode,
            remote: remoteLines(offered.stderr),
          },
          status: {
            answers: status.answers.map(({ head, outcome, requestId }) => [
              requestId,
              head,
              outcome,
            ]),
            claims: status.claims.map(({ ask, state }) => [ask, state]),
          },
          trailers: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%(trailers:key=Asked-by,valueonly)%(trailers:key=Signed-off-by,valueonly)",
            landed
          ),
          verdict: verdict?.lanes.map(({ lane, result }) => [lane, result]),
        }).toStrictEqual({
          assisted: "Assisted-by: claude-code:haiku (claimed)",
          commit: [month.landed, tree, "alice", Brand.name].join("\n"),
          landing: {
            ask: parseIso,
            assisted: [
              { harness: "claude-code", model: "haiku", verified: false },
            ],
            author: "alice",
            credits: [
              { handle: "dora", role: "Asked-by" },
              { handle: "alice", role: "Signed-off-by" },
            ],
            parent: month.landed,
          },
          mirror: `${landed}\t${Brand.refsPrefix}landed`,
          offered: {
            exitCode: 0,
            remote: [
              `remote: checking ${parseIso} at ${fix.slice(0, 7)}; follow with ${Brand.cli} status`,
            ],
          },
          status: {
            answers: [
              [
                pushRequestId(claim.claimant, fix),
                fix,
                Outcome.cases.Landed.make({ sha: landed }),
              ],
            ],
            claims: [[parseIso, "answered"]],
          },
          trailers: `${credited("dora")}\n${credited("alice")}`,
          verdict: [[redThenGreen, "passed"]],
        });

        const bobsWork = yield* bobGit.clone(bobs.remote);

        const stale = yield* bobGit.commit(bobsWork, "Read the month", {
          "src/parse.ts": monthRead,
        });

        const racing = yield* bobGit.push(bobsWork);

        yield* world.settle();

        const bobsAnswers = (yield* bob.status({ project })).answers;

        const receipt = { ask: parseIso, base: claim.base, head: fix, project };

        const replayed = yield* alice.submitAnswer({
          ...receipt,
          requestId: RequestId.make(`push-${fix}`),
        });

        const again = yield* alice.submitAnswer({
          ...receipt,
          requestId: pushRequestId(claim.claimant, fix),
        });

        yield* world.settle();

        expect({
          again,
          answers: (yield* alice.status({ project })).answers.length,
          bob: bobsAnswers.map(({ head, outcome }) => [head, outcome]),
          main: yield* doraGit.ok(home, "ls-remote", "origin", mainRef),
          racing: racing.exitCode,
          replayed,
        }).toStrictEqual({
          again: replayed,
          answers: 1,
          bob: [
            [
              stale,
              Outcome.cases.Refused.make({
                refusals: [
                  new StaleBase({
                    base: bobs.base,
                    conflicts: [RepoPath.make("src/parse.ts")],
                    main: landed,
                    movedBy: [
                      {
                        ask: parseIso,
                        author: Handle.make("alice"),
                        landing: landed,
                        path: RepoPath.make("src/parse.ts"),
                      },
                    ],
                  }),
                ],
              }),
            ],
          ],
          main: `${landed}\t${mainRef}`,
          racing: 0,
          replayed: {
            ...receipt,
            outcome: Outcome.cases.Checking.make({ stage: "merge" }),
            requestId: pushRequestId(claim.claimant, fix),
          },
        });
      }),
    60_000
  );

  it.live(
    "a want proposed with a draft runs in process, goes to the maintainer with its red-first evidence, and opens on accept with Assisted-by beside the people's credits",
    () =>
      Effect.gen(function* () {
        const drafted: DraftedAsk = {
          id: AskId.make("parse-day"),
          kind: "fix",
          rationale: "parse reads no day, so the test fails by its assertion",
          territory: [RepoPath.make("src/parse.ts")],
          test: {
            path: RepoPath.make("test/parse-day.test.ts"),
            source: [
              'import { expect, it } from "bun:test";',
              'import { parse } from "../src/parse.ts";',
              "",
              'it("parse reads the day of an ISO date", () => {',
              '  expect(Reflect.get(parse("2026-10-07"), "day")).toBe(7);',
              "});",
              "",
            ].join("\n"),
          },
          want: "parse reads the day of an ISO date",
        };

        const ready = yield* Deferred.make<Context.Context<InlinePorts>>();
        const drafter = yield* Layer.build(DrafterMemory([drafted]));

        const world = yield* coreLoopWorld({
          plugIn: () => ({
            project: draftRunsInline(Deferred.await(ready)),
            worker: Layer.effectDiscard(
              Effect.gen(function* () {
                const ports = yield* Effect.context<Projects | RepoHost>();

                yield* Deferred.succeed(ready, Context.merge(ports, drafter));
              })
            ),
          }),
        });

        const dora = world.rpc("dora");
        const alice = world.rpc("alice");
        const doraGit = world.git("dora");

        const made = yield* dora.initProject({ project });
        const home = yield* doraGit.clone(made.remote);

        yield* doraGit.commit(home, "Start datekit", start);
        yield* doraGit.push(home);

        yield* world.script(
          CheckAt.cases.Commit.make({
            commit: yield* world.composed(project, draftedFiles(drafted)),
          }),
          redThenGreen,
          ["failed", "failed"]
        );

        const proposed = yield* alice.proposeAsk({
          draft: true,
          project,
          want: drafted.want,
        });

        const { decisions } = yield* dora.today({ project });

        const decision = yield* Effect.fromOption(
          Array.findFirst(
            decisions,
            ({ subject }) =>
              DecisionSubject.guards.OpenProposal(subject) &&
              subject.proposal === proposed.proposal.id
          )
        );

        const shown = yield* alice.showProposal({
          project,
          proposal: proposed.proposal.id,
        });

        yield* dora.decide({
          choice: "accept",
          decision: decision.id,
          project,
        });

        const { asks } = yield* alice.listAsks({ project });

        yield* doraGit.ok(home, "fetch", "--quiet", "origin");

        expect({
          asks: asks.map(({ ask, claimed }) => ({ ask, claimed })),
          draft: shown.proposal.draft?._tag,
          files: yield* doraGit.ok(
            home,
            "show",
            "--format=",
            "--name-only",
            "origin/main"
          ),
          proposed: proposed.proposal.draft?._tag,
          redFirst: decision.evidence.some(
            ({ label, value }) =>
              label === "red first" && value.startsWith(`${redThenGreen}: `)
          ),
          trailers: (yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%(trailers:only)",
            "origin/main"
          ))
            .split("\n")
            .filter((line) => /^[A-Za-z-]+-by: /u.test(line)),
        }).toStrictEqual({
          asks: [{ ask: drafted.id, claimed: false }],
          draft: "Ready",
          files: draftedFiles(drafted)
            .map(({ path }) => path)
            .join("\n"),
          proposed: "Drafting",
          redFirst: true,
          trailers: [
            `Asked-by: ${credited("alice")}`,
            `Decided-by: ${credited("dora")}`,
            `Assisted-by: ${Brand.cli}-drafter:memory (verified)`,
          ],
        });
      }),
    60_000
  );
});
