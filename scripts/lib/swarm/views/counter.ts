/**
 * The herdr view's counter: claims, pushes and landings in the swarm's
 * project as they happen, for the video's live tally (SYN §7.3, beat
 * 2:15–3:45). It follows the project's public `watch`, so it counts what
 * the platform recorded, never what a pane printed.
 *
 * `watch` streams over the platform's framed `/rpc` (NDJSON, issue 510).
 * The swarm's scripts reach the network only through processes (their
 * allow-list grants `effect/process`), so `curl` carries the call, as the
 * swarm's other steps run git, the CLI and herdr. A run counts from the last
 * event the project already holds (`lastHeld`), appends one line to the
 * counter file per claim, push and landing, and follows again from the
 * last event it heard whenever the stream ends (a held stream does end:
 * Bun's `fetch` at 361 s, spec §7.4).
 */
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

/** The events the counter counts. */
const counted = (event: ProjectEvent) =>
  ProjectEvent.guards.Claimed(event) ||
  ProjectEvent.guards.Pushed(event) ||
  ProjectEvent.guards.Landed(event);

/** The counter's line for `events`: `claims 6 · pushes 9 · landed 4`. Pure. */
export const counterLine = (events: readonly ProjectEvent[]): string => {
  const claims = events.filter(ProjectEvent.guards.Claimed).length;
  const pushes = events.filter(ProjectEvent.guards.Pushed).length;
  const landings = events.filter(ProjectEvent.guards.Landed).length;

  return `claims ${claims} · pushes ${pushes} · landed ${landings}`;
};

const short = (sha: string) => sha.slice(0, 7);

/** What one counted event says, in a few words; the others say nothing. */
const happening = (event: ProjectEvent) =>
  ProjectEvent.match(event, {
    AskClosed: () => "",
    AskOpened: () => "",
    Claimed: ({ ask, claimant }) => `${claimant} claimed ${ask}`,
    Decided: () => "",
    Judged: () => "",
    Landed: ({ landing }) =>
      `${landing.ask ?? "main"} landed as ${short(landing.sha)}`,
    Lapsed: () => "",
    LedgerAppended: () => "",
    ProposalOpened: () => "",
    Pushed: ({ ask, head }) => `${ask} pushed ${short(head)}`,
    Released: () => "",
    Warned: () => "",
  });

/**
 * The counter file's line for `event`, the last of `events`: when it
 * happened (UTC), the tally so far, and what happened. Pure.
 */
export const counterEntry = (
  events: readonly ProjectEvent[],
  event: ProjectEvent
) =>
  `${DateTime.formatIso(event.at).slice(11, 19)}  ${counterLine(events)}  ${happening(event)}`;

/** One call as effect/rpc's protocol frames it (as `infra/smoke.ts` sends one). */
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

/** `watch` for `project`, after event `since` when given one, as JSON. */
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

/** A frame of a stream's values, as the platform's `/rpc` sends one. */
const ChunkOf = <S extends Schema.Top>(value: S) =>
  Schema.TaggedStruct("Chunk", { values: Schema.Array(value) });

/** A frame of events, read only for where each stands in the project's sequence. */
const Held = ChunkOf(Schema.Struct({ seq: Schema.Int }));

const isHeld = Schema.is(Held);

/** What `watch` answers over plain JSON: every frame at once (any other is its exit). */
const decodeReplay = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(Schema.Union([Held, Schema.Struct({ _tag: Schema.String })]))
  )
);

/** One line of the framed stream, when it is a frame of values. */
const decodeLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(ChunkOf(Schema.Unknown))
);

const eventOf = Schema.decodeUnknownOption(ProjectEvent);

/**
 * The events one line of the stream carries. A line that is no chunk (the
 * stream's exit) carries none, and an event this build cannot read is
 * skipped.
 */
export const eventsIn = (line: string): readonly ProjectEvent[] =>
  Option.match(decodeLine(line), {
    onNone: () => [],
    onSome: ({ values }) =>
      Array.getSomes(values.map((value) => eventOf(value))),
  });

/**
 * `curl`'s flags for one POST to the platform's `/rpc` with `contentType`:
 * an HTTP error fails it (`--fail`), and only its errors reach stderr.
 */
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

/** Why the counter can't say where `project` stands: what curl or the platform said. */
const unread = (project: ProjectName, said: string) =>
  new SwarmFailed({
    reason: `the counter couldn't read ${project}'s events: ${said.trim().slice(0, 300)}`,
  });

/**
 * The last event `project` already holds, where a run's counter starts:
 * `watch` over plain JSON replays what the project keeps and ends; 0 when
 * it holds none. A read that fails is the run's failure, not 0: a counter
 * that started from 0 would count the project's whole history as the run's.
 */
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

/** Where the counter stands: the last event heard, and every counted one since the run began. */
interface Tally {
  readonly last: number;
  readonly events: readonly ProjectEvent[];
}

/** How long the counter waits before it follows `watch` again. */
const FOLLOW_AGAIN = Duration.seconds(2);

/**
 * Follows `project`'s `watch` at `origin` after event `from` (`lastHeld`,
 * read before the run claims anything), appending a line to `file` for
 * every claim, push and landing; it never ends on its own (interrupt it
 * when the run is over).
 */
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
