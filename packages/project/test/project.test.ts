import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { authorLine, committerLine, parseTrailers } from "@repo/git/trailers";
import { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Glob } from "@repo/protocol/domain/common";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  AskFull,
  ClaimLapsed,
  DirectPush,
  ImportFailed,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  OutOfScope,
  ProjectExists,
  StaleBase,
  TouchedJudge,
  UnknownProject,
} from "@repo/protocol/refusal";
import { advanceTo, at as instant } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import {
  Array,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";

import { ScheduledAlarm } from "../src/alarms/memory.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { ProjectedRows } from "../src/projection/memory.ts";
import { Projects } from "../src/projects.ts";
import { ProjectsMemory } from "../src/projects/memory.ts";
import {
  CheckScript,
  cleanMergeAt,
  composedAt,
  Evaluated,
  mergedAt,
  Pusher,
  worldOf,
} from "./world.ts";
import type { StoreKind, WorldScenario } from "./world.ts";

const people = ["bob", "carol", "dave", "eve", "frank"];

const scenario = aProject({ people }).pipe(
  withVouches(people),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "parse-green", territory: "packages/parser" }),
  withAsk({ id: "format-date", territory: "packages/format" }),
  withAsk({ id: "lex-tokens", territory: "packages/lexer" }),
  withAsk({ id: "trim-input", territory: "packages/trim" }),
  withAsk({ id: "tidy-all", territory: "." })
);

const { project } = scenario;

const repo = RepoName.make(project);

const mainRef = RefName.make("refs/heads/main");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

const bob = person("bob");

const carol = person("carol");

const dave = person("dave");

const eve = person("eve");

const frank = person("frank");

const anyone = Anonymous.make({});

const remoteOf = (name: string) => `https://${Brand.domain}/${name}.git`;

const forkOf = (ask: string, who: Person) =>
  RepoName.make(`${project}--${ask}--${who.handle}`);

const userOf = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

const askOf = (id: string): Ask =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const redThenGreen = LaneName.make("redThenGreen");

const lanes = [redThenGreen, LaneName.make("lint"), LaneName.make("types")];

const noon = instant("2026-10-07T12:00:00Z");

const hoursAfter = (from: DateTime.Utc, count: number) =>
  DateTime.add(from, { hours: count });

/** The project as alice first pushes it: a library of four small packages. */
const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  [
    "packages/format/src/format.ts",
    "export const format = (d) => String(d);\n",
  ],
  ["packages/lexer/src/lex.ts", "export const lex = (s) => s.split(' ');\n"],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

const fixedParse = "export const parse = (s) => ({ year: 2026 });\n";

/** An ask's own files: its file in the config folder, and its check. */
const askFiles = (id: string) => {
  const { check, file, territory } = askOf(id);
  const subject = territory.module === "." ? "tidy" : territory.module;

  return Array.make(
    { content: `export default "${id}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { ${subject} } from "../src/${subject}.ts";`,
        ``,
        `it("${id}", () => {`,
        `  expect(${subject}("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${id}.test.ts`),
    }
  );
};

/** The files main holds after `ids`' asks opened on it. */
const withAskFiles = (files: Files, ...ids: readonly string[]): Files => [
  ...files,
  ...ids.flatMap((id) =>
    askFiles(id).map(({ content, path }) => [path, content] as const)
  ),
];

/** `files` with `path` holding `content`, added or replaced. */
const changed = (files: Files, path: string, content: string): Files => [
  ...files.filter(([each]) => each !== path),
  [path, content],
];

/** Where canonical `main` stands now. */
const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

const commitOf = (sha: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const read = yield* host.readCommit(repo, sha).pipe(Effect.orDie);
    const { author, committer, message, parents } = Option.getOrThrow(read);

    return { author, committer, parents, trailers: parseTrailers(message) };
  });

/** Every lane on `on` scripted to come out `result` each time. */
const scriptAll = (
  on: Parameters<CheckScript["Service"]["script"]>[0],
  result: "passed" | "failed"
) =>
  CheckScript.use((checker) =>
    Effect.forEach(lanes, (lane) => checker.script(on, lane, [result]), {
      discard: true,
    })
  );

/** `decider` opens an ask whose check the Checker fails twice the same way on the composed tree. */
const openRed = (api: ProjectApi, id: string, decider: Person = alice) =>
  Effect.gen(function* () {
    const files = askFiles(id);
    const composed = yield* composedAt(repo, yield* mainTip, files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, redThenGreen, ["failed", "failed"])
    );

    return yield* api.openAsk(decider, { ask: AskId.make(id), files });
  });

/** What each event is, in the order the project numbered them. */
const eventTags = (api: ProjectApi) =>
  Effect.map(api.events(0, 1000), (events) =>
    events.map(({ event }) => event._tag)
  );

const scheduled = ScheduledAlarm.use(({ at }) => at);

/** The project's state as its store keeps it, once it is made. */
const projectState = ProjectStore.use((store) => store.load()).pipe(
  Effect.map(({ project: row }) => Option.map(row, ({ state }) => state))
);

const states = (api: ProjectApi, who: Person) =>
  Effect.map(api.status(who), ({ claims }) => claims.map(({ state }) => state));

const outcomes = (api: ProjectApi, who: Person) =>
  Effect.map(api.status(who), ({ answers }) =>
    answers.map(({ outcome }) => outcome)
  );

const parseIso = AskId.make("parse-iso");

/** Steps 1 and 2: the project made, and its first ask opened. */
const opening = (api: ProjectApi) =>
  Effect.gen(function* () {
    const unmade = yield* api.firstPusher();
    const made = yield* Effect.exit(api.initProject(alice, {}));
    const awaiting = yield* projectState;
    const awaitedFrom = yield* api.firstPusher();

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    const notHers = yield* api.recordFirstPush(bob, first).pipe(Effect.flip);
    const recorded = yield* api.recordFirstPush(alice, first);
    const firstPushers = [unmade, awaitedFrom, yield* api.firstPusher()];
    const evaluated = yield* Evaluated.use(({ shas }) => shas);
    const opened = yield* openRed(api, "parse-iso");
    const redFirstJobs = yield* CheckScript.use(({ jobs }) => jobs);
    const greenFiles = askFiles("parse-green");

    yield* scriptAll(
      yield* composedAt(repo, opened.landed, greenFiles),
      "passed"
    );

    const green = { ask: AskId.make("parse-green"), files: greenFiles };
    const greenRefused = yield* api.openAsk(alice, green).pipe(Effect.flip);
    const bobRefused = yield* api.openAsk(bob, green).pipe(Effect.flip);

    return {
      asked: yield* commitOf(opened.landed),
      awaiting,
      bobRefused,
      evaluated,
      first,
      firstPushers,
      greenRefused,
      listed: yield* api.listAsks(anyone),
      made,
      mainAfterRefusals: yield* mainTip,
      notHers,
      opened,
      recorded,
      redFirstJobs,
      shown: yield* api.showAsk(anyone, parseIso),
    };
  });

/** Steps 3 and 4: bob claims, then pushes out of his territory. */
const claiming = (api: ProjectApi, opened: LandedSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const bobFork = forkOf("parse-iso", bob);
    const { claim } = yield* api.claim(bob, parseIso);
    const forkRefs = yield* host.refs(bobFork).pipe(Effect.orDie);
    const alarmAfterClaim = yield* scheduled;
    const carolRefused = yield* api.claim(carol, parseIso).pipe(Effect.flip);

    const carolFork = yield* Effect.exit(host.refs(forkOf("parse-iso", carol)));

    const wideFiles = changed(
      changed(
        changed(
          withAskFiles(start, "parse-iso"),
          "packages/parser/src/parse.ts",
          fixedParse
        ),
        "packages/format/src/format.ts",
        "export const format = (d) => d.toString();\n"
      ),
      ".github/workflows/ci.yml",
      "on: push\n"
    );

    const wide = yield* Pusher.use((pusher) =>
      pusher.push(bobFork, Option.some(opened), wideFiles)
    );

    const wideRefusals = yield* api.recordPush({
      after: wide,
      before: Option.some(opened),
      eventId: "push-wide",
      pusher: bob,
      ref: "refs/heads/main",
      repo: bobFork,
    });

    const wideSubmitted = yield* api
      .submitAnswer(bob, {
        ask: parseIso,
        base: opened,
        head: wide,
        requestId: RequestId.make("req-wide-0001"),
      })
      .pipe(Effect.flip);

    return {
      alarmAfterClaim,
      carolFork,
      carolRefused,
      claim,
      forkMain: forkRefs.get(mainRef),
      wide,
      wideRefusals,
      wideSubmitted,
    };
  });

/** Steps 5 and 6: bob's fix is checked green and lands, and a replay changes nothing. */
const landing = (api: ProjectApi, opened: LandedSha, wide: CommitSha) =>
  Effect.gen(function* () {
    const bobFork = forkOf("parse-iso", bob);

    const fixedFiles = changed(
      withAskFiles(start, "parse-iso"),
      "packages/parser/src/parse.ts",
      fixedParse
    );

    const fix = yield* Pusher.use((pusher) =>
      pusher.push(bobFork, Option.some(wide), fixedFiles)
    );

    const fixRefusals = yield* api.recordPush({
      after: fix,
      before: Option.some(wide),
      eventId: "push-fix",
      pusher: bob,
      ref: "refs/heads/main",
      repo: bobFork,
    });

    yield* scriptAll(
      yield* mergedAt({
        base: opened,
        fork: bobFork,
        head: fix,
        main: opened,
        repo,
      }),
      "passed"
    );

    const requestId = RequestId.make("req-fix-0001");
    const submission = { ask: parseIso, base: opened, head: fix, requestId };
    const receipt = yield* api.submitAnswer(bob, submission);
    const landed = yield* mainTip;
    const { verdict } = yield* api.verdict(anyone, { ask: parseIso });

    const roundTrip = yield* Option.match(Option.fromUndefinedOr(verdict), {
      onNone: () => Effect.succeedNone,
      onSome: (made) =>
        Schema.encodeEffect(Verdict)(made).pipe(
          Effect.flatMap(Schema.decodeEffect(Verdict)),
          Effect.asSome,
          Effect.orDie
        ),
    });

    return {
      events: yield* eventTags(api),
      fix,
      fixRefusals,
      fixedFiles,
      landed,
      landing: yield* commitOf(landed),
      listedAfter: yield* api.listAsks(anyone),
      projected: yield* ProjectedRows.use(({ events }) =>
        Effect.map(events, (rows) => rows.map(({ event }) => event._tag))
      ),
      receipt,
      replay: yield* api.submitAnswer(bob, submission),
      replayByCarol: yield* Effect.result(api.submitAnswer(carol, submission)),
      requestId,
      roundTrip,
      status: yield* api.status(bob),
      tipAfterReplay: yield* mainTip,
      verdict,
      view: (yield* api.landing(anyone, landed)).landing,
    };
  });

/** Step 7: dave claims and never pushes; warned at 2 h, lapsed at 24 h. */
const lapsing = (api: ProjectApi, files: Files) =>
  Effect.gen(function* () {
    const formatDate = AskId.make("format-date");

    yield* openRed(api, "format-date");
    yield* api.claim(dave, formatDate);

    const alarmAfterClaim = yield* scheduled;

    yield* advanceTo("2026-10-07T14:00:00Z");
    yield* api.onAlarm();

    const warned = {
      alarm: yield* scheduled,
      last: (yield* eventTags(api)).at(-1),
      states: yield* states(api, dave),
    };

    yield* advanceTo("2026-10-08T12:00:00Z");
    yield* api.onAlarm();

    const lapsed = {
      last: (yield* eventTags(api)).at(-1),
      states: yield* states(api, dave),
    };

    const base = yield* mainTip;

    const late = yield* Pusher.use((pusher) =>
      pusher.push(
        forkOf("format-date", dave),
        Option.some(base),
        changed(
          withAskFiles(files, "format-date"),
          "packages/format/src/format.ts",
          "export const format = (d) => ({ year: 2026 });\n"
        )
      )
    );

    const lateRefused = yield* api
      .submitAnswer(dave, {
        ask: formatDate,
        base,
        head: late,
        requestId: RequestId.make("req-late-0001"),
      })
      .pipe(Effect.flip);

    return { alarmAfterClaim, lapsed, lateRefused, warned };
  });

/** Who answers in a race, with which ask and which change. */
interface Racer {
  readonly ask: string;
  readonly change: readonly [path: string, content: string];
  readonly who: Person;
}

/**
 * Step 8: two answers on one base. The first one's Checker cannot start, so
 * it waits on a retry while the second lands; then its land finds main
 * moved, and it is merged again onto the new main.
 */
const racing = (
  api: ProjectApi,
  files: Files,
  [first, second]: readonly [Racer, Racer]
) =>
  Effect.gen(function* () {
    yield* openRed(api, first.ask);
    yield* openRed(api, second.ask);

    const base = yield* mainTip;
    const onBase = withAskFiles(files, "format-date", first.ask, second.ask);

    const answer = (racer: Racer) =>
      Effect.gen(function* () {
        const fork = forkOf(racer.ask, racer.who);

        yield* api.claim(racer.who, AskId.make(racer.ask));

        const head = yield* Pusher.use((pusher) =>
          pusher.push(fork, Option.some(base), changed(onBase, ...racer.change))
        );

        return { fork, head };
      });

    const submit = (racer: Racer, head: CommitSha) =>
      api.submitAnswer(racer.who, {
        ask: AskId.make(racer.ask),
        base,
        head,
        requestId: RequestId.make(`req-${racer.ask}`),
      });

    const one = yield* answer(first);
    const other = yield* answer(second);

    yield* submit(first, one.head);

    const waiting = yield* outcomes(api, first.who);

    yield* scriptAll(
      yield* mergedAt({ ...other, base, main: base, repo }),
      "passed"
    );
    yield* submit(second, other.head);

    const between = yield* mainTip;

    // Now the first one's checks pass on its merge, and on a clean re-merge.
    yield* scriptAll(
      yield* mergedAt({ ...one, base, main: base, repo }),
      "passed"
    );

    const remerged = yield* cleanMergeAt({ ...one, base, main: between, repo });

    if (Option.isSome(remerged)) {
      yield* scriptAll(remerged.value, "passed");
    }

    yield* advanceTo(DateTime.formatIso(Option.getOrThrow(yield* scheduled)));
    yield* api.onAlarm();

    const tip = yield* mainTip;

    return {
      base,
      between,
      betweenParents: (yield* commitOf(between)).parents,
      outcomes: yield* outcomes(api, first.who),
      tip,
      tipParents: (yield* commitOf(tip)).parents,
      waiting,
    };
  });

/** Steps 1 to 7, once, recording what each step saw. */
const core = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const opened = yield* opening(api);
  const claimed = yield* claiming(api, opened.opened.landed);
  const answered = yield* landing(api, opened.opened.landed, claimed.wide);
  const lapsed = yield* lapsing(api, answered.fixedFiles);

  return { answered, api, claimed, lapsed, opened };
});

/** The whole core loop, step 8's race included. */
const story = Effect.gen(function* () {
  const { api, ...seen } = yield* core;

  const raced = yield* racing(api, seen.answered.fixedFiles, [
    {
      ask: "lex-tokens",
      change: [
        "packages/lexer/src/lex.ts",
        "export const lex = (s) => s.split(/ +/);\n",
      ],
      who: eve,
    },
    {
      ask: "trim-input",
      change: [
        "packages/trim/src/trim.ts",
        "export const trim = (s) => s.trim();\n",
      ],
      who: frank,
    },
  ]);

  return { ...seen, raced };
});

/** Step 8 with a re-merge that conflicts: the second answer touched the same line. */
const conflicting = Effect.gen(function* () {
  const { api, answered } = yield* core;

  return yield* racing(api, answered.fixedFiles, [
    {
      ask: "lex-tokens",
      change: [
        "packages/lexer/src/lex.ts",
        "export const lex = (s) => s.split(/ +/);\n",
      ],
      who: eve,
    },
    {
      ask: "tidy-all",
      change: [
        "packages/lexer/src/lex.ts",
        "export const lex = (s) => s.split('\\t');\n",
      ],
      who: frank,
    },
  ]);
});

describe.each(["memory", "sqlite"] as const)(
  "one project over memory adapters, its store in %s",
  (store: StoreKind) => {
    const seen = story.pipe(Effect.provide(worldOf(scenario, store)));

    it.effect(
      "1. alice makes it empty, and her first push becomes its landed SHA",
      () =>
        Effect.map(seen, ({ opened }) => {
          expect(opened.made).toStrictEqual(
            Exit.succeed({ project, remote: remoteOf(project) })
          );
          expect(opened.awaiting).toStrictEqual(
            Option.some("awaitingFirstPush")
          );
          expect(opened.notHers).toStrictEqual(
            new DirectPush({ ref: mainRef })
          );
          expect(opened.recorded).toStrictEqual({ landed: opened.first });
          expect(opened.evaluated).toStrictEqual([opened.first]);
        })
    );

    it.effect(
      "1. its first push is awaited from alice from when she makes it until she pushes it, and from no one before or after",
      () =>
        Effect.map(seen, ({ opened }) => {
          expect(opened.firstPushers).toStrictEqual([
            Option.none(),
            Option.some(alice.handle),
            Option.none(),
          ]);
        })
    );

    it.effect(
      "2. an ask red twice on the composed tree lands as a platform commit asked by alice",
      () =>
        Effect.map(seen, ({ opened }) => {
          const { asked, first, opened: open } = opened;

          expect({
            askedBy: open.ask.askedBy,
            openedIn: open.ask.openedIn,
            state: open.ask.state,
          }).toStrictEqual({
            askedBy: alice.handle,
            openedIn: open.landed,
            state: "open",
          });
          expect({
            author: asked.author,
            committer: asked.committer,
            parents: asked.parents,
          }).toStrictEqual({
            author: authorLine(alice.handle),
            committer: committerLine,
            parents: [first],
          });
          expect(asked.trailers).toContainEqual({
            key: "Asked-by",
            value: userOf("alice"),
          });
          expect(opened.listed).toStrictEqual({
            asks: [
              {
                ask: parseIso,
                blockedBy: [],
                claimed: false,
                kind: askOf("parse-iso").kind,
                territory: "parser",
                want: askOf("parse-iso").brief.want,
              },
            ],
          });
          expect({
            ask: opened.shown.ask,
            readsWant: opened.shown.brief.includes(open.ask.brief.want),
          }).toStrictEqual({ ask: open.ask, readsWant: true });
        })
    );

    // Live on dev-oscabriel (311): the Checker blocked every red-first run
    // with "the job carries no run block", since a job did not carry one.
    it.effect(
      "2. red first runs the ask's check twice on the composed commit, each run in the project's own setup",
      () =>
        Effect.map(seen, ({ opened }) => {
          expect(
            opened.redFirstJobs.map(({ at, lanes: ran, run }) => ({
              at: CheckAt.guards.Commit(at),
              lanes: ran.map(({ lane }) => lane),
              run,
            }))
          ).toStrictEqual(
            [1, 2].map(() => ({
              at: true,
              lanes: [redThenGreen],
              run: scenario.policy.run,
            }))
          );
        })
    );

    it.effect(
      "2. an ask green on main is not red first, and only a decider opens one",
      () =>
        Effect.map(seen, ({ opened }) => {
          expect(opened.greenRefused).toStrictEqual(new NotRedFirst({}));
          expect(opened.bobRefused).toStrictEqual(new NotDecider({}));
          expect(opened.mainAfterRefusals).toBe(opened.opened.landed);
        })
    );

    it.effect(
      "3. bob claims it and gets his fork; carol finds it full and gets none",
      () =>
        Effect.map(seen, ({ claimed, opened }) => {
          const bobFork = forkOf("parse-iso", bob);

          expect(claimed.claim).toStrictEqual(
            ClaimView.make({
              ask: parseIso,
              base: opened.opened.landed,
              checkCommand: "bun test packages/parser/test/parse-iso.test.ts",
              claimant: bob.handle,
              fork: bobFork,
              lapsesAt: hoursAfter(noon, 24),
              openedAt: noon,
              project,
              remote: remoteOf(bobFork),
              state: "live",
              warnsAt: hoursAfter(noon, 2),
            })
          );
          expect(claimed.forkMain).toBe(opened.opened.landed);
          expect(claimed.alarmAfterClaim).toStrictEqual(
            Option.some(hoursAfter(noon, 2))
          );
          expect(claimed.carolRefused).toStrictEqual(
            new AskFull({ ask: parseIso })
          );
          expect(Exit.isFailure(claimed.carolFork)).toBeTruthy();
        })
    );

    it.effect(
      "4. a push out of territory that edits CI hears both at once; submitting it is OutOfScope",
      () =>
        Effect.map(seen, ({ claimed }) => {
          const outside = new OutOfScope({
            paths: [RepoPath.make("packages/format/src/format.ts")],
          });

          expect(claimed.wideRefusals).toStrictEqual([
            outside,
            new TouchedJudge({
              paths: [RepoPath.make(".github/workflows/ci.yml")],
            }),
          ]);
          expect(claimed.wideSubmitted).toStrictEqual(outside);
        })
    );

    it.effect(
      "5. the fix is checked and lands, authored by bob, committed by the platform, credited",
      () =>
        Effect.map(seen, ({ answered, opened }) => {
          expect(answered.fixRefusals).toStrictEqual([]);
          expect(answered.receipt).toStrictEqual({
            ask: parseIso,
            base: opened.opened.landed,
            head: answered.fix,
            outcome: Outcome.cases.Checking.make({ stage: "merge" }),
            project,
            requestId: answered.requestId,
          });
          expect({
            author: answered.landing.author,
            committer: answered.landing.committer,
            parents: answered.landing.parents,
          }).toStrictEqual({
            author: authorLine(bob.handle),
            committer: committerLine,
            parents: [opened.opened.landed],
          });
          expect(
            answered.landing.trailers.filter(({ key }) =>
              ["Asked-by", "Signed-off-by"].includes(key)
            )
          ).toStrictEqual([
            { key: "Asked-by", value: userOf("alice") },
            { key: "Signed-off-by", value: userOf("bob") },
          ]);
        })
    );

    it.effect(
      "5. status, the verdict, the landing and the asks read the landing back",
      () =>
        Effect.map(seen, ({ answered, opened }) => {
          expect({
            answers: answered.status.answers.map(({ outcome, requestId }) => ({
              outcome,
              requestId,
            })),
            claims: answered.status.claims.map(({ state }) => state),
          }).toStrictEqual({
            answers: [
              {
                outcome: Outcome.cases.Landed.make({ sha: answered.landed }),
                requestId: answered.requestId,
              },
            ],
            claims: ["answered"],
          });
          expect(answered.roundTrip).toStrictEqual(
            Option.fromUndefinedOr(answered.verdict)
          );
          expect({
            head: answered.verdict?.head,
            lanes: answered.verdict?.lanes.map(({ lane, result }) => ({
              lane,
              result,
            })),
          }).toStrictEqual({
            head: answered.fix,
            lanes: lanes.map((lane) => ({ lane, result: "passed" })),
          });
          expect(answered.view).toMatchObject({
            ask: parseIso,
            author: bob.handle,
            credits: [
              { handle: alice.handle, role: "Asked-by" },
              { handle: bob.handle, role: "Signed-off-by" },
            ],
            parent: opened.opened.landed,
            requestId: answered.requestId,
            sha: answered.landed,
            verdict: {
              outcome: Outcome.cases.Landed.make({ sha: answered.landed }),
            },
          });
          expect(answered.listedAfter).toStrictEqual({ asks: [] });
        })
    );

    it.effect(
      "5. its events come in order, and the projection heard every one",
      () =>
        Effect.map(seen, ({ answered }) => {
          expect(answered.events).toStrictEqual([
            "AskOpened",
            "Claimed",
            "Pushed",
            "Pushed",
            "Judged",
            "Landed",
            "AskClosed",
          ]);
          expect(answered.projected).toStrictEqual(answered.events);
        })
    );

    it.effect(
      "6. the same request again gets the same receipt, and nothing lands twice; nobody else's request is theirs",
      () =>
        Effect.map(seen, ({ answered }) => {
          expect(answered.replay).toStrictEqual(answered.receipt);
          expect(answered.tipAfterReplay).toBe(answered.landed);
          expect(answered.replayByCarol).toStrictEqual(
            Result.fail(NotClaimed.of(parseIso))
          );
        })
    );

    it.effect(
      "7. a claim with no push is warned at 2 h and lapses at 24 h, and its answer is refused",
      () =>
        Effect.map(seen, ({ lapsed }) => {
          expect(lapsed.alarmAfterClaim).toStrictEqual(
            Option.some(hoursAfter(noon, 2))
          );
          expect(lapsed.warned).toStrictEqual({
            alarm: Option.some(hoursAfter(noon, 24)),
            last: "Warned",
            states: ["warned"],
          });
          expect(lapsed.lapsed).toStrictEqual({
            last: "Lapsed",
            states: ["lapsed"],
          });
          expect(lapsed.lateRefused).toStrictEqual(
            ClaimLapsed.of(AskId.make("format-date"))
          );
        })
    );

    it.effect(
      "8. an answer whose land finds main moved re-merges cleanly and lands after the other",
      () =>
        Effect.map(seen, ({ raced }) => {
          expect(raced.waiting).toStrictEqual([
            Outcome.cases.Checking.make({ stage: "checks" }),
          ]);
          expect(raced.betweenParents).toStrictEqual([raced.base]);
          expect(raced.tipParents).toStrictEqual([raced.between]);
          expect(raced.outcomes).toStrictEqual([
            Outcome.cases.Landed.make({ sha: raced.tip }),
          ]);
        })
    );

    it.effect(
      "8. an answer whose re-merge conflicts is refused as stale, and main stays",
      () =>
        Effect.map(
          conflicting.pipe(Effect.provide(worldOf(scenario, store))),
          (raced) => {
            expect(raced.tip).toBe(raced.between);
            expect(raced.outcomes).toStrictEqual([
              Outcome.cases.Refused.make({
                refusals: [
                  new StaleBase({
                    base: raced.base,
                    conflicts: [RepoPath.make("packages/lexer/src/lex.ts")],
                    main: raced.between,
                  }),
                ],
              }),
            ]);
          }
        )
    );
  }
);

/** The project up to bob's claim, in a world whose first fork and first projection fail. */
const settling = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);
  yield* openRed(api, "parse-iso");
  yield* api.claim(bob, parseIso);

  const fork = forkOf("parse-iso", bob);
  const host = yield* RepoHost;

  const outboxOf = ProjectStore.use((store) => store.load()).pipe(
    Effect.map(({ outbox }) => outbox.map(({ kind }) => kind).toSorted())
  );

  const before = {
    alarm: yield* scheduled,
    fork: Exit.isSuccess(yield* Effect.exit(host.refs(fork))),
    outbox: yield* outboxOf,
  };

  yield* advanceTo(DateTime.formatIso(Option.getOrThrow(before.alarm)));
  yield* api.onAlarm();

  return {
    after: {
      fork: Exit.isSuccess(yield* Effect.exit(host.refs(fork))),
      outbox: yield* outboxOf,
      projected: yield* ProjectedRows.use(({ events }) =>
        Effect.map(events, (rows) => rows.map(({ event }) => event._tag))
      ),
    },
    before,
  };
});

/** Two projects made through `ProjectsMemory`, each over its own store. */
const routing = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const projects = yield* Projects;
  const other = ProjectName.make("burrow");
  const made = yield* projects.create(project);
  const again = yield* projects.create(project).pipe(Effect.flip);
  const unknown = yield* projects.get(other).pipe(Effect.flip);

  yield* made.initProject(alice, {});
  yield* projects.create(other);

  const found = yield* projects.get(project);

  return {
    again,
    initializedAgain: yield* found.initProject(alice, {}).pipe(Effect.flip),
    otherInitialized: yield* Effect.exit(
      Effect.flatMap(projects.get(other), (api) => api.initProject(bob, {}))
    ),
    unknown,
  };
});

/** A project adopted from a public repo: its tip is the first landed SHA. */
const importing = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const host = yield* RepoHost;
  const upstream = RepoName.make("upstream");

  yield* host.create(upstream).pipe(Effect.orDie);

  const tip = yield* Pusher.use((pusher) =>
    pusher.push(upstream, Option.none(), start, "Start")
  );

  const api = yield* projectService(project);

  // A repo it can't read leaves no project behind: the next import works.
  const refused = yield* api
    .initProject(alice, { import: { url: "https://example.com/none.git" } })
    .pipe(Effect.flip);

  const made = yield* api.initProject(alice, {
    import: { url: "https://example.com/upstream.git" },
  });

  return {
    evaluated: yield* Evaluated.use(({ shas }) => shas),
    firstPusher: yield* api.firstPusher(),
    made,
    main: yield* mainTip,
    refused,
    tip,
  };
});

/** One push event reported twice: its liveness and its `Pushed` event happen once. */
const replaying = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const opened = yield* opening(api);
  const claimed = yield* claiming(api, opened.opened.landed);
  const before = yield* eventTags(api);

  const again = yield* api.recordPush({
    after: claimed.wide,
    before: Option.some(opened.opened.landed),
    eventId: "push-wide",
    pusher: bob,
    ref: "refs/heads/main",
    repo: forkOf("parse-iso", bob),
  });

  return {
    again,
    events: [before, yield* eventTags(api)],
    first: claimed.wideRefusals,
  };
});

/** An ask bob claimed, opened again by alice with the same files. */
const reopening = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const { opened } = yield* opening(api);

  yield* api.claim(bob, parseIso);

  const before = yield* eventTags(api);
  const again = yield* openRed(api, "parse-iso");

  return {
    again,
    events: [before, yield* eventTags(api)],
    listed: yield* api.listAsks(anyone),
    main: yield* mainTip,
    opened,
  };
});

/** dave decides for `packages/format/**` only. */
const narrowDecider: WorldScenario = {
  policy: {
    ...scenario.policy,
    deciders: [
      ...scenario.policy.deciders,
      {
        handles: Array.make(dave.handle),
        paths: Glob.make("packages/format/**"),
      },
    ],
  },
};

/** dave opens an ask in the format package, and one in the parser. */
const decidingNarrowly = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);

  const outside = yield* Effect.result(openRed(api, "parse-iso", dave));
  const inside = yield* Effect.result(openRed(api, "format-date", dave));

  return {
    inside: Result.map(inside, ({ ask }) => [ask.id, ask.askedBy]),
    outside,
  };
});

describe("opening an ask", () => {
  it.effect(
    "again, once it is claimed, answers with the ask as it stands and lands nothing",
    () =>
      Effect.map(
        reopening.pipe(Effect.provide(worldOf(scenario, "memory"))),
        ({ again, events, listed, main, opened }) => {
          expect(again).toStrictEqual({
            ask: { ...opened.ask, state: "claimed" },
            landed: opened.landed,
          });
          expect(main).toBe(opened.landed);
          expect(events[1]).toStrictEqual(events[0]);
          expect(listed.asks.map(({ claimed }) => claimed)).toStrictEqual([
            true,
          ]);
        }
      )
  );

  it.effect("is for a decider whose paths hold the ask's territory", () =>
    Effect.map(
      decidingNarrowly.pipe(Effect.provide(worldOf(narrowDecider, "memory"))),
      ({ inside, outside }) => {
        expect(outside).toStrictEqual(Result.fail(new NotDecider({})));
        expect(inside).toStrictEqual(
          Result.succeed([AskId.make("format-date"), dave.handle])
        );
      }
    )
  );
});

describe("the project's outbox", () => {
  it.effect(
    "keeps a fork and a projection that failed, and the next alarm runs them again",
    () =>
      Effect.map(
        settling.pipe(
          Effect.provide(worldOf(scenario, "memory", { failOnce: true }))
        ),
        ({ after, before }) => {
          expect(before).toStrictEqual({
            alarm: Option.some(DateTime.add(noon, { seconds: 1 })),
            fork: false,
            outbox: ["MakeFork", "Projected"],
          });
          expect(after).toStrictEqual({
            fork: true,
            outbox: [],
            projected: ["Claimed", "AskOpened"],
          });
        }
      )
  );

  it.effect("acts on one push event once, however often it is reported", () =>
    Effect.map(
      replaying.pipe(Effect.provide(worldOf(scenario, "memory"))),
      ({ again, events, first }) => {
        expect(again).toStrictEqual(first);
        expect(events[1]).toStrictEqual(events[0]);
      }
    )
  );
});

describe("projects", () => {
  it.effect("are made once each, found by name, and kept apart", () =>
    Effect.map(
      routing.pipe(
        Effect.provide(
          ProjectsMemory.pipe(Layer.provideMerge(worldOf(scenario, "memory")))
        )
      ),
      (seen) => {
        expect(seen.again).toStrictEqual(new ProjectExists({ project }));
        expect(seen.unknown).toStrictEqual(
          new UnknownProject({ project: ProjectName.make("burrow") })
        );
        expect(seen.initializedAgain).toStrictEqual(
          new ProjectExists({ project })
        );
        expect(seen.otherInitialized).toStrictEqual(
          Exit.succeed({
            project: ProjectName.make("burrow"),
            remote: remoteOf("burrow"),
          })
        );
      }
    )
  );

  it.effect(
    "adopt an imported repo's tip as their first landing, awaiting no first push, and refuse a repo they can't read",
    () =>
      Effect.map(
        importing.pipe(Effect.provide(worldOf(scenario, "memory"))),
        (seen) => {
          expect(seen.made).toStrictEqual({
            landed: seen.tip,
            project,
            remote: remoteOf(project),
          });
          expect([seen.main, seen.evaluated, seen.firstPusher]).toStrictEqual([
            seen.tip,
            [seen.tip],
            Option.none(),
          ]);
          expect(seen.refused).toStrictEqual(
            new ImportFailed({ reason: "no repo at memory://none.git" })
          );
        }
      )
  );
});
