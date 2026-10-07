/**
 * The product's core loop as a decider and two contributors live it (spec
 * §5, "The W3 acceptance test"), through the platform's own fetch handler
 * with real git: a project made and first pushed, two asks opened red
 * first, claimed, an answer refused out of scope and then landed with its
 * credit, a second answer refused on a stale base, and a replayed request
 * that lands nothing new. Every step goes through a surface: git's output,
 * or a contract over `/rpc`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
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
import { Array, Effect } from "effect";

import { pushRequestId } from "../src/adapters/custody.ts";
import { coreLoopWorld } from "./world.ts";

const project = ProjectName.make("datekit");

const parseIso = AskId.make("parse-iso");

const parseMonth = AskId.make("parse-month");

/** The lane an ask's `redThenGreen` check runs in. */
const redThenGreen = LaneName.make("redThenGreen");

const mainRef = "refs/heads/main";

/** Where the config folder's sdk is imported from, as a maintainer writes it. */
const sdk = `${Brand.cliPackage}/rules`;

const readme = "datekit: dates, parsed\n";

/** The project as dora first pushes it: one source file, the config folder, the vouches. */
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
  "package.json": '{ "name": "datekit", "private": true }\n',
  "src/parse.ts":
    "export const parse = (iso: string) => ({ month: 0, year: 0 });\n",
};

/** An ask's own files: its file in the config folder, and its check, which asserts. */
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

/** alice's answer to parse-iso: the year, read. */
const yearRead =
  "export const parse = (iso: string) => ({ month: 0, year: Number(iso.slice(0, 4)) });\n";

/** bob's answer to parse-month, on the same line: the month, read. */
const monthRead =
  "export const parse = (iso: string) => ({ month: Number(iso.slice(5, 7)), year: 0 });\n";

/**
 * The lines git printed from the server's side band, less the spaces git
 * pads them with to clear a progress line.
 */
const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

/** What `protocol/render` says of `refusals`, as git prints it. */
const rendered = (refusals: Parameters<typeof explain>[0]) =>
  explain(refusals).map((line) => `remote: ${line}`);

/** A person in a trailer: their handle and the address the platform gives them. */
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

        // 1. dora makes the project; her first push lands the first tree,
        // and a second push straight to main is a direct push.
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

        // 2. dora opens two asks over the same file; each check fails
        // twice on main the same way, and each lands as a platform commit
        // dora asked, the first on her first push.
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
          // parse-month's parent, then parse-iso's.
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

        // 3. alice claims parse-iso, so bob's claim on it is AskFull; bob
        // claims parse-month instead.
        const { claim } = yield* alice.claim({ ask: parseIso, project });
        const full = yield* Effect.flip(bob.claim({ ask: parseIso, project }));
        const { claim: bobs } = yield* bob.claim({ ask: parseMonth, project });

        // 4. alice's first try reaches outside the ask's territory: git
        // prints OutOfScope, and her fork keeps the commit.
        const work = yield* aliceGit.clone(claim.remote);

        const wide = yield* aliceGit.commit(work, "Read the year, and say so", {
          "README.md": "datekit: dates, parsed, years first\n",
          "src/parse.ts": yearRead,
        });

        const refused = yield* aliceGit.push(work);

        expect({
          base: claim.base,
          // The run block is the config folder's, as `/bun` evaluated it.
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
          remote: `${world.origin}/${claim.fork}.git`,
        });

        // 5. She puts the readme back and pushes again: the answer is
        // being checked, then merged, checked green and landed.
        const fix = yield* aliceGit.commit(work, "Leave the readme alone", {
          "README.md": readme,
        });

        const offered = yield* aliceGit.push(work);
        const tree = yield* aliceGit.ok(work, "rev-parse", `${fix}^{tree}`);

        // main has not moved since alice claimed, so the merged tree is
        // her head's, and her check passes on it.
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
          commit: yield* doraGit.ok(
            home,
            "log",
            "-1",
            "--format=%P%n%T%n%an%n%cn",
            landed
          ),
          landing: {
            ask: landing.ask,
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
          commit: [month.landed, tree, "alice", Brand.name].join("\n"),
          landing: {
            ask: parseIso,
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

        // 6. bob answered parse-month on the main he claimed at, in the
        // line alice's answer changed: his run ends refused, StaleBase.
        const bobsWork = yield* bobGit.clone(bobs.remote);

        const stale = yield* bobGit.commit(bobsWork, "Read the month", {
          "src/parse.ts": monthRead,
        });

        const racing = yield* bobGit.push(bobsWork);

        yield* world.settle();

        const bobsAnswers = (yield* bob.status({ project })).answers;

        // 7. alice offers her landed head again: the same receipt comes
        // back, and nothing new lands.
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
});
