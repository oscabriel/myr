// The scripts reach the network only through processes (their allow-list grants
// `effect/process`), so `curl` carries the call. A held stream does end (Bun's
// `fetch` at 361 s), so the counter follows again from the last event it heard.
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectName } from "@repo/protocol/ids";
import {
  Array,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { run, SwarmFailed } from "../workspace.ts";

const counted = (event: ProjectEvent) =>
  ProjectEvent.guards.Claimed(event) ||
  ProjectEvent.guards.Pushed(event) ||
  ProjectEvent.guards.Landed(event);

export const counterLine = (events: readonly ProjectEvent[]): string => {
  const claims = events.filter(ProjectEvent.guards.Claimed).length;
  const pushes = events.filter(ProjectEvent.guards.Pushed).length;
  const landings = events.filter(ProjectEvent.guards.Landed).length;

  return `claims ${claims} · pushes ${pushes} · landed ${landings}`;
};

const short = (sha: string) => sha.slice(0, 7);

const happening = (event: ProjectEvent) =>
  ProjectEvent.match(event, {
    AskClosed: () => "",
    AskOpened: () => "",
    Claimed: ({ ask, claimant }) => `${claimant} claimed ${ask}`,
    Decided: () => "",
    DiscussionPosted: () => "",
    Judged: () => "",
    Landed: ({ landing }) =>
      `${landing.ask ?? "main"} landed as ${short(landing.sha)}`,
    Lapsed: () => "",
    LedgerAppended: () => "",
    Pushed: ({ ask, head }) => `${ask} pushed ${short(head)}`,
    Released: () => "",
    Warned: () => "",
  });

export const counterEntry = (
  events: readonly ProjectEvent[],
  event: ProjectEvent
) =>
  `${DateTime.formatIso(event.at).slice(11, 19)}  ${counterLine(events)}  ${happening(event)}`;

const WatchCall = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({
    project: Schema.String,
    since: Schema.optionalKey(Schema.Int),
  }),
  tag: Schema.Literal("watch"),
});

const encodeCall = Schema.encodeSync(Schema.fromJsonString(WatchCall));

const watchRequest = (project: ProjectName, since: Option.Option<number>) =>
  encodeCall(
    WatchCall.make({
      headers: [],
      id: "1",
      payload: Option.match(since, {
        onNone: () => ({ project }),
        onSome: (after) => ({ project, since: after }),
      }),
      tag: "watch",
    })
  );

const ChunkOf = <S extends Schema.Top>(value: S) =>
  Schema.TaggedStruct("Chunk", { values: Schema.Array(value) });

const Held = ChunkOf(Schema.Struct({ seq: Schema.Int }));

const isHeld = Schema.is(Held);

const decodeReplay = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(Schema.Union([Held, Schema.Struct({ _tag: Schema.String })]))
  )
);

const decodeLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(ChunkOf(Schema.Unknown))
);

const eventOf = Schema.decodeUnknownOption(ProjectEvent);

export const eventsIn = (line: string): readonly ProjectEvent[] =>
  Option.match(decodeLine(line), {
    onNone: () => [],
    onSome: ({ values }) =>
      Array.getSomes(values.map((value) => eventOf(value))),
  });

const curlArgs = (input: {
  readonly origin: string;
  readonly contentType: string;
  readonly body: string;
}) => [
  "--silent",
  "--show-error",
  "--fail",
  "--no-buffer",
  "--request",
  "POST",
  "--header",
  `content-type: ${input.contentType}`,
  "--data-binary",
  input.body,
  `${input.origin}/rpc`,
];

const unread = (project: ProjectName, said: string) =>
  new SwarmFailed({
    reason: `the counter couldn't read ${project}'s events: ${said.trim().slice(0, 300)}`,
  });

// A read that fails is the run's failure, not 0: a counter that started from 0
// would count the project's whole history as the run's.
export const lastHeld = (origin: string, project: ProjectName) =>
  Effect.gen(function* () {
    const ran = yield* run({
      args: curlArgs({
        body: `[${watchRequest(project, Option.none())}]`,
        contentType: "application/json",
        origin,
      }),
      command: "curl",
      env: {},
    }).pipe(Effect.mapError(({ reason }) => unread(project, reason)));

    if (ran.code !== 0) {
      return yield* unread(project, `curl exited ${ran.code}: ${ran.stderr}`);
    }

    const frames = yield* Effect.fromOption(decodeReplay(ran.stdout)).pipe(
      Effect.mapError(() => unread(project, ran.stdout))
    );

    return Math.max(
      0,
      ...frames.flatMap((frame) =>
        isHeld(frame) ? frame.values.map(({ seq }) => seq) : []
      )
    );
  });

interface Tally {
  readonly last: number;
  readonly events: readonly ProjectEvent[];
}

const FOLLOW_AGAIN = Duration.seconds(2);

// Never ends on its own: interrupt it when the run is over.
export const followCounter = (input: {
  readonly origin: string;
  readonly project: ProjectName;
  readonly file: string;
  readonly from: number;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const tally = yield* Ref.make<Tally>({ events: [], last: input.from });
    const said = yield* Ref.make(false);

    const append = (line: string) =>
      fs.writeFileString(input.file, `${line}\n`, { flag: "a" });

    const hear = (event: ProjectEvent) =>
      Effect.gen(function* () {
        const before = yield* Ref.get(tally);

        if (event.seq <= before.last) {
          return;
        }

        const events = counted(event)
          ? [...before.events, event]
          : before.events;

        yield* Ref.set(tally, { events, last: event.seq });

        if (counted(event)) {
          yield* append(counterEntry(events, event));
        }
      });

    const followOnce = Effect.scoped(
      Effect.gen(function* () {
        const { last } = yield* Ref.get(tally);

        const child = yield* spawner.spawn(
          ChildProcess.make(
            "curl",
            curlArgs({
              body: `${watchRequest(input.project, Option.some(last))}\n`,
              contentType: "application/ndjson",
              origin: input.origin,
            }),
            { stdin: "ignore" }
          )
        );

        // curl's exit says whether the stream ended or the call failed.
        const [stderr, code] = yield* Effect.all(
          [
            child.stderr.pipe(Stream.decodeText(), Stream.mkString),
            child.exitCode,
            child.stdout.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.flatMap((line) => Stream.fromIterable(eventsIn(line))),
              Stream.runForEach(hear)
            ),
          ],
          { concurrency: "unbounded" }
        );

        yield* Effect.when(
          Effect.fail(
            new SwarmFailed({ reason: `curl exited ${code}: ${stderr.trim()}` })
          ),
          Effect.succeed(code !== 0)
        );
      })
    ).pipe(
      // Said once, so a counter that cannot follow says why; it keeps trying.
      Effect.tapError(({ message }) =>
        Effect.gen(function* () {
          if (!(yield* Ref.getAndSet(said, true))) {
            yield* append(`counter: watch didn't run: ${message}`);
          }
        })
      ),
      Effect.ignore
    );

    yield* append(
      `${counterLine([])}  (${input.project}, after event ${input.from})`
    );

    return yield* followOnce.pipe(
      Effect.repeat(Schedule.spaced(FOLLOW_AGAIN)),
      Effect.andThen(Effect.never)
    );
  });
