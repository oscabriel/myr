import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { ObjectId } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob, CheckLane, CheckRun } from "@repo/checks/check-runner";
import { measure } from "@repo/checks/kinds/ratchet";
import { authorLine, parseTrailers } from "@repo/git/trailers";
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, Glob, SymbolName } from "@repo/protocol/domain/common";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { Territory } from "@repo/protocol/domain/territory";
import {
  AskId,
  Handle,
  KindName,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  AskBlocked,
  NotRedFirst,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import {
  EvaluationFacts,
  RulesEvaluator,
  sdkVersion,
} from "@repo/rules/rules-evaluator";
import { RulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { sixChildren, withAsk, withVouches } from "@repo/testkit/scenarios";
import {
  Array,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Struct,
} from "effect";

import { AnswerRuns } from "../src/answer-runs.ts";
import type { AnswerQueue, AnswerRun } from "../src/answer-runs.ts";
import { drive } from "../src/answer-runs/steps.ts";
import { Lander } from "../src/lander.ts";
import { LandingCommand } from "../src/landing.ts";
import type { Change } from "../src/landing.ts";
import {
  callersIn,
  childId,
  deleteChildId,
  familyClosed,
  remainingBlockers,
  splitFamily,
} from "../src/migrate.ts";
import type { MigrateFamily, CallerCount } from "../src/migrate.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { FinishersFromChecks, projectService } from "../src/project.ts";
import { Pusher, worldOf } from "./world.ts";

const symbol = "legacyFetch";

const countOf = (name: string) =>
  Command.make(`node scripts/count-callers.mjs ${name} --json`);

const packages = ["p1", "p2", "p3", "p4", "p5", "p6"] as const;

type Package = (typeof packages)[number];

const callers = { p1: 5, p2: 7, p3: 6, p4: 8, p5: 4, p6: 7 } as const;

const total = 37;

const answerers = ["bob", "carol", "dave", "eve", "frank", "grace"] as const;

const others = ["heidi", "ivan"] as const;

const family = sixChildren({ symbol, to: "http.get" });

const scenario = family.pipe(
  withVouches([...answerers, ...others]),
  withAsk({ id: "tidy-p6", territory: "packages/p6" }),
  withAsk({
    check: CheckSpec.cases.Migrate.make({
      count: countOf(symbol),
      from: SymbolName.make(symbol),
      to: SymbolName.make("http.get"),
    }),
    id: "move-p2-fetch",
    kind: "migrate",
    territory: "packages/p2",
  }),
  withAsk({
    check: CheckSpec.cases.Migrate.make({
      count: countOf("oldThing"),
      from: SymbolName.make("oldThing"),
    }),
    id: "drop-old-thing",
    kind: "migrate",
    territory: ".",
  })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const mainRef = RefName.make("refs/heads/main");

const parentId = AskId.make("drop-legacy-fetch");

const childIdOf = (name: Package) => AskId.make(`${parentId}-${name}`);

const childIds = Array.map(packages, childIdOf);

const deleteId = AskId.make(`${parentId}-delete`);

const tidyId = AskId.make("tidy-p6");

const ratchetName = "callers-legacyfetch";

const person = (handle: string) => Person.make({ handle: Handle.make(handle) });

const alice = person("alice");

const anyone = Anonymous.make({});

const askOf = (id: string) =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const calls = (name: string, count: number) =>
  Array.makeBy(count, (n) => `  ${name}("/item/${n}");\n`).join("");

const indexOf = (name: string) => `packages/${name}/src/index.ts`;

const extraOf = (name: string) => `packages/${name}/src/extra.ts`;

const legacyFile = "packages/p1/src/legacy.ts";

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/burrow", "workspaces": ["packages/*"] }\n',
  ],
  ["scripts/count-callers.mjs", "// prints {total, byModule} for a name\n"],
  [legacyFile, "export const legacyFetch = (url) => fetch(url);\n"],
  ...packages.map((name): readonly [string, string] => [
    indexOf(name),
    `export const run = () => {\n${calls(symbol, callers[name])}};\n`,
  ]),
];

const changed = (files: Files, path: string, content?: string): Files => [
  ...files.filter(([each]) => each !== path),
  ...(content === undefined ? [] : [[path, content] as const]),
];

const askFile = (id: string) => {
  const { file } = askOf(id);

  return { content: `export default "${id}";\n`, path: file };
};

const plainFiles = (id: string) => {
  const { check } = askOf(id);

  return Array.make(askFile(id), {
    content: [
      `import { expect, it } from "vitest";`,
      `import { run } from "../src/index.ts";`,
      ``,
      `it("${id}", () => {`,
      `  expect(run()).toStrictEqual(undefined);`,
      `});`,
      ``,
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(check)
      ? check.path
      : RepoPath.make(`test/${id}.test.ts`),
  });
};

interface Merged {
  readonly changes: readonly Change[];
  readonly fork: RepoName;
  readonly head: CommitSha;
  readonly main: LandedSha;
}

const countedName = (command: string) => command.split(" ")[2] ?? "";

const occurrences = (text: string, name: string) =>
  text.split(`${name}(`).length - 1;

interface CheckerOptions {
  readonly drifting?: boolean;
}

const ratchetsOn = (run: AnswerRun, tree: CheckAt) =>
  Effect.gen(function* () {
    const runner = yield* CheckRunner;
    const specs = run.counts?.ratchets ?? [];
    const block = Option.fromUndefinedOr(run.run);

    if (specs.length === 0 || Option.isNone(block)) {
      return [];
    }

    const lanes = specs.map(({ measure: { command }, name }): CheckLane => ({
      command,
      lane: LaneName.make(name),
      output: "stdout",
    }));

    const ran = yield* runner
      .run({
        at: tree,
        lanes,
        placeholders: [],
        project,
        proxies: [],
        repo,
        run: block.value,
      })
      .pipe(Effect.orDie);

    const printed = (command: string) =>
      ran.outputs?.find(
        ({ lane }) =>
          lanes.find((each) => each.lane === lane)?.command === command
      )?.stdout ?? "";

    const counts = yield* Effect.forEach(specs, (spec) =>
      measure(
        spec,
        (command) => Effect.succeed({ code: 0, stdout: printed(command) }),
        run.counts?.modules ?? []
      )
    ).pipe(Effect.orDie);

    return counts.flat();
  });

const standIns = (options: CheckerOptions) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const inner = yield* Lander;
      const merges = new Map<string, Merged>();
      const counted = yield* Ref.make(0);
      const running = yield* Ref.make<ReadonlySet<RequestId>>(new Set());

      const lander = Lander.of({
        ...inner,
        merge: (job) =>
          Effect.tap(inner.merge(job), ({ changes, tree }) =>
            Effect.sync(() =>
              merges.set(tree, {
                changes,
                fork: job.fork,
                head: job.head,
                main: job.main,
              })
            )
          ),
      });

      const read = (from: RepoName, sha: CommitSha, path: string) =>
        host.readFile(from, Revision.Commit({ sha }), RepoPath.make(path)).pipe(
          Effect.orDie,
          Effect.map((bytes) =>
            Option.match(bytes, {
              onNone: () => "",
              onSome: (found) => new TextDecoder().decode(found),
            })
          )
        );

      const textAt = (at: CheckAt, path: string) =>
        CheckAt.match(at, {
          Commit: ({ commit }) => read(repo, commit, path),
          Tree: ({ tree }) => {
            const merged = merges.get(tree);

            if (merged === undefined) {
              return Effect.die(`no merge made the tree ${tree}`);
            }

            const change = merged.changes.find((each) => each.path === path);

            if (change === undefined) {
              return read(repo, merged.main, path);
            }

            return change.status === "deleted"
              ? Effect.succeed("")
              : read(merged.fork, merged.head, path);
          },
        });

      const countAt = (at: CheckAt, name: string) =>
        Effect.gen(function* () {
          const found = yield* Effect.forEach(packages, (each) =>
            Effect.gen(function* () {
              const index = yield* textAt(at, indexOf(each));
              const extra = yield* textAt(at, extraOf(each));

              return [
                each,
                occurrences(index, name) + occurrences(extra, name),
              ] as const;
            })
          );

          const skew =
            options.drifting === true
              ? yield* Ref.getAndUpdate(counted, (n) => n + 1)
              : 0;

          const byModule = Object.fromEntries(
            found.map(([each, count]) => [
              each,
              each === "p1" ? count + skew : count,
            ])
          );

          return JSON.stringify({
            byModule,
            total: Object.values(byModule).reduce((sum, n) => sum + n, 0),
          });
        });

      const laneRun = (job: CheckJob, lane: CheckLane) =>
        Effect.gen(function* () {
          const fails =
            CheckAt.guards.Commit(job.at) && lane.lane === "redThenGreen";

          const result: LaneResult = {
            command: lane.command,
            durationMs: 1,
            lane: lane.lane,
            result: fails ? "failed" : "passed",
          };

          const output =
            lane.output === "stdout"
              ? Option.some({
                  lane: lane.lane,
                  stdout: yield* countAt(job.at, countedName(lane.command)),
                })
              : Option.none();

          return { output, result };
        });

      const runner = CheckRunner.of({
        run: (job) =>
          Effect.gen(function* () {
            const lanes = yield* Effect.forEach(job.lanes, (lane) =>
              laneRun(job, lane)
            );

            const outputs = Array.getSomes(lanes.map(({ output }) => output));

            const ran: CheckRun = {
              durationMs: lanes.length,
              evidence: lanes
                .filter(({ result }) => result.result === "failed")
                .map(({ result }) => ({
                  lane: result.lane,
                  signature: `${result.lane}: expected undefined`,
                })),
              heldBack: [],
              lanes: lanes.map(({ result }) => result),
            };

            return Array.isReadonlyArrayEmpty(outputs)
              ? ran
              : { ...ran, outputs };
          }),
      });

      const ports = Context.make(CheckRunner, runner).pipe(
        Context.add(Lander, lander),
        Context.add(RepoHost, host)
      );

      const counting = (queue: AnswerQueue): AnswerQueue => ({
        advanceAnswer: (requestId, command, report) =>
          LandingCommand.$is("Checked")(command)
            ? Effect.gen(function* () {
                const run = yield* queue.answer(requestId);

                const ratchets = yield* Option.match(run, {
                  onNone: () => Effect.succeed([]),
                  onSome: (found) =>
                    ratchetsOn(
                      found,
                      CheckAt.cases.Tree.make({ tree: command.tree })
                    ).pipe(Effect.provideContext(ports)),
                });

                return yield* queue.advanceAnswer(requestId, command, {
                  ...report,
                  ratchets,
                });
              })
            : queue.advanceAnswer(requestId, command, report),
        answer: queue.answer,
        landings: queue.landings,
      });

      const leave = (requestId: RequestId) =>
        Ref.update(
          running,
          (under) => new Set([...under].filter((each) => each !== requestId))
        );

      const runs = AnswerRuns.of({
        start: (requestId, queue) =>
          Effect.gen(function* () {
            const free = yield* Ref.modify(running, (under) =>
              under.has(requestId)
                ? [false, under]
                : [true, new Set(under).add(requestId)]
            );

            if (free) {
              yield* drive(counting(queue), requestId).pipe(
                Effect.provideContext(ports),
                Effect.ensuring(leave(requestId))
              );
            }
          }),
      });

      return ports.pipe(Context.add(AnswerRuns, runs));
    })
  );

const worldWith = (options: CheckerOptions = {}) =>
  standIns(options).pipe(Layer.provideMerge(worldOf(scenario, "memory")));

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
    const { author, message, parents } = Option.getOrThrow(read);

    return { author, parents, trailers: parseTrailers(message) };
  });

const holds = (sha: CommitSha, path: string) =>
  RepoHost.use((host) =>
    host.readFile(repo, Revision.Commit({ sha }), RepoPath.make(path))
  ).pipe(Effect.orDie, Effect.map(Option.isSome));

const filesAt = (sha: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;

    const under = (tree: ObjectId, prefix: string): Effect.Effect<Files> =>
      Effect.gen(function* () {
        const entries = yield* host.readTree(repo, tree).pipe(Effect.orDie);

        const nested = yield* Effect.forEach(
          Option.getOrElse(entries, () => []),
          ({ name, sha: id, type }) =>
            type === "tree"
              ? under(id, `${prefix}${name}/`)
              : Effect.map(
                  host.readBlob(repo, id).pipe(Effect.orDie),
                  (bytes): Files => [
                    [
                      `${prefix}${name}`,
                      new TextDecoder().decode(
                        Option.getOrElse(bytes, () => new Uint8Array())
                      ),
                    ],
                  ]
                )
        );

        return nested.flat();
      });

    const commit = yield* host.readCommit(repo, sha).pipe(Effect.orDie);

    return yield* under(Option.getOrThrow(commit).tree, "");
  });

const ratchetRows = ProjectStore.use((store) => store.load()).pipe(
  Effect.map(({ ratchets }) =>
    ratchets.map(({ count, ratchet, territory }) => ({
      count,
      ratchet,
      territory,
    }))
  )
);

const landingCount = ProjectStore.use((store) => store.load()).pipe(
  Effect.map(({ landings }) => landings.length)
);

const listed = (api: ProjectApi) =>
  Effect.map(api.listAsks(anyone), ({ asks }) =>
    asks.map(({ ask }) => ask).toSorted()
  );

const shown = (api: ProjectApi, id: AskId) =>
  Effect.map(api.showAsk(anyone, id), ({ ask }) => ask);

const fromFirstPush = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(alice, first);
  });

const answer = (
  api: ProjectApi,
  input: {
    readonly ask: AskId;
    readonly base: LandedSha;
    readonly change: (files: Files) => Files;
    readonly who: Person;
  }
) =>
  Effect.gen(function* () {
    const fork = RepoName.make(
      `${keyOf(project)}--${input.ask}--${input.who.handle}`
    );

    const files = yield* filesAt(input.base);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(fork, Option.some(input.base), input.change(files))
    );

    return yield* api.submitAnswer(input.who, {
      ask: input.ask,
      base: input.base,
      head,
      requestId: RequestId.make(`req-${input.ask}`),
    });
  });

const migrated = (name: Package) => (files: Files) =>
  changed(
    files,
    indexOf(name),
    `export const run = () => {\n${calls("http.get", callers[name])}};\n`
  );

const outcomesOf = (api: ProjectApi, who: string) =>
  Effect.map(api.status(person(who)), ({ answers }) =>
    answers.map(({ outcome }) => outcome)
  );

const story = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const host = yield* RepoHost;

  yield* fromFirstPush(api);

  yield* api.openAsk(alice, { ask: tidyId, files: plainFiles(tidyId) });

  const parentFiles = Array.make(askFile(parentId));
  const beforeFamily = yield* mainTip;

  const opened = yield* api.openAsk(alice, {
    ask: parentId,
    files: parentFiles,
  });

  const atOpen = {
    children: yield* Effect.forEach(childIds, (id) => shown(api, id)),
    commit: yield* commitOf(opened.landed),
    deleteChild: yield* shown(api, deleteId),
    files: yield* Effect.forEach([parentId, ...childIds, deleteId], (id) =>
      holds(opened.landed, `${Brand.configDir}/asks/${id}.ask.ts`)
    ),
    listed: yield* listed(api),
    ratchets: yield* ratchetRows,
  };

  const landingsBefore = yield* landingCount;

  const replay = yield* api.openAsk(alice, {
    ask: parentId,
    files: parentFiles,
  });

  const afterReplay = {
    landings: (yield* landingCount) - landingsBefore,
    listed: yield* listed(api),
    main: yield* mainTip,
    ratchets: yield* ratchetRows,
  };

  const refusedEarly = {
    deleteChild: yield* api.claim(person("heidi"), deleteId).pipe(Effect.flip),
    parent: yield* api.claim(person("heidi"), parentId).pipe(Effect.flip),
  };

  const claims = yield* Effect.forEach(
    Array.zip(answerers, childIds),
    ([who, id]) => api.claim(person(who), id),
    { concurrency: "unbounded" }
  );

  const forks = yield* Effect.forEach(claims, ({ claim }) =>
    Effect.map(Effect.exit(host.refs(claim.fork)), Exit.isSuccess)
  );

  const tidyClaim = yield* api.claim(person("ivan"), tidyId);

  const landChild = (n: number) =>
    Effect.gen(function* () {
      const name = packages[n] ?? "p1";

      yield* answer(api, {
        ask: childIdOf(name),
        base: opened.landed,
        change: migrated(name),
        who: person(answerers[n] ?? "bob"),
      });

      return yield* mainTip;
    });

  const firstThree = yield* Effect.forEach([0, 1, 2], landChild);

  const midFamily = {
    deleteClaim: yield* api.claim(person("heidi"), deleteId).pipe(Effect.flip),
    main: yield* mainTip,
    ratchets: yield* ratchetRows,
  };

  yield* answer(api, {
    ask: tidyId,
    base: LandedSha.make(tidyClaim.claim.base),
    change: (files) =>
      changed(
        files,
        extraOf("p6"),
        `export const extra = () => {\n${calls(symbol, 1)}};\n`
      ),
    who: person("ivan"),
  });

  const tidyAfter = {
    main: yield* mainTip,
    outcomes: yield* outcomesOf(api, "ivan"),
  };

  const lastThree = yield* Effect.forEach([3, 4, 5], landChild);

  const afterSix = {
    deleteChild: yield* shown(api, deleteId),
    parent: yield* shown(api, parentId),
  };

  const deleteClaim = yield* api.claim(person("heidi"), deleteId);

  yield* answer(api, {
    ask: deleteId,
    base: LandedSha.make(deleteClaim.claim.base),
    change: (files) => changed(files, legacyFile),
    who: person("heidi"),
  });

  const deleteLanded = yield* mainTip;
  const childrenLanded = [...firstThree, ...lastThree];

  return {
    afterReplay,
    afterSix,
    atOpen,
    beforeFamily,
    childrenLanded,
    claims,
    deleteLanded,
    events: (yield* api.events(0, 1000)).map(({ event }) => event),
    forks,
    landings: yield* Effect.forEach(
      [...childrenLanded, deleteLanded],
      commitOf
    ),
    listedAtEnd: yield* listed(api),
    midFamily,
    opened,
    outcomes: yield* Effect.forEach([...answerers, "heidi"], (who) =>
      outcomesOf(api, who)
    ),
    parentAtEnd: yield* shown(api, parentId),
    ratchetsAtEnd: yield* ratchetRows,
    refusedEarly,
    replay,
    tidyAfter,
  };
});

class Seen extends Context.Service<Seen, Effect.Success<typeof story>>()(
  "test/Seen"
) {}

// About three seconds alone, more under turbo: the limit catches a hang, not a busy machine.
const wholeStory = { timeout: 60_000 };

const seen = Seen.useSync((told) => told);

const eventsOf = <T extends ProjectEvent["_tag"]>(
  events: readonly ProjectEvent[],
  tag: T
) =>
  events.filter(
    (event): event is Extract<ProjectEvent, { readonly _tag: T }> =>
      event._tag === tag
  );

const askedByAlice = {
  key: "Asked-by",
  value: `alice <alice@users.${Brand.domain}>`,
};

layer(Layer.effect(Seen, story).pipe(Layer.provide(worldWith())), wholeStory)(
  "a migrate ask over six packages",
  (cases) => {
    cases.effect(
      "1. opens as one platform commit adding the parent, the six children and the delete child",
      () =>
        Effect.map(seen, ({ atOpen, beforeFamily, opened }) => {
          expect({
            asked: atOpen.commit.trailers.filter(
              ({ key }) => key === "Asked-by"
            ),
            author: atOpen.commit.author,
            files: atOpen.files,
            opened: opened.ask.id,
            parents: atOpen.commit.parents,
          }).toStrictEqual({
            asked: [askedByAlice],
            author: authorLine(alice.handle),
            files: Array.makeBy(8, () => true),
            opened: parentId,
            parents: [beforeFamily],
          });
          expect(atOpen.listed).toStrictEqual(
            [tidyId, parentId, ...childIds, deleteId].toSorted()
          );
        })
    );

    cases.effect("1. gives each child its own package as its territory", () =>
      Effect.map(seen, ({ atOpen }) => {
        expect(
          atOpen.children.map(({ brief, check, parent, territory }) => ({
            check: check._tag,
            parent,
            territory: territory.paths,
            want: brief.want,
          }))
        ).toStrictEqual(
          packages.map((name) => ({
            check: "Migrate",
            parent: parentId,
            territory: [Glob.make(`packages/${name}/**`)],
            want: `${name}: ${callers[name]} callers of legacyFetch → http.get`,
          }))
        );
      })
    );

    cases.effect(
      "1. blocks the delete child on the six, and the parent on all seven",
      () =>
        Effect.map(seen, ({ atOpen, opened }) => {
          expect({
            blockedBy: atOpen.deleteChild.blockedBy,
            check: atOpen.deleteChild.check,
            parent: atOpen.deleteChild.parent,
            state: atOpen.deleteChild.state,
          }).toStrictEqual({
            blockedBy: childIds,
            check: CheckSpec.cases.SymbolAbsent.make({
              count: countOf(symbol),
              symbol: SymbolName.make(symbol),
            }),
            parent: parentId,
            state: "waitingOnParent",
          });
          expect(opened.ask.blockedBy).toStrictEqual([...childIds, deleteId]);
        })
    );

    cases.effect("1. records the callers ratchet at the counted total", () =>
      Effect.map(seen, ({ atOpen }) => {
        expect(atOpen.ratchets).toStrictEqual([
          { count: total, ratchet: ratchetName, territory: "." },
        ]);
      })
    );

    cases.effect("opening it again converges on the same family", () =>
      Effect.map(seen, ({ afterReplay, atOpen, opened, replay }) => {
        expect(replay).toStrictEqual(opened);
        expect(afterReplay).toStrictEqual({
          landings: 0,
          listed: atOpen.listed,
          main: opened.landed,
          ratchets: atOpen.ratchets,
        });
      })
    );

    cases.effect(
      "2. refuses a claim on the delete child, or on the parent, as blocked",
      () =>
        Effect.map(seen, ({ refusedEarly }) => {
          expect(refusedEarly).toStrictEqual({
            deleteChild: AskBlocked.of(deleteId, childIds),
            parent: AskBlocked.of(parentId, Array.append(childIds, deleteId)),
          });
        })
    );

    cases.effect(
      "3. lets six people claim the six children at once, each in a fork",
      () =>
        Effect.map(seen, ({ claims, forks }) => {
          expect(
            claims.map(({ claim }) => [claim.ask, claim.claimant])
          ).toStrictEqual(Array.zip(childIds, answerers));
          expect(forks).toStrictEqual(Array.makeBy(6, () => true));
        })
    );

    cases.effect(
      "4. lands the six answers in turn, none stale, each authored by its claimant and asked by alice",
      () =>
        Effect.map(seen, ({ landings, outcomes, childrenLanded }) => {
          expect(outcomes.slice(0, 6)).toStrictEqual(
            childrenLanded.map((sha) => [Outcome.cases.Landed.make({ sha })])
          );
          expect(
            landings.slice(0, 6).map(({ author, trailers }) => ({
              asked: trailers.filter(({ key }) => key === "Asked-by"),
              author,
            }))
          ).toStrictEqual(
            answerers.map((who) => ({
              asked: [askedByAlice],
              author: authorLine(Handle.make(who)),
            }))
          );
        })
    );

    cases.effect(
      "5. still refuses the delete child after three land, naming the three still open",
      () =>
        Effect.map(seen, ({ midFamily }) => {
          expect(midFamily.deleteClaim).toStrictEqual(
            AskBlocked.of(
              deleteId,
              Array.map(["p4", "p5", "p6"] as const, childIdOf)
            )
          );
        })
    );

    cases.effect("lowers the callers ratchet as each child lands", () =>
      Effect.map(seen, ({ midFamily, ratchetsAtEnd }) => {
        expect([midFamily.ratchets, ratchetsAtEnd]).toStrictEqual([
          [
            {
              count: total - callers.p1 - callers.p2 - callers.p3,
              ratchet: ratchetName,
              territory: ".",
            },
          ],
          [{ count: 0, ratchet: ratchetName, territory: "." }],
        ]);
      })
    );

    cases.effect(
      "7. refuses a plain answer that adds a caller mid-family as a weakened ratchet, and lands nothing",
      () =>
        Effect.map(seen, ({ midFamily, tidyAfter }) => {
          const before = total - callers.p1 - callers.p2 - callers.p3;

          expect(tidyAfter).toStrictEqual({
            main: midFamily.main,
            outcomes: [
              Outcome.cases.Refused.make({
                refusals: [
                  new Weakened({
                    weakening: {
                      after: before + 1,
                      before,
                      ratchet: ratchetName,
                      territory: ".",
                    },
                  }),
                ],
              }),
            ],
          });
        })
    );

    cases.effect(
      "6. opens the delete child once the six land, while the parent waits on it",
      () =>
        Effect.map(seen, ({ afterSix, events }) => {
          expect([
            afterSix.deleteChild.state,
            afterSix.parent.state,
          ]).toStrictEqual(["open", "open"]);
          expect(
            eventsOf(events, "AskOpened")
              .map(({ ask }) => ask.ask)
              .filter((id) => id === deleteId)
          ).toStrictEqual([deleteId]);
        })
    );

    cases.effect(
      "6. lands the delete child by heidi, and closes the parent on that landing",
      () =>
        Effect.map(
          seen,
          ({
            deleteLanded,
            events,
            landings,
            listedAtEnd,
            outcomes,
            parentAtEnd,
          }) => {
            expect({
              author: landings[6]?.author,
              outcome: outcomes[6],
              parent: parentAtEnd.state,
            }).toStrictEqual({
              author: authorLine(Handle.make("heidi")),
              outcome: [Outcome.cases.Landed.make({ sha: deleteLanded })],
              parent: "closed",
            });
            expect(listedAtEnd).toStrictEqual([tidyId]);
            expect(
              eventsOf(events, "AskClosed").filter(
                ({ ask }) => ask === parentId
              )
            ).toStrictEqual([
              expect.objectContaining({ ask: parentId, landing: deleteLanded }),
            ]);
          }
        )
    );
  }
);

const allAtOnce = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* fromFirstPush(api);

  const opened = yield* api.openAsk(alice, {
    ask: parentId,
    files: Array.make(askFile(parentId)),
  });

  const children = Array.zip(packages, answerers);

  yield* Effect.forEach(
    children,
    ([name, who]) => api.claim(person(who), childIdOf(name)),
    { concurrency: "unbounded" }
  );

  yield* Effect.forEach(
    children,
    ([name, who]) =>
      answer(api, {
        ask: childIdOf(name),
        base: opened.landed,
        change: migrated(name),
        who: person(who),
      }),
    { concurrency: "unbounded" }
  );

  // Whatever waits on a retry runs at the project's next alarms.
  yield* api.onAlarm();
  yield* advanceTo("2026-10-07T12:10:00Z");
  yield* api.onAlarm();

  return {
    deleteChild: (yield* shown(api, deleteId)).state,
    outcomes: yield* Effect.forEach(answerers, (who) =>
      Effect.map(outcomesOf(api, who), (all) => all.map(({ _tag }) => _tag))
    ),
    ratchets: yield* ratchetRows,
  };
}).pipe(Effect.provide(worldWith()));

describe("six answers to the six children at once", () => {
  it.effect(
    "all land, none stale and none refused by the callers ratchet",
    () =>
      Effect.map(allAtOnce, (seenThen) => {
        expect(seenThen).toStrictEqual({
          deleteChild: "open",
          outcomes: Array.makeBy(6, () => ["Landed"]),
          ratchets: [{ count: 0, ratchet: ratchetName, territory: "." }],
        });
      }),
    wholeStory
  );
});

const openingOf = (id: string, options: CheckerOptions = {}) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* projectService(project);

    yield* fromFirstPush(api);

    const opened = yield* Effect.result(
      api.openAsk(alice, {
        ask: AskId.make(id),
        files: Array.make(askFile(id)),
      })
    );

    return {
      landings: yield* landingCount,
      listed: yield* listed(api),
      opened,
      ratchets: yield* ratchetRows,
    };
  }).pipe(Effect.provide(worldWith(options)));

const reopening = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const onePackage = AskId.make("move-p2-fetch");

  yield* fromFirstPush(api);
  yield* api.openAsk(alice, {
    ask: onePackage,
    files: Array.make(askFile(onePackage)),
  });

  const moving = yield* api.claim(person("bob"), onePackage);

  yield* answer(api, {
    ask: onePackage,
    base: LandedSha.make(moving.claim.base),
    change: migrated("p2"),
    who: person("bob"),
  });

  yield* api.openAsk(alice, { ask: tidyId, files: plainFiles(tidyId) });

  const tidying = yield* api.claim(person("ivan"), tidyId);

  yield* answer(api, {
    ask: tidyId,
    base: LandedSha.make(tidying.claim.base),
    change: (files) =>
      changed(
        files,
        extraOf("p6"),
        `export const extra = () => {\n${calls(symbol, 1)}};\n`
      ),
    who: person("ivan"),
  });

  const left = yield* ratchetRows;

  yield* api.openAsk(alice, {
    ask: parentId,
    files: Array.make(askFile(parentId)),
  });

  return { left, opened: yield* ratchetRows };
}).pipe(Effect.provide(worldWith()));

const overwriting = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);
  const p1 = childIdOf("p1");

  yield* fromFirstPush(api);
  yield* api.openAsk(alice, { ask: p1, files: Array.make(askFile(p1)) });

  const main = yield* mainTip;

  const opened = yield* Effect.result(
    api.openAsk(alice, {
      ask: parentId,
      files: Array.make(askFile(parentId)),
    })
  );

  return {
    listed: yield* listed(api),
    main,
    mainAfter: yield* mainTip,
    opened,
  };
}).pipe(Effect.provide(worldWith()));

describe("opening a migrate ask", () => {
  it.effect(
    "is refused TouchedJudge when a child's file would replace an ask the project holds",
    () =>
      Effect.map(overwriting, ({ listed: open, main, mainAfter, opened }) => {
        expect({ listed: open, mainAfter, opened }).toStrictEqual({
          listed: [childIdOf("p1")],
          mainAfter: main,
          opened: Result.fail(
            new TouchedJudge({
              paths: [
                RepoPath.make(
                  `${Brand.configDir}/asks/${childIdOf("p1")}.ask.ts`
                ),
              ],
            })
          ),
        });
      }),
    wholeStory
  );

  it.effect(
    "is refused NotRedFirst when the two counts on main differ",
    () =>
      Effect.map(openingOf(parentId, { drifting: true }), (seenThen) => {
        expect(seenThen).toStrictEqual({
          landings: 1,
          listed: [],
          opened: Result.fail(new NotRedFirst({})),
          ratchets: [],
        });
      }),
    wholeStory
  );

  it.effect(
    "is refused NotRedFirst when nothing calls the name: nothing to migrate",
    () =>
      Effect.map(openingOf("drop-old-thing"), ({ listed: open, opened }) => {
        expect([open, opened]).toStrictEqual([
          [],
          Result.fail(new NotRedFirst({})),
        ]);
      }),
    wholeStory
  );

  it.effect(
    "records the callers ratchet at the counted total, over a lower one a closed migrate ask left",
    () =>
      Effect.map(reopening, (seenThen) => {
        expect(seenThen).toStrictEqual({
          left: [
            { count: total - callers.p2, ratchet: ratchetName, territory: "." },
          ],
          opened: [
            {
              count: total - callers.p2 + 1,
              ratchet: ratchetName,
              territory: ".",
            },
          ],
        });
      }),
    wholeStory
  );

  it.effect(
    "opens as one plain ask, with no family, when its territory is one package",
    () =>
      Effect.map(
        openingOf("move-p2-fetch"),
        ({ listed: open, opened, ratchets }) => {
          expect({
            blockedBy: Result.map(opened, ({ ask }) => ask.blockedBy),
            listed: open,
            ratchets,
          }).toStrictEqual({
            blockedBy: Result.succeed([]),
            listed: [AskId.make("move-p2-fetch")],
            ratchets: [{ count: total, ratchet: ratchetName, territory: "." }],
          });
        }
      ),
    wholeStory
  );
});

const parent: Ask = askOf(parentId);

const { modules } = scenario.policy;

const counted = (byModule: Readonly<Record<string, number>>): CallerCount => ({
  byModule,
  total: Object.values(byModule).reduce((sum, n) => sum + n, 0),
});

const split = (
  byModule: Readonly<Record<string, number>>,
  of: Ask = parent
): Option.Option<MigrateFamily> =>
  splitFamily({
    configDir: Brand.configDir,
    counts: counted(byModule),
    modules,
    parent: of,
  });

const comparable = (ask: Ask) =>
  Struct.pick(ask, [
    "blockedBy",
    "check",
    "file",
    "id",
    "kind",
    "parent",
    "state",
    "territory",
  ]);

describe(splitFamily, () => {
  it("splits as testkit's sixChildren() is written by hand: six children and a delete child", () => {
    const made = Option.getOrThrow(split(callers));
    const byHand = new Map(family.policy.asks.map((ask) => [ask.id, ask]));

    const expected = (id: AskId, state: Ask["state"]) => {
      const {
        blockedBy,
        check,
        file,
        kind,
        parent: of,
        territory,
      } = byHand.get(id) ?? parent;

      return { blockedBy, check, file, id, kind, parent: of, state, territory };
    };

    expect([...made.children, made.deleteChild].map(comparable)).toStrictEqual([
      ...childIds.map((id) => expected(id, "open")),
      expected(deleteId, "waitingOnParent"),
    ]);
    expect({
      blockedBy: made.parent.blockedBy,
      files: made.files.map(({ path }) => path),
      ratchet: made.ratchet,
    }).toStrictEqual({
      blockedBy: [...childIds, deleteId],
      files: [...childIds, deleteId].map((id) =>
        RepoPath.make(`${Brand.configDir}/asks/${id}.ask.ts`)
      ),
      ratchet: { baseline: total, name: ratchetName },
    });
  });

  it("gives no child to a module with no callers", () => {
    expect(
      Option.map(split({ ...callers, p3: 0 }), ({ children }) =>
        children.map(({ id }) => id)
      )
    ).toStrictEqual(
      Option.some(Array.map(["p1", "p2", "p4", "p5", "p6"] as const, childIdOf))
    );
  });

  it("gives no child to a module outside the parent's territory", () => {
    const narrower: Ask = {
      ...parent,
      territory: {
        module: ".",
        paths: [Glob.make("packages/p1/**"), Glob.make("packages/p2/**")],
      },
    };

    expect(
      Option.map(split(callers, narrower), ({ children }) =>
        children.map(({ id }) => id)
      )
    ).toStrictEqual(Option.some(Array.map(["p1", "p2"] as const, childIdOf)));
  });

  it.each([
    ["only one module has callers", { p2: 7 }, parent],
    [
      "the territory names one package",
      callers,
      { ...parent, territory: modules[1] ?? parent.territory },
    ],
    [
      "the ask is no migrate ask",
      callers,
      {
        ...parent,
        check: CheckSpec.cases.SymbolAbsent.make({
          count: countOf(symbol),
          symbol: SymbolName.make(symbol),
        }),
      },
    ],
  ] as const)("does not split when %s", (_, byModule, of) => {
    expect(split(byModule, of)).toStrictEqual(Option.none());
  });

  it("holds every child to the parent's asker, kind and reserve", () => {
    const reserved: Ask = {
      ...parent,
      mentor: Handle.make("alice"),
      reserve: "newcomers",
    };

    const made = Option.getOrThrow(split(callers, reserved));

    expect(
      [...made.children, made.deleteChild].map((ask) =>
        Struct.pick(ask, ["askedBy", "kind", "mentor", "reserve"])
      )
    ).toStrictEqual(
      Array.makeBy(7, () => ({
        askedBy: parent.askedBy,
        kind: KindName.make("migrate"),
        mentor: Handle.make("alice"),
        reserve: "newcomers",
      }))
    );
  });
});

describe(callersIn, () => {
  const twoPackages: Territory = {
    module: ".",
    paths: [Glob.make("packages/p1/**"), Glob.make("packages/p2/**")],
  };

  it.each([
    ["the one package it names", modules[1] ?? parent.territory, 7],
    ["every package", parent.territory, total],
    ["two of the six packages", twoPackages, callers.p1 + callers.p2],
  ] as const)("counts the callers in %s", (_, territory, count) => {
    expect(callersIn(territory, counted(callers), modules)).toStrictEqual(
      count
    );
  });
});

describe(childId, () => {
  it.each([
    ["p1", "drop-legacy-fetch-p1"],
    ["@burrow/http-kit", "drop-legacy-fetch-burrow-http-kit"],
    ["--Odd__Name--", "drop-legacy-fetch-odd-name"],
  ])("names %s's child %s, an ask id with no --", (module, id) => {
    const named = childId(parentId, module);

    expect([
      named,
      named.includes("--"),
      Schema.is(AskId)(named),
    ]).toStrictEqual([id, false, true]);
  });

  it("names the delete child apart from every child", () => {
    expect(deleteChildId(parentId)).toStrictEqual(deleteId);
  });
});

const standing = (closed: readonly Package[]) => {
  const made = Option.getOrThrow(split(callers));

  return new Map(
    [made.parent, ...made.children, made.deleteChild].map((ask) => [
      ask.id,
      packages.some(
        (name) => closed.includes(name) && childIdOf(name) === ask.id
      )
        ? { ...ask, state: "closed" as const }
        : ask,
    ])
  );
};

describe(remainingBlockers, () => {
  it("names the children still open, in order", () => {
    const asks = standing(["p1", "p3", "p5"]);

    expect(
      remainingBlockers(
        Option.getOrThrow(Option.fromUndefinedOr(asks.get(deleteId))),
        asks
      )
    ).toStrictEqual(Array.map(["p2", "p4", "p6"] as const, childIdOf));
  });

  it("names none once every child has closed", () => {
    const asks = standing(packages);

    expect(
      remainingBlockers(
        Option.getOrThrow(Option.fromUndefinedOr(asks.get(deleteId))),
        asks
      )
    ).toStrictEqual([]);
  });

  it("keeps an ask it does not know as blocking", () => {
    const ghost = AskId.make("never-opened");

    expect(
      remainingBlockers({ ...parent, blockedBy: [ghost] }, new Map())
    ).toStrictEqual([ghost]);
  });
});

describe(familyClosed, () => {
  it("is false while the delete child is open, and true once it closes", () => {
    const asks = standing(packages);

    const deleteChild = Option.getOrThrow(
      Option.fromUndefinedOr(asks.get(deleteId))
    );

    expect([
      familyClosed(parentId, asks),
      familyClosed(
        parentId,
        new Map(asks).set(deleteId, { ...deleteChild, state: "closed" })
      ),
    ]).toStrictEqual([false, true]);
  });

  it("is false for an ask with no children", () => {
    expect([familyClosed(tidyId, standing([]))]).toStrictEqual([false]);
  });
});

const facts = Schema.decodeSync(EvaluationFacts)({
  ci: [],
  initializer: "alice",
  now: "2026-10-07T12:00:00.000Z",
  project,
  seed: 7,
  workspaces: packages.map((name) => ({
    dir: `packages/${name}`,
    exports: [],
    name,
  })),
});

const projectFile = [
  `import { kinds, project } from "${Brand.cliPackage}/rules";`,
  "",
  "export default project({",
  "  kinds: [kinds.migrate],",
  '  run: { checks: {}, test: "bun test {path}" },',
  "});",
  "",
].join("\n");

const stated = (ask: Ask) =>
  Struct.pick(ask, [
    "blockedBy",
    "brief",
    "check",
    "file",
    "id",
    "kind",
    "parent",
    "territory",
  ]);

const byId = (asks: readonly Ask[]) =>
  asks.map(stated).toSorted((a, b) => a.id.localeCompare(b.id));

const evaluatedFamily = (of: Ask) =>
  Effect.gen(function* () {
    const made = Option.getOrThrow(split(callers, of));
    const evaluator = yield* RulesEvaluator;

    const policy = yield* evaluator.evaluate({
      at: LandedSha.make("a".repeat(40)),
      facts,
      modules: {
        entry: `${Brand.configDir}/project.ts`,
        modules: {
          [`${Brand.configDir}/project.ts`]: projectFile,
          ...Object.fromEntries(
            made.files.map(({ content, path }) => [path, content])
          ),
        },
        sdkVersion,
      },
    });

    return {
      evaluated: byId(policy.asks),
      family: byId([...made.children, made.deleteChild]),
    };
  }).pipe(
    Effect.provide(
      RulesEvaluatorBun.pipe(
        Layer.provide(Layer.mergeAll(FinishersFromChecks, NodeServices.layer))
      )
    )
  );

describe("the family's ask files", () => {
  it.live(
    "evaluate, through the sdk, to the family's children and its delete child",
    () =>
      Effect.map(evaluatedFamily(parent), ({ evaluated, family: written }) => {
        expect(evaluated).toStrictEqual(written);
      }),
    wholeStory
  );

  it.live(
    "keep the parent's kind when it is a migrate kind of another name",
    () =>
      Effect.map(
        evaluatedFamily({ ...parent, kind: KindName.make("dropApi") }),
        ({ evaluated, family: written }) => {
          expect([
            evaluated,
            Array.dedupe(evaluated.map(({ kind }) => kind)),
          ]).toStrictEqual([written, [KindName.make("dropApi")]]);
        }
      ),
    wholeStory
  );
});
