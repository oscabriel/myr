import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { shaOf } from "@repo/checks/check-runner";
import { authorLine, committerLine, parseTrailers } from "@repo/git/trailers";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  Denounced,
  NotDecider,
  NotVouched,
  TouchedJudge,
} from "@repo/protocol/refusal";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { parseVouchFile } from "@repo/rules/vouch";
import { advanceTo, at as instant } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import {
  aProject,
  withAsk,
  withKind,
  withVouches,
} from "@repo/testkit/scenarios";
import { Array, DateTime, Effect, Exit, Layer, Option } from "effect";

import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { creditsFor, Projects } from "../src/projects.ts";
import { ProjectsMemory } from "../src/projects/memory.ts";
import { CheckScript, composedAt, mergedAt, Pusher, worldOf } from "./world.ts";

const people = ["bob", "carol", "dave", "erin", "eve", "frank"];

const scenario = aProject({ people }).pipe(
  withVouches(["bob", "carol", "erin", "eve", "frank"]),
  withKind({
    checkKind: "redThenGreen",
    claimers: "vouched",
    finish: "required",
    name: "polish",
    oneWay: false,
    race: 1,
    requires: ["want", "check", "territory"],
    strength: "assertion",
  }),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" }),
  withAsk({ id: "lex-tokens", territory: "packages/lexer" }),
  withAsk({ id: "format-date", kind: "polish", territory: "packages/format" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const mainRef = RefName.make("refs/heads/main");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

const aliceSignedIn = Person.make({ handle: Handle.make("Alice") });

const bob = person("bob");

const carol = person("carol");

const dave = person("dave");

const erin = person("erin");

const anyone = Anonymous.make({});

const userOf = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

const askOf = (id: string): Ask =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const redThenGreen = LaneName.make("redThenGreen");

const noon = instant("2026-10-07T12:00:00Z");

const daysAfter = (from: DateTime.Utc, count: number) =>
  DateTime.add(from, { days: count });

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  [
    "packages/format/src/format.ts",
    "export const format = (d) => String(d);\n",
  ],
  ["packages/lexer/src/lex.ts", "export const lex = (s) => s.split(' ');\n"],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

const askFiles = (id: string) => {
  const { check, file, territory } = askOf(id);

  const subject = territory.module;

  return Array.make(
    { content: `export default "${id}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { ${subject} } from "../src/${subject}.ts";`,
        ``,
        `it("${id}", () => {`,
        `  expect(${subject}(" 2026 ")).toStrictEqual("2026");`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${id}.test.ts`),
    }
  );
};

const tipOf = (name: RepoName) =>
  Effect.gen(function* () {
    const refs = yield* (yield* RepoHost).refs(name).pipe(Effect.orDie);

    return LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );
  });

const mainTip = tipOf(repo);

const commitOf = (sha: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const read = yield* host.readCommit(repo, sha).pipe(Effect.orDie);
    const { author, committer, message, parents } = Option.getOrThrow(read);

    return {
      author,
      committer,
      parents,
      subject: message.split("\n", 1)[0],
      trailers: parseTrailers(message),
    };
  });

const stored = ProjectStore.use((store) => store.load());

const made = (api: ProjectApi, on: RepoName, files: Files = start) =>
  Effect.gen(function* () {
    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(on, Option.none(), files, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    return api;
  });

const begun = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  return yield* made(yield* projectService(project), repo);
});

const redOnMain = (
  files: Array.NonEmptyReadonlyArray<{
    readonly content: string;
    readonly path: RepoPath;
  }>,
  on: RepoName = repo
) =>
  Effect.gen(function* () {
    const composed = yield* composedAt(on, yield* tipOf(on), files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, redThenGreen, ["failed", "failed"])
    );
  });

const openRed = (api: ProjectApi, id: string, on: RepoName = repo) =>
  Effect.gen(function* () {
    const files = askFiles(id);

    yield* redOnMain(files, on);

    return yield* api.openAsk(alice, { ask: AskId.make(id), files });
  });

const lanes = [redThenGreen, LaneName.make("lint"), LaneName.make("types")];

const changed = (files: Files, path: string, content: string): Files => [
  ...files.filter(([each]) => each !== path),
  [path, content],
];

const withAskFiles = (files: Files, ...ids: readonly string[]): Files => [
  ...files,
  ...ids.flatMap((id) =>
    askFiles(id).map(({ content, path }) => [path, content] as const)
  ),
];

const answered = (
  api: ProjectApi,
  input: {
    readonly change: readonly [path: string, content: string];
    readonly files: Files;
    readonly id: string;
    readonly on?: RepoName;
    readonly who: Person;
  }
) =>
  Effect.gen(function* () {
    const ask = AskId.make(input.id);
    const on = input.on ?? repo;
    const base = yield* tipOf(on);
    const { claim } = yield* api.claim(input.who, ask);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(
        claim.fork,
        Option.some(base),
        changed(input.files, ...input.change)
      )
    );

    const merged = yield* mergedAt({
      base,
      fork: claim.fork,
      head,
      main: base,
      repo: on,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        lanes,
        (lane) => checker.script(merged, lane, ["passed"]),
        {
          discard: true,
        }
      )
    );

    const receipt = yield* api.submitAnswer(input.who, {
      ask,
      base,
      head,
      requestId: RequestId.make(`req-${input.id}`),
    });

    return { base, fork: claim.fork, head, receipt };
  });

const firstDecision = DecisionId.make("dec-000001");

const finishing = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "format-date");

    const answer = yield* answered(api, {
      change: [
        "packages/format/src/format.ts",
        "export const format = (d) => d.toISOString();\n",
      ],
      files: withAskFiles(start, "format-date"),
      id: "format-date",
      who: bob,
    });

    const waiting = (yield* api.status(bob)).answers.map(
      ({ outcome }) => outcome
    );

    const bobFinishes = yield* api
      .finish(bob, {
        ask: AskId.make("format-date"),
        base: answer.base,
        head: answer.head,
        requestId: RequestId.make("finish-bob-01"),
      })
      .pipe(Effect.flip);

    const finish = {
      ask: AskId.make("format-date"),
      base: answer.base,
      head: answer.head,
      requestId: RequestId.make("finish-alice-01"),
    };

    // Her sign-in cases her handle otherwise than the policy does.
    const receipt = yield* api.finish(aliceSignedIn, finish);
    const landed = yield* mainTip;

    return {
      again: yield* api.finish(aliceSignedIn, finish),
      answer,
      bobFinishes,
      commit: yield* commitOf(landed),
      landed,
      receipt,
      settled: (yield* api.status(bob)).answers.map(({ outcome }) => outcome),
      waiting,
    };
  });

const finishingOnTop = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "format-date");

    const files = withAskFiles(start, "format-date");
    const formatPath = "packages/format/src/format.ts";
    const ask = AskId.make("format-date");

    const answer = yield* answered(api, {
      change: [formatPath, "export const format = (d) => d.toISOString();\n"],
      files,
      id: "format-date",
      who: bob,
    });

    const polishedFiles = changed(
      files,
      formatPath,
      "export const format = (d) => d.toISOString().slice(0, 10);\n"
    );

    const polished = yield* Pusher.use((pusher) =>
      pusher.push(answer.fork, Option.some(answer.head), polishedFiles)
    );

    const judging = yield* Pusher.use((pusher) =>
      pusher.push(
        answer.fork,
        Option.some(polished),
        changed(
          polishedFiles,
          askOf("format-date").file,
          'export default "easier";\n'
        )
      )
    );

    const touched = yield* api
      .finish(alice, {
        ask,
        base: answer.base,
        head: judging,
        requestId: RequestId.make("finish-alice-02"),
      })
      .pipe(Effect.flip);

    const merged = yield* mergedAt({
      base: answer.base,
      fork: answer.fork,
      head: polished,
      main: answer.base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        lanes,
        (lane) => checker.script(merged, lane, ["passed"]),
        {
          discard: true,
        }
      )
    );

    const receipt = yield* api.finish(alice, {
      ask,
      base: answer.base,
      head: polished,
      requestId: RequestId.make("finish-alice-03"),
    });

    const landed = yield* mainTip;
    const host = yield* RepoHost;

    const format = yield* host
      .readFile(
        repo,
        Revision.Commit({ sha: landed }),
        RepoPath.make(formatPath)
      )
      .pipe(Effect.orDie);

    return {
      commit: yield* commitOf(landed),
      format: Option.map(format, (bytes) => new TextDecoder().decode(bytes)),
      polished,
      receipt,
      touched,
    };
  });

describe("a finish", () => {
  const seen = Effect.flatMap(begun, finishing).pipe(
    Effect.provide(worldOf(scenario, "memory"))
  );

  it.effect("is a maintainer's, on an answer that waits on one", () =>
    Effect.map(seen, (run) => {
      expect(run.waiting).toStrictEqual([
        Outcome.cases.AwaitingFinish.make({}),
      ]);
      expect(run.bobFinishes).toStrictEqual(new NotDecider({}));
      expect(run.receipt).toStrictEqual({
        ask: AskId.make("format-date"),
        base: run.answer.base,
        head: run.answer.head,
        outcome: Outcome.cases.Checking.make({ stage: "human" }),
        project,
        requestId: RequestId.make("finish-alice-01"),
      });
    })
  );

  it.effect(
    "with the maintainer's commits on top, checks them again from the merge and lands them, the answerer still its author",
    () =>
      Effect.map(
        Effect.flatMap(begun, finishingOnTop).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (run) => {
          expect(run.touched).toStrictEqual(
            new TouchedJudge({ paths: [askOf("format-date").file] })
          );
          expect([run.receipt.head, run.receipt.outcome]).toStrictEqual([
            run.polished,
            Outcome.cases.Checking.make({ stage: "merge" }),
          ]);
          expect(run.format).toStrictEqual(
            Option.some(
              "export const format = (d) => d.toISOString().slice(0, 10);\n"
            )
          );
          expect({
            author: run.commit.author,
            credits: run.commit.trailers.filter(({ key }) =>
              ["Signed-off-by", "Finished-by"].includes(key)
            ),
          }).toStrictEqual({
            author: authorLine(bob.handle),
            credits: [
              { key: "Signed-off-by", value: userOf("bob") },
              { key: "Finished-by", value: userOf("alice") },
            ],
          });
        }
      )
  );

  it.effect(
    "lands the answer credited Finished-by, once however often it is sent, however her sign-in cases her handle",
    () =>
      Effect.map(seen, (run) => {
        expect([run.settled, run.again.outcome]).toStrictEqual([
          [Outcome.cases.Landed.make({ sha: run.landed })],
          Outcome.cases.Landed.make({ sha: run.landed }),
        ]);
        expect({
          author: run.commit.author,
          credits: run.commit.trailers.filter(({ key }) =>
            ["Asked-by", "Signed-off-by", "Finished-by"].includes(key)
          ),
        }).toStrictEqual({
          author: authorLine(bob.handle),
          credits: [
            { key: "Asked-by", value: userOf("alice") },
            { key: "Signed-off-by", value: userOf("bob") },
            { key: "Finished-by", value: userOf("alice") },
          ],
        });
      })
  );
});

const landingOwn = (api: ProjectApi) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const forked = yield* api.fork(alice);
    const again = yield* api.fork(alice);
    const daveForks = yield* api.fork(dave).pipe(Effect.flip);
    const base = yield* mainTip;
    const forkRefs = yield* host.refs(forked.fork).pipe(Effect.orDie);
    const forkMain = forkRefs.get(mainRef);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(
        forked.fork,
        Option.some(base),
        changed(
          start,
          "packages/lexer/src/lex.ts",
          "export const lex = (s) => s.split(/ +/);\n"
        )
      )
    );

    const merged = yield* mergedAt({
      base,
      fork: forked.fork,
      head,
      main: base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        [LaneName.make("lint"), LaneName.make("types")],
        (lane) => checker.script(merged, lane, ["passed"]),
        { discard: true }
      )
    );

    const request = {
      base,
      head,
      message: "Split words on runs of spaces\n\nTwo spaces are one gap.",
      requestId: RequestId.make("land-alice-01"),
    };

    const bobLands = yield* api.land(bob, request).pipe(Effect.flip);
    const receipt = yield* api.land(alice, request);
    const landed = yield* mainTip;

    const skipping = yield* Pusher.use((pusher) =>
      pusher.push(
        forked.fork,
        Option.some(head),
        changed(
          changed(
            start,
            "packages/lexer/src/lex.ts",
            "export const lex = (s) => s.split(/ +/);\n"
          ),
          "packages/lexer/test/lex.test.ts",
          'it.skip("lexes", () => {});\n'
        )
      )
    );

    const weakened = yield* api.land(alice, {
      base: head,
      head: skipping,
      message: "Skip the lexer's test",
      requestId: RequestId.make("land-alice-02"),
    });

    return {
      afterWeakened: yield* mainTip,
      again,
      base,
      bobLands,
      commit: yield* commitOf(landed),
      daveForks,
      forkMain,
      forked,
      jobs: yield* CheckScript.use(({ jobs }) => jobs),
      landed,
      merged,
      receipt,
      replay: yield* api.land(alice, request),
      view: (yield* api.landing(anyone, landed)).landing,
      weakened,
    };
  });

// A land sent under an answer's request id reads nothing of it and replaces nothing.
const landingUnderAnAnswersId = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "parse-iso");

    const answer = yield* answered(api, {
      change: [
        "packages/parser/src/parse.ts",
        "export const parse = (s) => new Date(s);\n",
      ],
      files: withAskFiles(start, "parse-iso"),
      id: "parse-iso",
      who: bob,
    });

    const tip = yield* mainTip;

    yield* api.fork(alice);

    const refused = yield* api
      .land(alice, {
        base: tip,
        head: tip,
        message: "Take the answer's id",
        requestId: answer.receipt.requestId,
      })
      .pipe(Effect.flip);

    return {
      after: (yield* api.status(bob)).answers.map(({ requestId }) => requestId),
      refused,
      requestId: answer.receipt.requestId,
    };
  });

describe("a maintainer's own change", () => {
  const seen = Effect.flatMap(begun, landingOwn).pipe(
    Effect.provide(worldOf(scenario, "memory"))
  );

  it.effect(
    "comes from a working fork that is made once, for vouched people only",
    () =>
      Effect.map(seen, (run) => {
        const fork = RepoName.make(`${keyOf(project)}--me--alice`);

        expect(run.forked).toStrictEqual({
          fork,
          remote: `https://${Brand.domain}/${project}--me--alice.git`,
        });
        expect([run.again, run.forkMain]).toStrictEqual([run.forked, run.base]);
        expect(run.daveForks).toStrictEqual(new NotVouched({}));
      })
  );

  it.effect(
    "passes the same stages and checks after its receipt, and lands once as a platform commit its maintainer authors",
    () =>
      Effect.map(seen, (run) => {
        const receipt = (outcome: Outcome) => ({
          base: run.base,
          head: run.receipt.head,
          outcome,
          project,
          requestId: RequestId.make("land-alice-01"),
        });

        expect(run.bobLands).toStrictEqual(new NotDecider({}));
        // The checks run after the call returns; the same request sent again reads the landing.
        expect([run.receipt, run.replay]).toStrictEqual([
          receipt(Outcome.cases.Checking.make({ stage: "merge" })),
          receipt(Outcome.cases.Landed.make({ sha: run.landed })),
        ]);
        expect({
          author: run.commit.author,
          committer: run.commit.committer,
          parents: run.commit.parents,
          signed: run.commit.trailers.filter(
            ({ key }) => key === "Signed-off-by"
          ),
          subject: run.commit.subject,
        }).toStrictEqual({
          author: authorLine(alice.handle),
          committer: committerLine,
          parents: [run.base],
          signed: [{ key: "Signed-off-by", value: userOf("alice") }],
          subject: "Split words on runs of spaces",
        });
        expect(run.view).toMatchObject({
          author: alice.handle,
          parent: run.base,
          requestId: RequestId.make("land-alice-01"),
          sha: run.landed,
        });
      })
  );

  it.effect(
    "checks its merged tree in the maintainer's working fork, where the Lander's merge leaves it",
    () =>
      Effect.map(seen, (run) => {
        expect(
          run.jobs
            .filter(({ at }) => shaOf(at) === shaOf(run.merged))
            .map((job) => job.repo)
        ).toStrictEqual([run.forked.fork]);
      })
  );

  it.effect(
    "under an answer's request id is refused, and the answer stays",
    () =>
      Effect.map(
        Effect.flatMap(begun, landingUnderAnAnswersId).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (run) => {
          expect(run.refused).toStrictEqual(new NotDecider({}));
          expect(run.after).toStrictEqual([run.requestId]);
        }
      )
  );

  it.effect(
    "is refused by stage 1 when it weakens a check, and main stays",
    () =>
      Effect.map(seen, (run) => {
        expect(run.afterWeakened).toBe(run.landed);
        expect(
          Outcome.guards.Refused(run.weakened.outcome)
            ? run.weakened.outcome.refusals.map(({ _tag }) => _tag)
            : []
        ).toStrictEqual(["Weakened"]);
      })
  );
});

const vouchingWorld = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    return RulesEvaluator.of({
      ...evaluator,
      evaluate: (input) =>
        Effect.map(evaluator.evaluate(input), (policy) => ({
          ...policy,
          vouches: [
            ...policy.vouches,
            ...parseVouchFile(input.facts.vouchFile ?? "").vouches.map(
              ({ denounced, handle }) => ({ denounced, handle })
            ),
          ],
        })),
    });
  })
).pipe(Layer.provideMerge(worldOf(scenario, "memory")));

const vouchFileNow = Effect.gen(function* () {
  const host = yield* RepoHost;
  const at = yield* mainTip;

  const bytes = yield* host
    .readFile(
      repo,
      Revision.Commit({ sha: at }),
      RepoPath.make(`${Brand.configDir}/vouched.td`)
    )
    .pipe(Effect.orDie);

  return Option.map(bytes, (read) => new TextDecoder().decode(read));
});

const vouching = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "lex-tokens");
    yield* openRed(api, "parse-iso");

    const lexTokens = AskId.make("lex-tokens");
    const before = yield* api.claim(dave, lexTokens).pipe(Effect.flip);

    const bobVouches = yield* api
      .vouch(bob, { handle: Handle.make("dave"), verdict: "vouch" })
      .pipe(Effect.flip);

    const vouched = yield* api.vouch(alice, {
      handle: Handle.make("dave"),
      verdict: "vouch",
    });

    const fileAfterVouch = yield* vouchFileNow;
    const commit = yield* commitOf(vouched.landed);
    const claimed = yield* api.claim(dave, lexTokens);

    const again = yield* api.vouch(alice, {
      handle: Handle.make("dave"),
      verdict: "vouch",
    });

    const denounced = yield* api.vouch(alice, {
      handle: Handle.make("erin"),
      note: "pushed  a secret",
      verdict: "denounce",
    });

    return {
      again,
      before,
      bobVouches,
      claimed: claimed.claim.state,
      commit,
      denounced,
      erinClaims: yield* api
        .claim(erin, AskId.make("parse-iso"))
        .pipe(Effect.flip),
      fileAfterVouch,
      fileNow: yield* vouchFileNow,
      vouched,
    };
  });

describe("a vouch", () => {
  const seen = Effect.flatMap(begun, vouching).pipe(
    Effect.provide(vouchingWorld)
  );

  it.effect(
    "is a maintainer's platform landing of the vouch file, with the person added",
    () =>
      Effect.map(seen, (run) => {
        expect(run.bobVouches).toStrictEqual(new NotDecider({}));
        expect(run.fileAfterVouch).toStrictEqual(Option.some("dave\n"));
        expect({
          author: run.commit.author,
          committer: run.commit.committer,
          decided: run.commit.trailers.filter(
            ({ key }) => key === "Decided-by"
          ),
        }).toStrictEqual({
          author: authorLine(alice.handle),
          committer: committerLine,
          decided: [{ key: "Decided-by", value: userOf("alice") }],
        });
        expect(run.again).toStrictEqual(run.vouched);
      })
  );

  it.effect(
    "lets a person claim who could not before, and a denouncement bars one who could",
    () =>
      Effect.map(seen, (run) => {
        expect([run.before, run.claimed]).toStrictEqual([
          new NotVouched({}),
          "live",
        ]);
        expect(run.denounced.landed).not.toBe(run.vouched.landed);
        expect(run.fileNow).toStrictEqual(
          Option.some("dave\n-erin pushed a secret\n")
        );
        expect(run.erinClaims).toStrictEqual(new Denounced({}));
      })
  );
});

// Six deletions of main, an hour apart: each is a decision, and deciding one
// moves nothing.
const filling = (api: ProjectApi) =>
  Effect.gen(function* () {
    const first = yield* mainTip;

    yield* Effect.forEach(
      Array.range(1, 6),
      (n) =>
        Effect.andThen(
          advanceTo(DateTime.formatIso(DateTime.add(noon, { hours: n - 1 }))),
          api.recordPush({
            after: CommitSha.make("0".repeat(40)),
            before: Option.some(first),
            eventId: `evt-deleted-${n}`,
            pusher: anyone,
            ref: "refs/heads/main",
            repo,
          })
        ),
      { discard: true }
    );

    const full = yield* api.today(alice);

    yield* api.decide(alice, {
      choice: "decline",
      decision: firstDecision,
      note: "Not this one",
    });

    return {
      afterOne: yield* api.today(alice),
      bobToday: yield* api.today(bob).pipe(Effect.flip),
      full,
    };
  });

const idsOf = (decisions: readonly { readonly id: DecisionId }[]) =>
  decisions.map(({ id }) => id);

const decisionIds = (from: number, to: number) =>
  Array.range(from, to).map((n) =>
    DecisionId.make(`dec-${String(n).padStart(6, "0")}`)
  );

describe("Today", () => {
  it.effect(
    "shows a maintainer every open decision, soonest to expire first; one taken leaves the list",
    () =>
      Effect.map(
        Effect.flatMap(begun, filling).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (seen) => {
          expect({
            decider: seen.full.decider,
            decisions: idsOf(seen.full.decisions),
          }).toStrictEqual({
            decider: alice.handle,
            decisions: decisionIds(1, 6),
          });
          expect(idsOf(seen.afterOne.decisions)).toStrictEqual(
            decisionIds(2, 6)
          );
          expect(seen.bobToday).toStrictEqual(new NotDecider({}));
        }
      )
  );
});

const burrow = ProjectName.make("alice/burrow");

const row = (name: ProjectName, role: "Asked-by" | "Signed-off-by") => ({
  area: "parser",
  count: 1,
  project: name,
  role,
});

const crediting = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const projects = yield* Projects;

  const answerIn = (name: ProjectName, who: Person) =>
    Effect.gen(function* () {
      const on = RepoName.make(keyOf(name));
      const api = yield* made(yield* projects.create(name), on);

      yield* openRed(api, "parse-iso", on);
      yield* answered(api, {
        change: [
          "packages/parser/src/parse.ts",
          "export const parse = (s) => ({ year: 2026 });\n",
        ],
        files: withAskFiles(start, "parse-iso"),
        id: "parse-iso",
        on,
        who,
      });

      return api;
    });

  const datekit = yield* answerIn(project, bob);

  yield* answerIn(burrow, carol);

  const among = [project, burrow];

  return {
    alice: yield* creditsFor(alice.handle, among),
    bob: yield* creditsFor(bob.handle, among),
    bobInDatekit: yield* datekit.credits(anyone, bob.handle),
    dave: yield* creditsFor(dave.handle, among),
  };
});

// Assisted-by never reaches a credit row; no answer here carries an agent trailer.
describe("credits", () => {
  it.effect("count a person's roles by project and area across projects", () =>
    Effect.map(
      crediting.pipe(
        Effect.provide(
          ProjectsMemory.pipe(Layer.provideMerge(worldOf(scenario, "memory")))
        )
      ),
      (seen) => {
        expect(seen.bob).toStrictEqual([row(project, "Signed-off-by")]);
        expect(seen.bobInDatekit).toStrictEqual({ credits: seen.bob });
        expect(seen.alice).toStrictEqual([
          row(burrow, "Asked-by"),
          row(project, "Asked-by"),
        ]);
        expect(seen.dave).toStrictEqual([]);
      }
    )
  );
});

const strayOnto = (first: CommitSha) =>
  Pusher.use((pusher) =>
    pusher.push(
      repo,
      Option.some(first),
      changed(
        start,
        "packages/trim/src/trim.ts",
        "export const trim = (s) => s.trimEnd();\n"
      ),
      "Stray"
    )
  );

const reported = (
  api: ProjectApi,
  eventId: string,
  move: { readonly after: CommitSha; readonly before?: CommitSha }
) =>
  api.recordPush({
    after: move.after,
    before: Option.fromUndefinedOr(move.before),
    eventId,
    pusher: anyone,
    ref: "refs/heads/main",
    repo,
  });

const strayReported = Effect.gen(function* () {
  const api = yield* begun;
  const first = yield* mainTip;

  yield* reported(api, "evt-first", { after: first });

  const { landed } = yield* openRed(api, "parse-iso");

  yield* reported(api, "evt-landed", { after: landed, before: first });

  const stray = yield* strayOnto(landed);

  yield* reported(api, "evt-stray", { after: stray, before: landed });
  yield* reported(api, "evt-stray", { after: stray, before: landed });

  return {
    decisions: (yield* api.today(alice)).decisions.map(
      ({ deciders, default: byDefault, expiresAt, subject }) => ({
        byDefault,
        deciders,
        expiresAt,
        subject,
      })
    ),
    first,
    firstLanding: Exit.map(
      yield* Effect.exit(api.landing(alice, first)),
      ({ landing }) => ({ ask: landing.ask, author: landing.author })
    ),
    landed,
    stray,
  };
});

const strayDecided = (choice: "accept" | "decline") =>
  Effect.gen(function* () {
    const api = yield* begun;
    const host = yield* RepoHost;
    const first = yield* mainTip;
    const stray = yield* strayOnto(first);

    yield* reported(api, "evt-stray", { after: stray, before: first });

    const decided = yield* api.decide(alice, {
      choice,
      decision: firstDecision,
    });

    const tip = yield* mainTip;

    const treeOf = (sha: CommitSha) =>
      Effect.map(host.readCommit(repo, sha).pipe(Effect.orDie), (read) =>
        Option.map(read, ({ tree }) => tree)
      );

    return {
      commit: yield* commitOf(tip),
      decided: decided.decision.decided?.choice,
      first,
      firstTree: yield* treeOf(first),
      landed: Option.flatMap((yield* stored).project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      ),
      stray,
      tip,
      tipTree: yield* treeOf(tip),
    };
  });

const deletedDecided = (choice: "accept" | "decline") =>
  Effect.gen(function* () {
    const api = yield* begun;
    const first = yield* mainTip;

    yield* reported(api, "evt-deleted", {
      after: CommitSha.make("0".repeat(40)),
      before: first,
    });

    const decided = yield* api.decide(alice, {
      choice,
      decision: firstDecision,
    });

    return {
      decided: decided.decision.decided?.choice,
      first,
      landed: Option.flatMap((yield* stored).project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      ),
      tip: yield* mainTip,
    };
  });

describe("a stray push", () => {
  it.effect.each(["accept", "decline"] as const)(
    "that deleted main is put to the maintainers, and decided %s moves neither main nor the landed SHA",
    (choice) =>
      Effect.map(
        deletedDecided(choice).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (seen) => {
          expect([seen.decided, seen.tip, seen.landed]).toStrictEqual([
            choice === "accept" ? "adopt" : "revert",
            seen.first,
            Option.some(seen.first),
          ]);
        }
      )
  );

  it.effect(
    "reported by OnPush opens one StrayPush decision, default revert, however often the event comes; main moved by the platform opens none",
    () =>
      Effect.map(
        strayReported.pipe(Effect.provide(worldOf(scenario, "memory"))),
        (seen) => {
          expect(seen.decisions).toStrictEqual([
            {
              byDefault: "revert",
              deciders: [alice.handle],
              expiresAt: daysAfter(noon, 14),
              subject: DecisionSubject.cases.StrayPush.make({
                after: seen.stray,
                before: seen.landed,
                ref: RefNameText.make("refs/heads/main"),
              }),
            },
          ]);
          expect(seen.firstLanding).toStrictEqual(
            Exit.succeed({ ask: undefined, author: alice.handle })
          );
        }
      )
  );

  it.effect(
    "decided revert lands a commit on top of it with the tree it replaced, and a Reverts trailer",
    () =>
      Effect.map(
        strayDecided("decline").pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (seen) => {
          expect(seen.decided).toBe("revert");
          expect(seen.landed).toStrictEqual(Option.some(seen.tip));
          expect(seen.tipTree).toStrictEqual(seen.firstTree);
          expect({
            author: seen.commit.author,
            committer: seen.commit.committer,
            parents: seen.commit.parents,
            trailers: seen.commit.trailers.filter(({ key }) =>
              ["Decided-by", "Reverts"].includes(key)
            ),
          }).toStrictEqual({
            author: authorLine(alice.handle),
            committer: committerLine,
            parents: [seen.stray],
            trailers: [
              { key: "Decided-by", value: userOf("alice") },
              { key: "Reverts", value: seen.stray },
            ],
          });
        }
      )
  );

  it.effect("decided adopt becomes the landed SHA, and main stays", () =>
    Effect.map(
      strayDecided("accept").pipe(Effect.provide(worldOf(scenario, "memory"))),
      (seen) => {
        expect(seen.decided).toBe("adopt");
        expect([seen.tip, seen.landed]).toStrictEqual([
          seen.stray,
          Option.some(seen.stray),
        ]);
      }
    )
  );
});
