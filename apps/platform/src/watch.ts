// A socket's position lives in its attachment, which survives hibernation; its tag
// holds the number it opened from, for when the attachment is lost.
import type { ProjectApi } from "@repo/project/project";
import { keptEvents } from "@repo/project/project-store";
import { Projects } from "@repo/project/projects";
import { NoneOrMore } from "@repo/protocol/domain/common";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { keyOf } from "@repo/protocol/ids";
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
import { Headers, HttpServerRequest } from "effect/http";
import { RpcSerialization } from "effect/rpc";

import { decodeReply, encodeCall } from "./project-calls.ts";
import type { CallRequest, ExitEncoded } from "./project-calls.ts";
import type { ProjectShell } from "./project-shell.ts";

const EVENT_PAGE = 100;

const POLL = Duration.seconds(1);

const RECONNECT = Duration.seconds(1);

export const WATCH_TAG = "watch";

export const WATCH_PATH = "/watch";

const SINCE = "since:";

export const WatchFrame = Schema.Struct({
  event: ProjectEvent,
  seq: Schema.Int,
});

export type WatchFrame = typeof WatchFrame.Type;

const FrameText = Schema.fromJsonString(WatchFrame);

const encodeFrame = Schema.encodeEffect(FrameText);

const decodeFrame = Schema.decodeEffect(FrameText);

const SinceText = Schema.FiniteFromString.pipe(Schema.decodeTo(NoneOrMore));

const decodeSince = Schema.decodeUnknownOption(SinceText);

export const isFramed = (headers: Headers.Headers) =>
  Option.exists(Headers.get(headers, "content-type"), (type) =>
    type.startsWith(RpcSerialization.ndjson.contentType)
  );

// Never the call's own headers: the RPC server lays them over the request's, so a
// call posted as JSON could claim to be framed.
export const servedFramed = Effect.map(
  Effect.serviceOption(HttpServerRequest.HttpServerRequest),
  Option.exists((request) => isFramed(request.headers))
);

export type SocketState = Pick<
  DurableObjectState,
  "acceptWebSocket" | "getTags" | "getWebSockets"
>;

const Position = Schema.Struct({ seq: NoneOrMore });

const decodePosition = Schema.decodeUnknownOption(Position);

const openedFrom = (state: SocketState, socket: WebSocket) =>
  Option.flatMap(
    Option.fromUndefinedOr(
      state.getTags(socket).find((tag) => tag.startsWith(SINCE))
    ),
    (tag) => decodeSince(tag.slice(SINCE.length))
  );

export const watchRequest = (request: Request): Option.Option<number> => {
  const url = new URL(request.url);

  return url.pathname === WATCH_PATH &&
    request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ? decodeSince(url.searchParams.get("since") ?? "0")
    : Option.none();
};

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

export const watchRoom = (state: SocketState, shell: ProjectShell) => {
  const eventsAfter = (seq: number) =>
    encodeCall("events", [seq, keptEvents]).pipe(
      Effect.flatMap((request) => shell.call(request)),
      Effect.flatMap((reply) => decodeReply("events", reply))
    );

  const positionOf = (socket: WebSocket) =>
    Option.orElse(
      Option.map(
        decodePosition(socket.deserializeAttachment()),
        ({ seq }) => seq
      ),
      () => openedFrom(state, socket)
    );

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

  // The commit stands whatever happens here: a failed settle is logged, and the next
  // settle sends what this one could not.
  const settle = Effect.suspend(() =>
    catchUp(state.getWebSockets(WATCH_TAG))
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("the project's watchers were not caught up", cause)
    )
  );

  return {
    admit: (socket: WebSocket, since: number) =>
      Effect.suspend(() => {
        state.acceptWebSocket(socket, [WATCH_TAG, `${SINCE}${since}`]);
        socket.serializeAttachment({ seq: since });

        return catchUp([socket]);
      }),
    alarm: () => Effect.andThen(shell.alarm(), settle),
    call: (request: typeof CallRequest.Encoded): Effect.Effect<ExitEncoded> =>
      Effect.tap(shell.call(request), () => settle),
    heard: (socket: WebSocket) => catchUp([socket]),
  };
};

const reportOnly: ReadonlySet<number> = new Set([1005, 1006, 1015]);

export const closeEnd = (socket: WebSocket, code: number, reason: string) =>
  Effect.try(() => {
    socket.close(reportOnly.has(code) ? 1000 : code, reason);
  }).pipe(Effect.ignore);

interface Upgraded {
  readonly webSocket: WebSocket | null;
}

export interface WatchNamespace {
  readonly idFromName: (name: string) => DurableObjectId;
  readonly get: (id: DurableObjectId) => {
    readonly fetch: (request: Request) => Promise<Upgraded>;
  };
}

export const ProjectSockets = Context.Reference<Option.Option<WatchNamespace>>(
  "platform/ProjectSockets",
  { defaultValue: Option.none }
);

class SocketRefused extends Data.TaggedError("SocketRefused")<{
  readonly cause: unknown;
}> {}

class SocketLost extends Data.TaggedError("SocketLost")<{
  readonly reason: string;
}> {}

const socketFrames = (
  namespace: WatchNamespace,
  project: ProjectName,
  since: number
) =>
  Stream.callback<string, SocketRefused | SocketLost>((queue) =>
    Effect.gen(function* () {
      const stub = namespace.get(namespace.idFromName(keyOf(project)));

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
      Effect.catchTag("SocketRefused", (refused) => Queue.fail(queue, refused))
    )
  ).pipe(Stream.mapEffect((text) => Effect.orDie(decodeFrame(text))));

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

const replayed = (api: ProjectApi, since: number) =>
  Stream.paginate(since, (after) =>
    Effect.map(api.events(after, EVENT_PAGE), (rows) => [
      rows,
      rows.length < EVENT_PAGE
        ? Option.none()
        : Option.fromUndefinedOr(rows.at(-1)?.seq),
    ])
  );

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
