import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckExit } from "@repo/checks/check-runner/wire";
import { phasePlan } from "@repo/checks/phases";
import { Command, Hostname } from "@repo/protocol/domain/common";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AreaName,
  CommitSha,
  LaneName,
  ProjectName,
  RepoName,
  SuiteRoot,
  TreeSha,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Duration,
  Effect,
  Exit,
  Fiber,
  Match,
  Option,
  Redacted,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { Checker, runCheck } from "../src/checker.ts";
import type { Checkers } from "../src/checker.ts";
import { CLONE_HOST, REGISTRIES } from "../src/checker/network.ts";
import { check } from "../src/checker/run.ts";
import { CheckerWire } from "../src/checker/wire.ts";
import { CloneGateway, EgressGateway } from "../src/outbound.ts";
import type { CloneProps, EgressProps } from "../src/outbound.ts";
import { exited, fakeChecker, fakeContainer } from "./fake-box.ts";
import type { Call, ContainerCall } from "./fake-box.ts";
import { fakeEnv } from "./fake-env.ts";

const TOKEN = "art_v1_read-only-secret?expires=1791400000";

const SETUP = "bun install --frozen-lockfile --ignore-scripts";

const run = RunBlock.make({
  checks: {
    [LaneName.make("lint")]: Command.make("bun run lint"),
    [LaneName.make("unit")]: Command.make("bun test"),
  },
  setup: Command.make(SETUP),
  setupEgress: [Hostname.make("npm.pkg.github.com")],
  test: Command.make("bun test {path}"),
});

const lanes = [
  { command: "bun run lint", lane: LaneName.make("lint") },
  { command: "bun test", lane: LaneName.make("unit") },
];

const wireFor = (project = "datekit"): CheckerWire => ({
  clone: {
    token: Redacted.make(TOKEN),
    url: `https://0123abcd.artifacts.cloudflare.net/git/public/${project}.git`,
  },
  job: {
    at: CheckAt.cases.Commit.make({ commit: CommitSha.make("a".repeat(40)) }),
    lanes,
    placeholders: [],
    project: ProjectName.make(project),
    proxies: [],
    repo: RepoName.make(project),
    run,
  },
});

const isShell = (call: Call, command: string) =>
  call.kind === "exec" &&
  call.argv[0] === "sh" &&
  call.argv[1] === "-c" &&
  call.argv[2] === command;

/** How many times setup's command ran. */
const setups = (calls: readonly Call[]) =>
  calls.filter((call) => isShell(call, SETUP)).length;

/**
 * The recording as phases, each run of calls for one phase read as one:
 * the clone's route and git commands, setup's snapshot lookup, network and
 * command, the snapshot, egress off, the lanes, the report, the destroy.
 */
const phaseOf = Match.type<Call>().pipe(
  Match.discriminatorsExhaustive("kind")({
    allow: ({ hosts }): readonly string[] =>
      hosts.length === 0 ? ["egressOff"] : ["setup"],
    destroy: () => ["destroy"],
    exec: (call) => {
      if (call.argv[0] === "git") {
        return ["clone"];
      }

      return isShell(call, SETUP) ? ["setup"] : ["run"];
    },
    // Log lines are no phase of their own.
    log: () => [],
    report: () => ["report"],
    restore: () => ["setup"],
    route: () => ["clone"],
    save: () => ["snapshot"],
    writeFile: () => ["writeHeldBack"],
  })
);

const phasesOf = (calls: readonly Call[]) =>
  calls
    .flatMap(phaseOf)
    .filter((phase, at, all) => at === 0 || all[at - 1] !== phase);

const tagsOf = (plan: ReturnType<typeof phasePlan>) =>
  plan.map(({ _tag }) => `${_tag.charAt(0).toLowerCase()}${_tag.slice(1)}`);

describe("the Checker", () => {
  it.effect(
    "clones, sets up with registry egress, snapshots, cuts egress, runs the lanes, reports and destroys, in the plan's order",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker();

        const outcome = yield* Effect.exit(
          check(wireFor()).pipe(Effect.provide(fake.layer))
        );

        expect(Exit.isSuccess(outcome)).toBeTruthy();

        const observed = phasesOf(fake.calls);

        expect(observed).toStrictEqual([
          "clone",
          "setup",
          "snapshot",
          "egressOff",
          "run",
          "report",
          "destroy",
        ]);

        expect(observed.slice(1, -1)).toStrictEqual(
          tagsOf(
            phasePlan({
              heldBack: Option.none(),
              lanes,
              lockfileHash: "any",
              placeholders: [],
              run,
            })
          )
        );

        // Setup ran while egress allowed the registries and the run block's
        // own setup host, and nothing else.
        const setupAt = fake.calls.findIndex((call) => isShell(call, SETUP));

        const egress = fake.calls
          .slice(0, setupAt)
          .findLast((call) => call.kind === "allow");

        expect(egress).toStrictEqual({
          hosts: [...REGISTRIES, "npm.pkg.github.com"],
          kind: "allow",
        });

        // The lanes ran in the job's order, after egress went off.
        expect(
          fake.calls.flatMap((call) =>
            call.kind === "exec" && call.argv[0] === "sh" ? [call.argv[2]] : []
          )
        ).toStrictEqual([SETUP, "bun run lint", "bun test"]);
      })
  );

  it.effect(
    "takes no snapshot once the held-back slot is reached, and refuses a sealed suite until W6 writes one",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker();
        const wire = wireFor();

        const outcome = yield* Effect.exit(
          check({
            ...wire,
            job: {
              ...wire.job,
              heldBack: {
                areas: [AreaName.make("parsing")],
                at: CommitSha.make("b".repeat(40)),
                layerRepo: RepoName.make("datekit--layer--maintainers"),
                suite: SuiteRoot.make(`sha256:${"d".repeat(64)}`),
              },
            },
          }).pipe(Effect.provide(fake.layer))
        );

        expect(Exit.findErrorOption(outcome)).toStrictEqual(
          Option.some(new VerifierBlocked({}))
        );

        const slot = fake.calls.findIndex(
          (call) =>
            call.kind === "log" && call.annotations.phase === "WriteHeldBack"
        );

        expect(slot).toBeGreaterThan(-1);
        expect(
          fake.calls.slice(slot).filter((call) => call.kind === "save")
        ).toStrictEqual([]);
        expect(phasesOf(fake.calls)).toStrictEqual([
          "clone",
          "setup",
          "snapshot",
          "egressOff",
          "report",
          "destroy",
        ]);
      })
  );

  it.effect(
    "clones through the intercepted host, and never shows the container the token",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker();

        yield* check(wireFor()).pipe(Effect.provide(fake.layer));

        expect(
          fake.calls.filter((call) => call.kind === "route")
        ).toStrictEqual([
          {
            host: CLONE_HOST,
            kind: "route",
            remote:
              "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git",
            token: TOKEN,
          },
        ]);

        const fetched = fake.calls.find(
          (call) => call.kind === "exec" && call.argv.includes("fetch")
        );

        expect(fetched?.kind === "exec" ? fetched.argv : []).toContain(
          `https://${CLONE_HOST}/git/public/datekit.git`
        );

        // Everything the container was handed (commands, their env and
        // working directories, files) and everything logged or reported:
        // only the route, on the Worker's side, holds the token.
        const seen = JSON.stringify(
          fake.calls.filter((call) => call.kind !== "route")
        );

        expect(seen).not.toContain("read-only-secret");
        expect(seen).not.toContain(TOKEN);
      })
  );

  it.effect(
    "is VerifierBlocked when setup cannot reach a host, and names the host in setup's log and a log annotation",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker({
          commands: new Map([
            [
              SETUP,
              exited(1, {
                stderr:
                  "error: GET https://evil.example/left-pad/-/left-pad-1.3.0.tgz - 403\n",
              }),
            ],
          ]),
        });

        const outcome = yield* Effect.exit(
          check(wireFor()).pipe(Effect.provide(fake.layer))
        );

        expect(Exit.findErrorOption(outcome)).toStrictEqual(
          Option.some(new VerifierBlocked({}))
        );

        const reported = fake.calls.flatMap((call) =>
          call.kind === "report" ? call.logs : []
        );

        const setupLog = reported.find(({ phase }) => phase === "setup");

        expect(setupLog?.text).toContain("refused: evil.example");
        expect(
          fake.calls.flatMap((call) =>
            call.kind === "log" && call.annotations.phase === "setup"
              ? [call.annotations.blockedHosts]
              : []
          )
        ).toStrictEqual(["evil.example"]);

        // Nothing ran after setup, nothing was kept, and the box is gone.
        expect(phasesOf(fake.calls)).toStrictEqual([
          "clone",
          "setup",
          "report",
          "destroy",
        ]);
      })
  );

  it.effect(
    "reports a failing lane as that lane's result, from how it failed, never as an error",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker({
          commands: new Map([
            [
              "bun test",
              exited(1, {
                stdout:
                  "(fail) week > parses ISO weeks\nAssertionError: expected 52 to be 53\n",
              }),
            ],
            [
              "bun run lint",
              exited(1, { stderr: "Cannot find module 'oxlint'\n" }),
            ],
          ]),
        });

        const ran = yield* check(wireFor()).pipe(Effect.provide(fake.layer));

        expect(
          ran.lanes.map(({ command, lane, result }) => ({
            command,
            lane,
            result,
          }))
        ).toStrictEqual([
          { command: "bun run lint", lane: "lint", result: "loadError" },
          { command: "bun test", lane: "unit", result: "failed" },
        ]);
        expect(ran.evidence).toStrictEqual([
          { lane: "lint" },
          {
            lane: "unit",
            signature:
              "week > parses ISO weeks: AssertionError: expected 52 to be 53",
          },
        ]);
        // No raw log travels in the result.
        expect(JSON.stringify(ran)).not.toContain("Cannot find module");
      })
  );

  it.effect(
    "restores the snapshot for a second job of the same project and lockfile, instead of running setup again",
    () =>
      Effect.gen(function* () {
        const snapshots = new Set<string>();
        const first = fakeChecker({ snapshots });
        const second = fakeChecker({ snapshots });
        const elsewhere = fakeChecker({ snapshots });

        yield* check(wireFor()).pipe(Effect.provide(first.layer));
        yield* check(wireFor()).pipe(Effect.provide(second.layer));
        yield* check(wireFor("burrow")).pipe(Effect.provide(elsewhere.layer));

        expect(
          [first, second, elsewhere].map(({ calls }) => setups(calls))
        ).toStrictEqual([1, 0, 1]);
        expect(
          second.calls.flatMap((call) =>
            call.kind === "restore" || call.kind === "save" ? [call.kind] : []
          )
        ).toStrictEqual(["restore"]);
        expect(
          second.calls.flatMap((call) =>
            call.kind === "restore" ? [call.hit] : []
          )
        ).toStrictEqual([true]);

        // The restored workspace is checked out at this job's tree again
        // before any lane runs.
        const restoredAt = second.calls.findIndex(
          (call) => call.kind === "restore"
        );

        expect(
          second.calls
            .slice(restoredAt)
            .some(
              (call) => call.kind === "exec" && call.argv.includes("checkout")
            )
        ).toBeTruthy();
        expect(phasesOf(second.calls)).toStrictEqual([
          "clone",
          "setup",
          "clone",
          "egressOff",
          "run",
          "report",
          "destroy",
        ]);
      })
  );

  it.effect(
    "never keeps the setup a check of an answer's tree ran, though such a check restores the project's",
    () =>
      Effect.gen(function* () {
        const snapshots = new Set<string>();
        const wire = wireFor();

        const answer: CheckerWire = {
          ...wire,
          job: {
            ...wire.job,
            at: CheckAt.cases.Tree.make({ tree: TreeSha.make("e".repeat(40)) }),
            repo: RepoName.make("datekit--week--alice"),
          },
        };

        const first = fakeChecker({ snapshots });
        const main = fakeChecker({ snapshots });
        const again = fakeChecker({ snapshots });

        yield* check(answer).pipe(Effect.provide(first.layer));
        yield* check(wire).pipe(Effect.provide(main.layer));
        yield* check(answer).pipe(Effect.provide(again.layer));

        expect(
          [first, main, again].map(({ calls }) =>
            calls.flatMap((call) =>
              call.kind === "save" || call.kind === "restore" ? [call.kind] : []
            )
          )
        ).toStrictEqual([["restore"], ["restore", "save"], ["restore"]]);
        expect(
          [first, main, again].map(({ calls }) => setups(calls))
        ).toStrictEqual([1, 1, 0]);
      })
  );

  it.effect(
    "destroys the container when a lane runs out of time, and reports that lane as blocked",
    () =>
      Effect.gen(function* () {
        const fake = fakeChecker({
          commands: new Map([["bun test", Effect.never]]),
        });

        const wire = wireFor();

        const fiber = yield* check({
          ...wire,
          job: {
            ...wire.job,
            lanes: [
              {
                command: "bun test",
                lane: LaneName.make("unit"),
                timeoutMs: 1000,
              },
              { command: "bun run lint", lane: LaneName.make("lint") },
            ],
          },
        }).pipe(Effect.provide(fake.layer), Effect.forkChild);

        yield* TestClock.adjust(Duration.seconds(1));

        const ran = yield* Fiber.join(fiber);

        expect(
          ran.lanes.map(({ lane, result }) => ({ lane, result }))
        ).toStrictEqual([
          { lane: "unit", result: "blocked" },
          { lane: "lint", result: "passed" },
        ]);
        expect(fake.calls.at(-1)).toStrictEqual({ kind: "destroy" });
        expect(
          fake.calls.filter((call) => call.kind === "destroy")
        ).toHaveLength(1);
      })
  );
});

/** The requests the Worker sends on, in place of the network, until the scope ends. */
const outboundRecorded = Effect.acquireRelease(
  Effect.sync(() => {
    const sent: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      sent.push(request);

      return Promise.resolve(new Response("upstream"));
    });

    return sent;
  }),
  () => Effect.sync(() => vi.unstubAllGlobals())
);

const REMOTE =
  "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git";

const cloneGateway = () =>
  new CloneGateway(
    untouchable<ExecutionContext<CloneProps>>("ctx", {
      props: { remote: REMOTE, token: TOKEN },
    }),
    fakeEnv()
  );

const statusOf = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((text) => ({ status: response.status, text }))
  );

describe("the clone gateway", () => {
  it.effect(
    "sends the container's upload-pack requests on to the job's remote, adding the token",
    () =>
      Effect.gen(function* () {
        const sent = yield* outboundRecorded;
        const gateway = cloneGateway();

        yield* Effect.promise(() =>
          gateway.fetch(
            new Request(
              `https://${CLONE_HOST}/git/public/datekit.git/info/refs?service=git-upload-pack`,
              { headers: { "git-protocol": "version=2" } }
            )
          )
        );
        yield* Effect.promise(() =>
          gateway.fetch(
            new Request(
              `https://${CLONE_HOST}/git/public/datekit.git/git-upload-pack`,
              { body: "0000", method: "POST" }
            )
          )
        );

        expect(
          sent.map((request) => ({
            authorization: request.headers.get("authorization"),
            method: request.method,
            protocol: request.headers.get("git-protocol"),
            url: request.url,
          }))
        ).toStrictEqual([
          {
            authorization: `Bearer ${TOKEN}`,
            method: "GET",
            protocol: "version=2",
            url: `${REMOTE}/info/refs?service=git-upload-pack`,
          },
          {
            authorization: `Bearer ${TOKEN}`,
            method: "POST",
            protocol: null,
            url: `${REMOTE}/git-upload-pack`,
          },
        ]);
      })
  );

  it.effect(
    "refuses a push, a query git never sends, another repo's path, and another host, sending nothing on",
    () =>
      Effect.gen(function* () {
        const sent = yield* outboundRecorded;
        const gateway = cloneGateway();

        const refused = yield* Effect.forEach(
          [
            new Request(
              `https://${CLONE_HOST}/git/public/datekit.git/info/refs?service=git-receive-pack`
            ),
            new Request(
              `https://${CLONE_HOST}/git/public/datekit.git/git-receive-pack`,
              { body: "0000", method: "POST" }
            ),
            new Request(
              `https://${CLONE_HOST}/git/public/datekit.git/git-upload-pack?service=git-receive-pack`,
              { body: "0000", method: "POST" }
            ),
            new Request(
              `https://${CLONE_HOST}/git/public/burrow.git/info/refs?service=git-upload-pack`
            ),
            new Request(
              "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git/info/refs?service=git-upload-pack"
            ),
          ],
          (request) =>
            Effect.map(
              Effect.promise(() => gateway.fetch(request)),
              ({ status }) => status
            )
        );

        expect(refused).toStrictEqual([403, 403, 403, 403, 403]);
        expect(sent).toStrictEqual([]);
      })
  );
});

describe("the egress gateway", () => {
  it.effect(
    "lets out requests to the hosts it allows, unchanged, and refuses the rest, naming the host",
    () =>
      Effect.gen(function* () {
        const sent = yield* outboundRecorded;

        const gateway = new EgressGateway(
          untouchable<ExecutionContext<EgressProps>>("ctx", {
            props: { allow: ["registry.npmjs.org", "*.pkg.example.com"] },
          }),
          fakeEnv()
        );

        const answers = yield* Effect.forEach(
          [
            "https://registry.npmjs.org/left-pad",
            "https://npm.pkg.example.com/@acme/kit",
            "https://evil.example/left-pad.tgz",
            "https://pkg.example.com/apex",
          ],
          (url) =>
            Effect.flatMap(
              Effect.promise(() => gateway.fetch(new Request(url))),
              statusOf
            )
        );

        expect(answers).toStrictEqual([
          { status: 200, text: "upstream" },
          { status: 200, text: "upstream" },
          {
            status: 403,
            text: "egress refused: evil.example is not on this check's allow-list\n",
          },
          {
            status: 403,
            text: "egress refused: pkg.example.com is not on this check's allow-list\n",
          },
        ]);
        expect(sent.map(({ url }) => url)).toStrictEqual([
          "https://registry.npmjs.org/left-pad",
          "https://npm.pkg.example.com/@acme/kit",
        ]);
      })
  );

  it.effect("with nothing allowed, lets nothing out", () =>
    Effect.gen(function* () {
      const sent = yield* outboundRecorded;

      const gateway = new EgressGateway(
        untouchable<ExecutionContext<EgressProps>>("ctx", {
          props: { allow: [] },
        }),
        fakeEnv()
      );

      const response = yield* Effect.promise(() =>
        gateway.fetch(new Request("https://registry.npmjs.org/left-pad"))
      );

      expect(response.status).toBe(403);
      expect(sent).toStrictEqual([]);
    })
  );
});

/**
 * The sandbox's `CHECKER` namespace: each unique id gets a Checker over its
 * own fake container, and `snapshots:<project>` names an index kept in
 * `index`.
 */
const checkerWorld = (options: { readonly withGateways: boolean }) => {
  const boxes: ReturnType<typeof fakeContainer>[] = [];
  const index = new Map<string, string>();
  const named: string[] = [];

  /** A project's snapshot index, as Workers RPC hands one back. */
  const indexStub = untouchable<DurableObjectStub<Checker>>("index", {
    forgetSnapshot: (key) => {
      index.delete(key);

      return Promise.resolve();
    },
    keepSnapshot: (key, id) => {
      index.set(key, id);

      return Promise.resolve();
    },
    snapshotOf: (key) => {
      const id = index.get(key);

      return id === undefined ? Promise.resolve(null) : Promise.resolve(id);
    },
  });

  const indexNamed = (name: string) => {
    named.push(name);

    return indexStub;
  };

  // A Checker reaches only its project's snapshot index through the env.
  const env: Env = {
    CHECKER: untouchable<Env["CHECKER"]>("CHECKER", { getByName: indexNamed }),
    LANDER: untouchable("LANDER"),
  };

  const checkers: Checkers = {
    CHECKER: {
      get: () => {
        const box = fakeContainer();

        boxes.push(box);

        // The Worker's other exports are not the Checker's to touch: only
        // the gateways are real members.
        const exports = options.withGateways
          ? { ...untouchable<Cloudflare.Exports>("exports"), ...box.exports }
          : { ...untouchable<Cloudflare.Exports>("exports") };

        return new Checker(
          untouchable<DurableObjectState>("ctx", {
            container: box.container,
            exports,
          }),
          env
        );
      },
      getByName: indexNamed,
      newUniqueId: () => untouchable<DurableObjectId>(`id-${boxes.length}`),
    },
  };

  return { boxes, checkers, index, named };
};

const encodedWire = () =>
  Schema.encodeEffect(CheckerWire)(wireFor()).pipe(Effect.orDie);

/** Two jobs of one project through `runCheck`, one after the other. */
const twoJobs = Effect.gen(function* () {
  const world = checkerWorld({ withGateways: true });
  const wire = yield* encodedWire();

  const outcomes = yield* Effect.forEach([wire, wire], (each) =>
    Effect.flatMap(
      Effect.promise(() => runCheck(world.checkers, each)),
      Schema.decodeEffect(CheckExit)
    )
  );

  return { ...world, outcomes };
});

const intercepts = (calls: readonly ContainerCall[]) =>
  calls.flatMap((call) =>
    call.kind === "intercept" ? [`${call.target} → ${call.to}`] : []
  );

describe(runCheck, () => {
  it.effect(
    "decodes the job, runs it in a Checker of its own, and encodes its outcome, destroying each container",
    () =>
      Effect.gen(function* () {
        const { boxes, outcomes } = yield* twoJobs;

        expect(
          outcomes.map((outcome) =>
            Exit.match(outcome, {
              onFailure: () => [],
              onSuccess: ({ lanes: ran }) => ran.map(({ result }) => result),
            })
          )
        ).toStrictEqual([
          ["passed", "passed"],
          ["passed", "passed"],
        ]);
        expect(boxes.map(({ calls }) => calls.at(-1))).toStrictEqual([
          { kind: "destroy" },
          { kind: "destroy" },
        ]);
      })
  );

  it.effect(
    "routes the clone host to the clone gateway until setup starts, the rest to the egress gateway, and closes every route once egress is off",
    () =>
      Effect.gen(function* () {
        const { boxes } = yield* twoJobs;
        const setupHosts = [...REGISTRIES, "npm.pkg.github.com"].join(" ");

        expect(intercepts(boxes[0]?.calls ?? [])).toStrictEqual([
          `${CLONE_HOST} → clone ${REMOTE} ${TOKEN}`,
          "* → egress []",
          "http:* → egress []",
          // Setup reaches the registries and its own hosts, not the repo.
          `${CLONE_HOST} → egress [${setupHosts}]`,
          `* → egress [${setupHosts}]`,
          `http:* → egress [${setupHosts}]`,
          `${CLONE_HOST} → egress []`,
          "* → egress []",
          "http:* → egress []",
        ]);
        // Nothing the containers ran or were given holds the token: it went
        // only to the clone gateway's props, on the Worker's side.
        expect(
          JSON.stringify(
            boxes.flatMap(({ calls }) =>
              calls.filter((call) => call.kind !== "intercept")
            )
          )
        ).not.toContain("read-only-secret");
      })
  );

  it.effect(
    "starts the second job's container from the snapshot the first one kept, in the project's index",
    () =>
      Effect.gen(function* () {
        const { boxes, index, named } = yield* twoJobs;
        const [first, second] = boxes;

        expect(
          first?.calls.filter((call) => call.kind === "snapshot")
        ).toHaveLength(1);
        expect([...index.values()]).toStrictEqual(["snapshot-1"]);
        expect([...new Set(named)]).toStrictEqual(["snapshots:datekit"]);
        expect(
          second?.calls.filter((call) => call.kind === "start")
        ).toStrictEqual([{ from: "snapshot-1", kind: "start" }]);
        expect(
          second?.calls.filter(
            (call) => call.kind === "exec" && call.argv.includes(SETUP)
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "is VerifierBlocked, starting no container, while the Worker does not export the gateways",
    () =>
      Effect.gen(function* () {
        const world = checkerWorld({ withGateways: false });
        const wire = yield* encodedWire();

        const outcome = yield* Effect.flatMap(
          Effect.promise(() => runCheck(world.checkers, wire)),
          Schema.decodeEffect(CheckExit)
        );

        expect(Exit.findErrorOption(outcome)).toStrictEqual(
          Option.some(new VerifierBlocked({}))
        );
        expect(world.boxes.flatMap(({ calls }) => calls)).toStrictEqual([]);
      })
  );
});
