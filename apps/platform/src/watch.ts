import type { ProjectApi } from "@repo/project/project";
/**
 * `watch` live (spec §3.4, issue 510): a project's events, replayed from a
 * sequence number and then heard as they are committed.
 *
 * The Project DO keeps the newest 500 events (`keptEvents`) and one
 * hibernating WebSocket per watcher (`watchRoom`): it accepts a socket
 * opened at `/watch?since=n`, sends it every kept event after `n`, and after
 * each call and alarm (the settle step that follows the store's commit,
 * ADR 0012) sends every socket what it has not been sent yet. Where each
 * socket stands lives in its attachment, so it survives hibernation; the
 * number it opened from is its tag, read when the attachment is missing.
 *
 * The Worker's `watch` handler (`watchHandler`) relays that socket to the
 * caller over `/rpc`, frame by frame, for as long as the caller stays, and
 * opens it again from the last number it relayed when it is lost, so a
 * watcher hears each event once, in order. Where no socket can be opened
 * (no `PROJECT` namespace, as in process, or a DO that does not upgrade),
 * it follows the project's event log by asking for what is new each
 * second instead: the stream stays the same.
 *
 * A live tail needs a framed transport: over `/rpc` with JSON the whole
 * answer is sent when the call ends, so there `watch` replays what is kept
 * and ends, as it always has.
 */
import { keptEvents } from "@repo/project/project-store";
import { Projects } from "@repo/project/projects";
import { NoneOrMore } from "@repo/protocol/domain/common";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectName } from "@repo/protocol/ids";
import type { UnknownProject } from "@repo/protocol/refusal";
import {
  Cause,
  Context,
  Data,
  Duration,
  Effect,
  Option,
  Predicate,
  Queue,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { Headers } from "effect/http";
import { RpcSerialization } from "effect/rpc";

import { decodeReply, encodeCall } from "./project-calls.ts";
import type { CallRequest, ExitEncoded } from "./project-calls.ts";
import type { ProjectShell } from "./project-shell.ts";

/** How many events `watch` reads from a project's log at a time. */
const EVENT_PAGE = 100;

/** How long a watcher with no socket waits before it asks the log for what is new. */
const POLL = Duration.seconds(1);

/** How long the relay waits before it opens a lost socket again. */
const RECONNECT = Duration.seconds(1);

/** The tag every watch socket a Project DO accepts carries. */
export const WATCH_TAG = "watch";

/** Where the Worker opens a project's watch socket on its DO. */
export const WATCH_PATH = "/watch";

/** How the tag that keeps the number a socket opened from begins. */
const SINCE = "since:";

/** One frame on a watch socket: an event and its place in the project's sequence. */
export const WatchFrame = Schema.Struct({
  event: ProjectEvent,
  seq: Schema.Int,
});

export type WatchFrame = typeof WatchFrame.Type;

const FrameText = Schema.fromJsonString(WatchFrame);

const encodeFrame = Schema.encodeEffect(FrameText);

const decodeFrame = Schema.decodeEffect(FrameText);

/** A sequence number as a URL or a tag carries it. */
const SinceText = Schema.FiniteFromString.pipe(Schema.decodeTo(NoneOrMore));

const decodeSince = Schema.decodeUnknownOption(SinceText);

/**
 * Whether a call came over a framed transport (NDJSON), which sends each
 * message as it is ready, so a stream can stay open: the RPC server puts
 * the HTTP request's headers on every call it carries.
 */
export const isFramed = (headers: Headers.Headers) =>
  Option.exists(Headers.get(headers, "content-type"), (type) =>
    type.startsWith(RpcSerialization.ndjson.contentType)
  );

// --- The Project DO's side ---------------------------------------------------

/** What the watch room uses of a Project DO's state: the hibernating sockets it accepts and finds again. */
export type SocketState = Pick<
  DurableObjectState,
  "acceptWebSocket" | "getTags" | "getWebSockets"
>;

/** Where a watch socket stands: the last number it was sent. */
const Position = Schema.Struct({ seq: NoneOrMore });

const decodePosition = Schema.decodeUnknownOption(Position);

/** The number a socket opened from, as its tag keeps it. */
const openedFrom = (state: SocketState, socket: WebSocket) =>
  Option.flatMap(
    Option.fromUndefinedOr(
      state.getTags(socket).find((tag) => tag.startsWith(SINCE))
    ),
    (tag) => decodeSince(tag.slice(SINCE.length))
  );

/**
 * The number a watch request opens from: `since` on `/watch`, a whole
 * number, with the WebSocket upgrade; none for any other request.
 */
export const watchRequest = (request: Request): Option.Option<number> => {
  const url = new URL(request.url);

  return url.pathname === WATCH_PATH &&
    request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ? decodeSince(url.searchParams.get("since") ?? "0")
    : Option.none();
};

/**
 * Sends `socket` each of `frames` in order, moving its attachment on with
 * each; stops at the first it cannot send.
 */
const send = (socket: WebSocket, frames: readonly WatchFrame[]) =>
  Effect.forEach(
    frames,
    (frame) =>
      Effect.gen(function* () {
        const text = yield* Effect.orDie(encodeFrame(frame));

        yield* Effect.try(() => {
          socket.send(text);
          socket.serializeAttachment({ seq: frame.seq });
        });
      }),
    { discard: true }
  ).pipe(Effect.ignore);

/**
 * A Project DO's shell with its watchers. Each call and alarm runs on the
 * shell as before, then settles the sockets: each is sent the kept events
 * after where it stands, in order, and its attachment moves to the last.
 * A socket that can no longer be sent to is left as it stands; the runtime
 * drops it once it has closed.
 */
export const watchRoom = (state: SocketState, shell: ProjectShell) => {
  /** The kept events after `seq`, oldest first. */
  const eventsAfter = (seq: number) =>
    encodeCall("events", [seq, keptEvents]).pipe(
      Effect.flatMap((request) => shell.call(request)),
      Effect.flatMap((reply) => decodeReply("events", reply))
    );

  /** Where `socket` stands; none for a socket that is not a watcher's. */
  const positionOf = (socket: WebSocket) =>
    Option.orElse(
      Option.map(
        decodePosition(socket.deserializeAttachment()),
        ({ seq }) => seq
      ),
      () => openedFrom(state, socket)
    );

  /** Sends each of `sockets` the kept events after where it stands. */
  const catchUp = (sockets: readonly WebSocket[]) =>
    Effect.gen(function* () {
      const standing = sockets.flatMap((socket) =>
        Option.match(positionOf(socket), {
          onNone: () => [],
          onSome: (seq) => [{ seq, socket }],
        })
      );

      if (standing.length === 0) {
        return;
      }

      const rows = yield* eventsAfter(
        Math.min(...standing.map(({ seq }) => seq))
      );

      yield* Effect.forEach(
        standing,
        ({ seq, socket }) =>
          send(
            socket,
            rows.filter((row) => row.seq > seq)
          ),
        { discard: true }
      );
    });

  /**
   * Every watcher, caught up: the settle step after a commit. The commit
   * stands whatever happens here, so a settle that fails is logged and the
   * call still answers what it did; the next settle sends what this one
   * could not.
   */
  const settle = Effect.suspend(() =>
    catchUp(state.getWebSockets(WATCH_TAG))
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("the project's watchers were not caught up", cause)
    )
  );

  return {
    /** A new watcher's socket, from `since`: accepted to hibernate, then sent every kept event after it. */
    admit: (socket: WebSocket, since: number) =>
      Effect.suspend(() => {
        state.acceptWebSocket(socket, [WATCH_TAG, `${SINCE}${since}`]);
        socket.serializeAttachment({ seq: since });

        return catchUp([socket]);
      }),
    alarm: () => Effect.andThen(shell.alarm(), settle),
    call: (request: typeof CallRequest.Encoded): Effect.Effect<ExitEncoded> =>
      Effect.tap(shell.call(request), () => settle),
    /** A watcher spoke: it is sent whatever it has not been sent yet. */
    heard: (socket: WebSocket) => catchUp([socket]),
  };
};

/** Close codes a socket may not send itself: they only report how a close happened. */
const reportOnly: ReadonlySet<number> = new Set([1005, 1006, 1015]);

/** A watcher closed its socket: the DO closes its end with the same code, if it may send it. */
export const closeEnd = (socket: WebSocket, code: number, reason: string) =>
  Effect.try(() => {
    socket.close(reportOnly.has(code) ? 1000 : code, reason);
  }).pipe(Effect.ignore);

// --- The Worker's side --------------------------------------------------------

/** A project DO's answer to a watch upgrade, as far as the relay reads it. */
interface Upgraded {
  readonly webSocket: WebSocket | null;
}

/** The `PROJECT` namespace as the relay reaches it: a stub's fetch opens the DO's watch socket. */
export interface WatchNamespace {
  readonly idFromName: (name: string) => DurableObjectId;
  readonly get: (id: DurableObjectId) => {
    readonly fetch: (request: Request) => Promise<Upgraded>;
  };
}

/**
 * Where the relay opens a project's watch socket: the Worker's `PROJECT`
 * namespace. None by default, as in process, where `watch` follows the
 * project's event log instead.
 */
export const ProjectSockets = Context.Reference<Option.Option<WatchNamespace>>(
  "platform/ProjectSockets",
  { defaultValue: Option.none }
);

/** The DO would not open a watch socket. */
class SocketRefused extends Data.TaggedError("SocketRefused")<{
  readonly cause: unknown;
}> {}

/** An open watch socket failed. */
class SocketLost extends Data.TaggedError("SocketLost")<{
  readonly reason: string;
}> {}

/**
 * One watch socket on `project`'s DO from `since`: each frame it carries,
 * decoded, until it closes. The socket is closed when the stream ends.
 */
const socketFrames = (
  namespace: WatchNamespace,
  project: ProjectName,
  since: number
) =>
  Stream.callback<string, SocketRefused | SocketLost>((queue) =>
    Effect.gen(function* () {
      const stub = namespace.get(namespace.idFromName(project));

      const answer = yield* Effect.tryPromise({
        catch: (cause) => new SocketRefused({ cause }),
        try: () =>
          stub.fetch(
            new Request(`https://project${WATCH_PATH}?since=${since}`, {
              headers: { upgrade: "websocket" },
            })
          ),
      });

      const webSocket = yield* Effect.fromNullishOr(answer.webSocket).pipe(
        Effect.mapError(
          () => new SocketRefused({ cause: "no socket in the answer" })
        )
      );

      webSocket.accept();
      webSocket.addEventListener("message", ({ data }) => {
        // The DO sends text frames only.
        if (Predicate.isString(data)) {
          Queue.offerUnsafe(queue, data);
        }
      });
      webSocket.addEventListener("close", () => {
        Queue.endUnsafe(queue);
      });
      webSocket.addEventListener("error", ({ message }) => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(new SocketLost({ reason: message }))
        );
      });

      yield* Effect.addFinalizer(() =>
        Effect.ignore(
          Effect.try(() => {
            webSocket.close(1000, "watcher gone");
          })
        )
      );
    }).pipe(
      // The callback runs beside the stream: its own failure ends the stream through the queue.
      Effect.catchTag("SocketRefused", (refused) => Queue.fail(queue, refused))
    )
  ).pipe(Stream.mapEffect((text) => Effect.orDie(decodeFrame(text))));

/**
 * The project's events after `since`, a page at a time, then what is new
 * each `POLL`, for as long as the stream runs.
 */
const polled = (api: ProjectApi, since: number) =>
  Stream.paginate({ after: since, caughtUp: false }, ({ after, caughtUp }) =>
    Effect.gen(function* () {
      if (caughtUp) {
        yield* Effect.sleep(POLL);
      }

      const rows = yield* api.events(after, EVENT_PAGE);

      return [
        rows,
        Option.some({
          after: rows.at(-1)?.seq ?? after,
          caughtUp: rows.length < EVENT_PAGE,
        }),
      ] as const;
    })
  );

/** The project's kept events after `since`, a page at a time, then the end. */
const replayed = (api: ProjectApi, since: number) =>
  Stream.paginate(since, (after) =>
    Effect.map(api.events(after, EVENT_PAGE), (rows) => [
      rows,
      rows.length < EVENT_PAGE
        ? Option.none()
        : Option.fromUndefinedOr(rows.at(-1)?.seq),
    ])
  );

/**
 * The DO's watch socket, relayed: every frame after the last one relayed,
 * once, in order. A socket lost is opened again from the last number
 * relayed; a DO that will not open one is followed by its log instead.
 */
const relayed = (
  namespace: WatchNamespace,
  api: ProjectApi,
  project: ProjectName,
  since: number
) =>
  Stream.unwrap(
    Effect.map(Ref.make(since), (last) => {
      const fresh = (frame: WatchFrame) =>
        Ref.modify(last, (seen) =>
          frame.seq > seen ? [true, frame.seq] : [false, seen]
        );

      const fromLast = <A, E>(open: (from: number) => Stream.Stream<A, E>) =>
        Stream.unwrap(Effect.map(Ref.get(last), open));

      return fromLast((from) => socketFrames(namespace, project, from)).pipe(
        Stream.filterEffect(fresh),
        Stream.catchTag("SocketLost", () => Stream.empty),
        Stream.repeat(Schedule.spaced(RECONNECT)),
        Stream.catchTag("SocketRefused", () =>
          fromLast((from) => polled(api, from))
        )
      );
    })
  );

/**
 * The `watch` contract's handler: `project`'s events after `since` (from
 * the start when none, or when it is less than none). Over a framed
 * transport they keep coming until the caller goes away; over a buffered
 * one the stream ends after the kept events.
 */
export const watchHandler = (
  payload: { readonly project: ProjectName; readonly since?: number },
  transport: { readonly live: boolean }
): Stream.Stream<ProjectEvent, UnknownProject, Projects> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const api = yield* (yield* Projects).get(payload.project);
      const since = Math.max(0, payload.since ?? 0);

      if (!transport.live) {
        return replayed(api, since);
      }

      return Option.match(yield* ProjectSockets, {
        onNone: () => polled(api, since),
        onSome: (namespace) => relayed(namespace, api, payload.project, since),
      });
    })
  ).pipe(Stream.map(({ event }) => event));
