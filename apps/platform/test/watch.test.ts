import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Contracts } from "@repo/protocol/contracts";
import type { Client } from "@repo/protocol/contracts";
import { ProjectEvent } from "@repo/protocol/domain/event";
import {
  AskId,
  LandedSha,
  LaneName,
  ProjectName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Array,
  Context,
  Effect,
  FiberSet,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { DoProjects } from "../src/adapters/do-projects.ts";
import type { ProjectNamespace } from "../src/adapters/do-projects.ts";
import { decodeEnv } from "../src/platform.ts";
import { workerPorts } from "../src/ports.ts";
import {
  closeEnd,
  ProjectSockets,
  WATCH_TAG,
  WatchFrame,
  watchHandler,
  watchRequest,
  watchRoom,
} from "../src/watch.ts";
import type { SocketState, WatchNamespace } from "../src/watch.ts";
import { fakeEnv } from "./fake-env.ts";
import {
  anyone,
  bob,
  opening,
  parseIso as doParseIso,
  project as doProject,
  shellOver,
  through,
  unlisted,
  world as doWorld,
} from "./project-do.fixtures.ts";
import { coreLoopWorld } from "./world.ts";
import type { CoreLoopWorld } from "./world.ts";

const project = ProjectName.make("dora/datekit");

const parseIso = AskId.make("parse-iso");

const redThenGreen = LaneName.make("redThenGreen");

const sdk = `${Brand.cliPackage}/rules`;

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
  "README.md": "datekit: dates, parsed\n",
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/parse.ts":
    "export const parse = (iso: string) => ({ month: 0, year: 0 });\n",
};

const isoFiles = Array.make(
  {
    content: [
      `import { kinds, territory } from "${sdk}";`,
      ``,
      `export default kinds.fix.ask({`,
      `  path: "test/${parseIso}.test.ts",`,
      `  territory: territory.paths("src/parse.ts"),`,
      `  want: "parse reads the year of an ISO date",`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`${Brand.configDir}/asks/${parseIso}.ask.ts`),
  },
  {
    content: [
      `import { expect, it } from "bun:test";`,
      `import { parse } from "../src/parse.ts";`,
      ``,
      `it("parse reads the year of an ISO date", () => {`,
      `  expect(parse("2026-10-07").year).toBe(2026);`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`test/${parseIso}.test.ts`),
  }
);

const yearRead =
  "export const parse = (iso: string) => ({ month: 0, year: Number(iso.slice(0, 4)) });\n";

const LIVE = "5 seconds";

const framedClient = (world: CoreLoopWorld) =>
  RpcClient.make(Contracts).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${world.origin}/rpc` }).pipe(
        Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
      )
    )
  );

const hearing = <E, R>(events: Stream.Stream<ProjectEvent, E, R>) =>
  Effect.gen(function* () {
    const heard = yield* Ref.make<readonly ProjectEvent[]>([]);

    yield* events.pipe(
      Stream.runForEach((event) => Ref.update(heard, (all) => [...all, event])),
      Effect.ignore,
      Effect.forkScoped
    );

    return heard;
  });

const watcher = (client: Client["Service"], since: number) =>
  hearing(client.watch({ project, since }));

const heardUntil = (
  heard: Ref.Ref<readonly ProjectEvent[]>,
  done: (events: readonly ProjectEvent[]) => boolean
) =>
  Ref.get(heard).pipe(
    Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: done }),
    Effect.timeoutOption(LIVE),
    Effect.andThen(Ref.get(heard))
  );

const brief = (events: readonly ProjectEvent[]) =>
  events.map(({ _tag, seq }) => `${seq} ${_tag}`);

const unbroken = (events: readonly ProjectEvent[], since: number) =>
  events.every(({ seq }, index) => seq === since + index + 1);

const answered = (event: ProjectEvent) =>
  ProjectEvent.guards.Landed(event) && event.landing.ask !== undefined;

const datekitOpened = (world: CoreLoopWorld) =>
  Effect.gen(function* () {
    const dora = world.rpc("dora");
    const doraGit = world.git("dora");
    const made = yield* dora.initProject({ project });
    const home = yield* doraGit.clone(made.remote);

    yield* doraGit.commit(home, "Start datekit", start);
    yield* doraGit.push(home);

    yield* world.script(
      CheckAt.cases.Commit.make({
        commit: yield* world.composed(project, isoFiles),
      }),
      redThenGreen,
      ["failed", "failed"]
    );

    yield* dora.openAsk({ ask: parseIso, files: isoFiles, project });
  });

describe("watch over the framed /rpc, through the Node platform world", () => {
  it.live(
    "replays the kept events in order, then hears a claim and a landing as they happen; a watcher from a number hears only what came after; an unknown project is UnknownProject",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const reader = world.rpc("anonymous");
        const framed = yield* framedClient(world);

        yield* datekitOpened(world);

        const kept = yield* Stream.runCollect(
          reader.watch({ project, since: 0 })
        );

        const first = yield* watcher(framed, 0);

        const replayed = yield* heardUntil(
          first,
          (events) => events.length >= kept.length
        );

        const { claim } = yield* world
          .rpc("alice")
          .claim({ ask: parseIso, project });

        const claimed = yield* heardUntil(first, (events) =>
          events.some(ProjectEvent.guards.Claimed)
        );

        const claimedAt = claimed.findLast(ProjectEvent.guards.Claimed);

        const aliceGit = world.git("alice");
        const work = yield* aliceGit.clone(claim.remote);

        const fix = yield* aliceGit.commit(work, "Read the year", {
          "src/parse.ts": yearRead,
        });

        yield* aliceGit.push(work);

        yield* world.script(
          CheckAt.cases.Tree.make({
            tree: TreeSha.make(
              yield* aliceGit.ok(work, "rev-parse", `${fix}^{tree}`)
            ),
          }),
          redThenGreen,
          ["passed"]
        );

        yield* world.settle();

        const landedAt = (yield* heardUntil(first, (events) =>
          events.some(answered)
        ))
          .filter(ProjectEvent.guards.Landed)
          .findLast(({ landing }) => landing.ask !== undefined);

        const shown =
          landedAt === undefined
            ? undefined
            : (yield* reader.landing({
                project,
                sha: LandedSha.make(landedAt.landing.sha),
              })).landing;

        const since = claimedAt?.seq ?? 0;

        const after = yield* Stream.runCollect(
          reader.watch({ project, since })
        );

        const second = yield* watcher(framed, since);

        const resumed = yield* heardUntil(
          second,
          (events) => events.length >= after.length
        );

        const all = yield* heardUntil(
          first,
          (events) => events.at(-1)?.seq === after.at(-1)?.seq
        );

        expect({
          claimed: claimedAt && {
            ask: claimedAt.ask,
            claimant: claimedAt.claimant,
          },
          landed: landedAt && {
            ask: landedAt.landing.ask,
            author: landedAt.landing.author,
            shown: landedAt.landing,
          },
          replayed: brief(replayed.slice(0, kept.length)),
          resumed: brief(resumed),
          unbroken: {
            first: unbroken(all, 0),
            second: unbroken(resumed, since),
          },
        }).toStrictEqual({
          claimed: { ask: parseIso, claimant: "alice" },
          landed: { ask: parseIso, author: "alice", shown },
          replayed: ["1 Landed", "2 AskOpened", "3 Landed"],
          resumed: ["5 Pushed", "6 Judged", "7 Landed", "8 AskClosed"],
          unbroken: { first: true, second: true },
        });
        expect({ after: brief(after), kept: brief(kept) }).toStrictEqual({
          after: brief(resumed),
          kept: brief(replayed.slice(0, kept.length)),
        });
        expect(brief(all.slice(kept.length))).toContain(`${since} Claimed`);
        expect(
          yield* Effect.flip(
            Stream.runCollect(
              framed.watch({ project: ProjectName.make("alice/nowhere") })
            )
          )
        ).toStrictEqual(
          new UnknownProject({ project: ProjectName.make("alice/nowhere") })
        );
      }),
    60_000
  );

  it.live(
    "answers a call posted as JSON in one body when its replay ends, even when the call's own headers claim NDJSON",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld();
        const reader = world.rpc("anonymous");

        yield* world.rpc("dora").initProject({ project });

        const kept = yield* Stream.runCollect(
          reader.watch({ project, since: 0 })
        );

        const claimingFramed = yield* Stream.runCollect(
          reader.watch(
            { project, since: 0 },
            {
              headers: {
                "content-type": RpcSerialization.ndjson.contentType,
              },
            }
          )
        ).pipe(Effect.timeoutOption(LIVE));

        expect(claimingFramed).toStrictEqual(Option.some(kept));
      }),
    60_000
  );
});

const fakeState = () => {
  const accepted: { readonly socket: WebSocket; readonly tags: string[] }[] =
    [];

  const closed = new Set<WebSocket>();

  const state: SocketState = {
    acceptWebSocket: (socket, tags = []) => {
      accepted.push({ socket, tags });
    },
    getTags: (socket) =>
      accepted.find((each) => each.socket === socket)?.tags ?? [],
    getWebSockets: (tag) =>
      accepted.flatMap(({ socket, tags }) =>
        !closed.has(socket) && (tag === undefined || tags.includes(tag))
          ? [socket]
          : []
      ),
  };

  return {
    accepted,
    close: (socket: WebSocket) => {
      closed.add(socket);
    },
    state,
  };
};

const decodeFrame = Schema.decodeEffect(Schema.fromJsonString(WatchFrame));

type Attachment = { readonly seq: number } | null;

const doSocket = () => {
  const sent: string[] = [];
  let attachment: Attachment = null;

  const socket = untouchable<WebSocket>("WebSocket", {
    deserializeAttachment: () => attachment,
    send: (message: string) => {
      sent.push(message);
    },
    serializeAttachment: (value: Attachment) => {
      attachment = structuredClone(value);
    },
  });

  return {
    frames: Effect.forEach(sent, (text) => Effect.orDie(decodeFrame(text))),
    socket,
  };
};

const framed = (frames: readonly WatchFrame[]) =>
  frames.map(({ event, seq }) => `${seq} ${event._tag}`);

const noon = "2026-10-07T12:00:00Z";

describe("a Project DO's watch room, over a fake state and a real shell", () => {
  it.effect(
    "replays only the newest 500 events to a socket opened from 0 when 603 are recorded, in order, and tags it by the number it opened from",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const { accepted, state } = fakeState();
        const room = watchRoom(state, yield* shellOver(":memory:"));
        const call = through(room);

        yield* opening(call);
        yield* Effect.forEach(
          Array.range(1, 300),
          () =>
            Effect.andThen(
              call("claim", [bob, doParseIso]),
              call("release", [bob, doParseIso])
            ),
          { discard: true }
        );

        const watched = doSocket();

        yield* room.admit(watched.socket, 0);

        const frames = yield* watched.frames;

        expect({
          count: frames.length,
          first: framed(frames.slice(0, 2)),
          last: framed(frames.slice(-1)),
          unbroken: frames.every(({ seq }, index) => seq === 104 + index),
        }).toStrictEqual({
          count: 500,
          first: ["104 Claimed", "105 Released"],
          last: ["603 Released"],
          unbroken: true,
        });
        expect(accepted.map(({ tags }) => tags)).toStrictEqual([
          [WATCH_TAG, "since:0"],
        ]);
      }).pipe(Effect.provide(doWorld)),
    60_000
  );

  it.effect(
    "sends every open socket what a call committed, after the commit, each event once; a socket opened from a number hears only what came after it; a read sends nothing",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const { close, state } = fakeState();
        const room = watchRoom(state, yield* shellOver(":memory:"));
        const call = through(room);

        yield* opening(call);

        const fromStart = doSocket();
        const fromNow = doSocket();
        const gone = doSocket();

        yield* room.admit(fromStart.socket, 0);
        yield* room.admit(fromNow.socket, 3);
        yield* room.admit(gone.socket, 3);
        close(gone.socket);

        yield* call("claim", [bob, doParseIso]);
        yield* call("listAsks", [anyone]);
        yield* call("release", [bob, doParseIso]);

        expect({
          fromNow: framed(yield* fromNow.frames),
          fromStart: framed(yield* fromStart.frames),
          gone: framed(yield* gone.frames),
        }).toStrictEqual({
          fromNow: ["4 Claimed", "5 Released"],
          fromStart: [
            "1 Landed",
            "2 AskOpened",
            "3 Landed",
            "4 Claimed",
            "5 Released",
          ],
          gone: [],
        });
      }).pipe(Effect.provide(doWorld))
  );

  it.effect(
    "sends what an alarm committed: a claim lapsed when its deadline passed",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const { state } = fakeState();
        const room = watchRoom(state, yield* shellOver(":memory:"));
        const call = through(room);

        yield* opening(call);
        yield* call("claim", [bob, doParseIso]);

        const watched = doSocket();

        yield* room.admit(watched.socket, 3);
        yield* advanceTo("2026-10-08T12:00:00Z");
        yield* room.alarm();

        expect(
          (yield* watched.frames).map(({ event }) => event._tag)
        ).toContain("Lapsed");
      }).pipe(Effect.provide(doWorld))
  );

  it.effect(
    "answers a call with what it committed even when its watchers cannot be caught up",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const room = watchRoom(
          {
            ...fakeState().state,
            getWebSockets: () => {
              throw new Error("the runtime lost its sockets");
            },
          },
          yield* shellOver(":memory:")
        );

        const call = through(room);

        yield* opening(call);

        const { claim } = yield* call("claim", [bob, doParseIso]);

        expect({ ask: claim.ask, claimant: claim.claimant }).toStrictEqual({
          ask: doParseIso,
          claimant: bob.handle,
        });
      }).pipe(Effect.provide(doWorld))
  );

  it.effect(
    "resumes a socket from the number it opened from when its attachment is gone",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const { state } = fakeState();
        const room = watchRoom(state, yield* shellOver(":memory:"));
        const call = through(room);

        yield* opening(call);

        const watched = doSocket();

        yield* room.admit(watched.socket, 3);
        watched.socket.serializeAttachment(null);

        yield* call("claim", [bob, doParseIso]);

        expect(framed(yield* watched.frames)).toStrictEqual(["4 Claimed"]);
      }).pipe(Effect.provide(doWorld))
  );
});

// Records every `close()`, and refuses a code a close only reports, as workerd does.
const closingSocket = () => {
  const closes: (readonly [number | undefined, string | undefined])[] = [];

  const socket = untouchable<WebSocket>("WebSocket", {
    close: (code?: number, reason?: string) => {
      closes.push([code, reason]);

      if (code === 1005 || code === 1006 || code === 1015) {
        throw new DOMException(
          `Invalid WebSocket close code: ${code}.`,
          "InvalidAccessError"
        );
      }
    },
  });

  return { closes, socket };
};

describe("a Project DO's answer to a watch socket's close", () => {
  it.effect(
    "answers a clean close with the peer's code, and one that carried no code with 1000",
    () =>
      Effect.gen(function* () {
        const { closes, socket } = closingSocket();

        yield* closeEnd(socket, { code: 1000, reason: "bye", wasClean: true });
        yield* closeEnd(socket, { code: 4000, reason: "", wasClean: true });
        yield* closeEnd(socket, { code: 1005, reason: "", wasClean: true });

        expect(closes).toStrictEqual([
          [1000, "bye"],
          [4000, ""],
          [1000, ""],
        ]);
      })
  );

  it.effect(
    "lets a socket that went without a close frame (1006) go without calling close: there is no peer left to answer",
    () =>
      Effect.gen(function* () {
        const { closes, socket } = closingSocket();

        yield* closeEnd(socket, {
          code: 1006,
          reason: "WebSocket disconnected without sending Close frame.",
          wasClean: false,
        });

        expect(closes).toStrictEqual([]);
      })
  );
});

const socketPair = (gone: (socket: WebSocket) => void) => {
  const events = new EventTarget<WebSocketEventMap>();
  const held: string[] = [];
  let listening = false;
  let open = true;
  let attachment: Attachment = null;

  const deliver = (data: string) => {
    events.dispatchEvent(new MessageEvent("message", { data }));
  };

  const server = untouchable<WebSocket>("WebSocket", {
    close: () => {
      open = false;
      gone(server);
      events.dispatchEvent(new Event("close"));
    },
    deserializeAttachment: () => attachment,
    send: (message: string) => {
      if (!open) {
        throw new Error("the socket is closed");
      }

      if (listening) {
        deliver(message);
      } else {
        held.push(message);
      }
    },
    serializeAttachment: (value: Attachment) => {
      attachment = structuredClone(value);
    },
  });

  const client = untouchable<WebSocket>("WebSocket", {
    accept: () => {},
    addEventListener: (type, handler) => {
      events.addEventListener(type, handler);

      if (type === "message") {
        listening = true;

        for (const data of held.splice(0)) {
          deliver(data);
        }
      }
    },
    close: () => {
      open = false;
      gone(server);
    },
  });

  return { client, server };
};

const roomNamespace = (refuses = false) =>
  Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntimePromise();
    const sockets = fakeState();
    const room = watchRoom(sockets.state, yield* shellOver(":memory:"));
    const opened: number[] = [];
    const servers: WebSocket[] = [];

    const namespace: ProjectNamespace & WatchNamespace = {
      get: () => ({
        call: (request) => run(room.call(request)),
        fetch: (request) =>
          Option.match(refuses ? Option.none() : watchRequest(request), {
            onNone: () => Promise.resolve({ webSocket: null }),
            onSome: (since) => {
              const { client, server } = socketPair(sockets.close);

              opened.push(since);
              servers.push(server);

              return run(
                Effect.as(room.admit(server, since), { webSocket: client })
              );
            },
          }),
      }),
      idFromName: (name) =>
        untouchable<DurableObjectId>("DurableObjectId", {
          name,
          toString: () => name,
        }),
    };

    return {
      call: through(room),
      namespace,
      opened: Effect.sync(() => [...opened]),
      server: Effect.sync(() => servers.at(-1)),
    };
  });

const relayedFrom = (namespace: ProjectNamespace & WatchNamespace, since = 0) =>
  watchHandler({ project: doProject, since }, { live: true }).pipe(
    Stream.provideService(ProjectSockets, Option.some(namespace)),
    Stream.provide(DoProjects(namespace).pipe(Layer.provide(unlisted)))
  );

describe("the Worker's relay of a Project DO's watch socket", () => {
  it.live(
    "relays the kept events, then each event a call commits, once each, in order",
    () =>
      Effect.gen(function* () {
        const { call, namespace, opened } = yield* roomNamespace();

        yield* opening(call);

        const heard = yield* hearing(relayedFrom(namespace));

        yield* heardUntil(heard, (events) => events.length >= 3);
        yield* call("claim", [bob, doParseIso]);
        yield* call("release", [bob, doParseIso]);

        expect({
          heard: brief(
            yield* heardUntil(heard, (events) => events.length >= 5)
          ),
          opened: yield* opened,
        }).toStrictEqual({
          heard: [
            "1 Landed",
            "2 AskOpened",
            "3 Landed",
            "4 Claimed",
            "5 Released",
          ],
          opened: [0],
        });
      }).pipe(Effect.provide(doWorld)),
    15_000
  );

  it.live(
    "opens a socket the DO closed again from the last number it relayed, and hears nothing twice",
    () =>
      Effect.gen(function* () {
        const { call, namespace, opened, server } = yield* roomNamespace();

        yield* opening(call);
        yield* call("claim", [bob, doParseIso]);

        const heard = yield* hearing(relayedFrom(namespace));

        yield* heardUntil(heard, (events) => events.length >= 4);

        (yield* server)?.close(1012, "restarting");

        yield* heardUntil(heard, () => false).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("50 millis"),
            until: () => false,
            while: () => Effect.map(opened, (all) => all.length < 2),
          })
        );

        yield* call("release", [bob, doParseIso]);

        expect({
          heard: brief(
            yield* heardUntil(heard, (events) => events.length >= 5)
          ),
          opened: yield* opened,
        }).toStrictEqual({
          heard: [
            "1 Landed",
            "2 AskOpened",
            "3 Landed",
            "4 Claimed",
            "5 Released",
          ],
          opened: [0, 4],
        });
      }).pipe(Effect.provide(doWorld)),
    15_000
  );

  it.live(
    "follows the project's log when its DO will not open a socket",
    () =>
      Effect.gen(function* () {
        const { call, namespace, opened } = yield* roomNamespace(true);

        yield* opening(call);

        const heard = yield* hearing(relayedFrom(namespace));

        yield* call("claim", [bob, doParseIso]);

        expect({
          heard: brief(
            yield* heardUntil(heard, (events) => events.length >= 4)
          ),
          opened: yield* opened,
        }).toStrictEqual({
          heard: ["1 Landed", "2 AskOpened", "3 Landed", "4 Claimed"],
          opened: [],
        });
      }).pipe(Effect.provide(doWorld)),
    15_000
  );
});

describe("the Worker's watch sockets", () => {
  it("open on a Project DO stub as the PROJECT namespace gives it, without a cast", () => {
    expectTypeOf<DurableObjectNamespace>().toExtend<WatchNamespace>();
    expectTypeOf<Env["PROJECT"]>().toExtend<WatchNamespace>();
  });

  it.effect(
    "are the stage's PROJECT namespace in the Worker's ports, so watch relays each DO's socket",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);
        const ports = yield* Layer.build(workerPorts(config));

        expect(Option.getOrUndefined(Context.get(ports, ProjectSockets))).toBe(
          config.PROJECT
        );
      })
  );
});
