/**
 * The dev world's fixtures: the states a page draws that the default world
 * never reaches, served through the same contracts, beside datekit and
 * burrow. Off unless the dev server is started with the switch:
 *
 *     VITE_DEV_FIXTURES=1 bun run --cwd apps/web dev     # the fixtures
 *     VITE_DEV_FIXTURES=live bun run --cwd apps/web dev  # and the live landing
 *
 * The switch is a `VITE_` variable because the dev world runs in the
 * Worker's runtime, which sees no other variable of the shell that started
 * Vite; Vite writes `VITE_` ones into the modules it serves.
 *
 * With the switch on the world holds, beside the default two:
 *
 * - six small projects made through the project service, as the seed makes
 *   datekit (`fixtures/fillers.ts`), so the project list runs past eight,
 *   one of them with no open asks;
 * - `vellum`, whose record is told as a story (`fixtures/vellum.ts`). Its
 *   repo and policy are real: the service made the project and took its
 *   first push, and every landing is a commit on its `main`. What the
 *   service cannot reach in a world with no visibility cartridge (a ledger
 *   with layers, sealed areas, an env item someone set, a refusal at Shape
 *   kept as a verdict, a finish put to a decider) is in the record, which
 *   answers vellum's reads in place of the service's own: its asks,
 *   events, verdicts, landings, decisions and Today, ledger, env shape,
 *   proposals, claims and forks. Writes other than a decision reach the
 *   service underneath, which holds none of the record's asks.
 *
 * In live mode the lint child of vellum's first family, checking since the
 * morning, lands `LIVE_AFTER` after the world first answers vellum's
 * `watch`: on the first read of vellum after that, as the dev world's pages
 * poll, so a page left open sees one more landing arrive.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import { envSchemaMethod } from "@repo/project/deciders";
import type { ProjectApi } from "@repo/project/project";
import { ProjectedEvent } from "@repo/project/projection";
import { Projects } from "@repo/project/projects";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ProjectName } from "@repo/protocol/ids";
import { sameHandle } from "@repo/protocol/ids";
import { Principal } from "@repo/protocol/principal";
import type { Person } from "@repo/protocol/principal";
import {
  NotDecider,
  UnknownAsk,
  UnknownCommit,
  UnknownProject,
  UnknownProposal,
} from "@repo/protocol/refusal";
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
} from "effect";

import { DevClock } from "./clock.ts";
import { seedFillers } from "./fixtures/fillers.ts";
import {
  creditsIn,
  decisionTaken,
  decodeRecord,
  landingIn,
  lastSeqOf,
  listedOf,
  statusIn,
  todayIn,
  verdictIn,
} from "./fixtures/record.ts";
import type { FixtureRecord } from "./fixtures/record.ts";
import type { Story } from "./fixtures/story.ts";
import {
  decisionsPerDay,
  fixturesNow,
  landLintChild,
  tellVellum,
  vellum,
  vellumFiles,
  vellumInitializer,
  vellumStart,
} from "./fixtures/vellum.ts";
import { DevProjected } from "./projection.ts";
import { seedDev, startedAt } from "./seed.ts";
import { devWorldWith } from "./world.ts";

/** Off, on, or on with the live landing. */
export type FixtureMode = "off" | "on" | "live";

const Switch = Schema.Literals(["1", "on", "live"]);

/** The switch, read once from where Vite puts it. */
export const fixturesMode: FixtureMode = Option.match(
  Schema.decodeUnknownOption(Switch)(import.meta.env.VITE_DEV_FIXTURES),
  {
    onNone: (): FixtureMode => "off",
    onSome: (on): FixtureMode => (on === "live" ? "live" : "on"),
  }
);

/** Whether the dev world adds the fixtures. */
export const fixturesOn = fixturesMode !== "off";

/** How long after vellum's `watch` is first answered its lint child lands, in live mode. */
export const LIVE_AFTER = Duration.seconds(20);

/** vellum's story, and the record it has told so far, decoded. */
interface Told {
  readonly record: FixtureRecord;
  readonly story: Story;
  readonly told: () => FixtureRecord;
}

/** The fixtures' state in one world: vellum's story once told, and the live landing's clock. */
export class Fixtures extends Context.Service<
  Fixtures,
  {
    readonly told: Ref.Ref<Option.Option<Told>>;
    /** How long after the first `watch` the live landing waits; none, no live landing. */
    readonly liveAfter: Option.Option<Duration.Duration>;
    /** When vellum's `watch` was first answered, by the monotonic clock. */
    readonly armedAt: Ref.Ref<Option.Option<bigint>>;
    readonly landed: Ref.Ref<boolean>;
    /** One write to the story at a time. */
    readonly lock: Semaphore.Semaphore;
  }
>()("web/dev/Fixtures") {}

const fixturesLayer = (liveAfter: Option.Option<Duration.Duration>) =>
  Layer.effect(
    Fixtures,
    Effect.gen(function* () {
      return Fixtures.of({
        armedAt: yield* Ref.make(Option.none<bigint>()),
        landed: yield* Ref.make(false),
        liveAfter,
        lock: yield* Semaphore.make(1),
        told: yield* Ref.make(Option.none<Told>()),
      });
    })
  );

/** The person calling, when someone signed in is. */
const callerOf = (principal: Principal) =>
  Principal.match(principal, {
    Anonymous: () => Option.none<Person>(),
    Person: (person) => Option.some(person),
  });

/** Whether `project` is one whose reads the fixtures answer. */
const isFixture = (project: ProjectName) => project === vellum;

/** The ask as an answerer reads it first, in Markdown. */
const briefOf = (ask: Ask): string =>
  [
    `# ${ask.brief.want}`,
    "",
    `Ask \`${ask.id}\` in ${ask.project}, a \`${ask.kind}\` ask from ${ask.askedBy}.`,
    "",
    "## Territory",
    "",
    ask.territory.module === "."
      ? `The paths ${ask.territory.paths.map((path) => `\`${path}\``).join(", ")}.`
      : `The module \`${ask.territory.module}\`: ${ask.territory.paths.map((path) => `\`${path}\``).join(", ")}.`,
    ...(ask.brief.current === undefined
      ? []
      : ["", "## Current", "", ask.brief.current]),
    "",
  ].join("\n");

/**
 * vellum's reads answered from its record, everything else by the service
 * underneath; and the projection's events with vellum's from the record.
 */
const overlay: Layer.Layer<
  Projects | DevProjected,
  never,
  Projects | DevProjected | Fixtures | RepoHost | DevClock
> = Layer.effectContext(
  Effect.gen(function* () {
    const projects = yield* Projects;
    const projected = yield* DevProjected;
    const fixtures = yield* Fixtures;
    const host = yield* RepoHost;
    const devClock = yield* DevClock;
    const clock = yield* Clock.Clock;

    const now = Effect.sync(() =>
      DateTime.toUtc(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()))
    );

    const provided = <A, E>(effect: Effect.Effect<A, E, RepoHost | DevClock>) =>
      effect.pipe(
        Effect.provideService(RepoHost, host),
        Effect.provideService(DevClock, devClock)
      );

    /** The record's latest, once told. */
    const current = Effect.flatMap(Ref.get(fixtures.told), (told) =>
      Option.match(told, {
        onNone: () => Effect.die("vellum's story is not told yet"),
        onSome: ({ record }) => Effect.succeed(record),
      })
    );

    /** A write to the story, under the lock, and the record told again. */
    const write = <A, E>(
      step: (story: Story) => Effect.Effect<A, E, RepoHost | DevClock>
    ) =>
      fixtures.lock.withPermits(1)(
        Effect.gen(function* () {
          const told = yield* Effect.flatMap(
            Ref.get(fixtures.told),
            Effect.fromOption
          ).pipe(Effect.orDie);

          const out = yield* provided(step(told.story));
          const record = yield* decodeRecord(told.told());

          yield* Ref.set(fixtures.told, Option.some({ ...told, record }));

          return out;
        })
      );

    /**
     * vellum's `watch` was read from `since`: the first read arms the live
     * landing, and a read once it is due lands the lint child first. Only a
     * read's start counts (from the first event, or from the last one, as a
     * page that follows the stream asks); a later page of the same replay
     * never lands it in the middle of the replay.
     */
    const heard = (since: number) =>
      Option.match(fixtures.liveAfter, {
        onNone: () => Effect.void,
        onSome: (after) =>
          Effect.gen(function* () {
            const record = yield* current;

            if (since !== 0 && since < lastSeqOf(record)) {
              return;
            }

            const at = yield* Clock.monotonicTimeNanos;

            // The read before this one armed it, or this read arms it.
            const armed = yield* Ref.modify(
              fixtures.armedAt,
              (was): readonly [Option.Option<bigint>, Option.Option<bigint>] =>
                Option.isSome(was)
                  ? [was, was]
                  : [Option.none(), Option.some(at)]
            );

            if (Option.isNone(armed) || (yield* Ref.get(fixtures.landed))) {
              return;
            }

            const waited = Duration.nanos(at - armed.value);

            if (Duration.isLessThan(waited, after)) {
              return;
            }

            yield* Ref.set(fixtures.landed, true);
            yield* write((story) =>
              Effect.gen(function* () {
                const landedAt = DateTime.add(yield* now, { minutes: 1 });

                yield* devClock.set(landedAt);

                return yield* landLintChild(story, landedAt);
              })
            );
          }).pipe(Effect.provideService(Clock.Clock, clock)),
      });

    const overlaid = (api: ProjectApi): ProjectApi => ({
      ...api,
      credits: (_caller, handle) =>
        Effect.map(current, (record) => ({
          credits: creditsIn(record, handle),
        })),
      decide: (caller, input) =>
        write((story) =>
          Effect.gen(function* () {
            const decision = yield* decisionTaken(yield* current, {
              ...input,
              now: yield* now,
              who: caller.handle,
            });

            if (decision.decided !== undefined) {
              story.decide(decision.id, decision.decided);
            }

            return { decision };
          })
        ),
      [envSchemaMethod]: () => Effect.map(current, ({ env }) => env),
      events: (since, limit) =>
        Effect.andThen(
          heard(since),
          Effect.map(current, ({ events }) =>
            events
              .filter(({ seq }) => seq > since)
              .slice(0, limit)
              .map((event) => ({ event, seq: event.seq }))
          )
        ),
      evidence: (caller, ref) =>
        Effect.gen(function* () {
          const record = yield* current;
          const log = record.logs.get(ref);
          const who = callerOf(caller);

          const allowed = Option.exists(who, ({ handle }) =>
            log === undefined
              ? false
              : sameHandle(log.claimant, handle) ||
                record.decisions.some(({ deciders }) =>
                  deciders.some((each) => sameHandle(each, handle))
                )
          );

          if (log === undefined) {
            return yield* new UnknownProject({ project: vellum });
          }

          if (!allowed) {
            return yield* new NotDecider({});
          }

          return { lane: log.lane, text: log.text, truncated: false };
        }),
      forks: () => Effect.map(current, ({ forks }) => forks),
      head: () => Effect.map(current, ({ head }) => ({ landed: head })),
      landing: (_caller, sha) =>
        Effect.flatMap(current, (record) =>
          Option.match(landingIn(record, sha), {
            onNone: () => Effect.fail(new UnknownCommit({ sha })),
            onSome: (landing) => Effect.succeed({ landing }),
          })
        ),
      landings: (shas) =>
        Effect.map(current, ({ landings }) =>
          shas.flatMap((sha) =>
            landings.filter((landing) => landing.sha === sha).slice(0, 1)
          )
        ),
      ledger: () => Effect.map(current, ({ ledger }) => ledger),
      listAsks: () =>
        Effect.map(current, (record) => ({ asks: listedOf(record) })),
      policy: () =>
        Effect.flatMap(current, ({ head }) =>
          Effect.map(api.policy(), (status) =>
            status.policy === undefined
              ? status
              : { ...status, policy: { ...status.policy, at: head } }
          )
        ),
      showAsk: (_caller, id) =>
        Effect.flatMap(current, ({ asks }) =>
          Effect.fromOption(Option.fromUndefinedOr(asks.get(id))).pipe(
            Effect.mapError(() => new UnknownAsk({ ask: id })),
            Effect.map((ask) => ({ ask, brief: briefOf(ask) }))
          )
        ),
      showProposal: (_caller, id) =>
        Effect.flatMap(current, ({ proposals }) =>
          Effect.fromOption(Option.fromUndefinedOr(proposals.get(id))).pipe(
            Effect.mapError(() => new UnknownProposal({ proposal: id }))
          )
        ),
      status: (caller) =>
        Effect.map(current, (record) => statusIn(record, caller.handle)),
      today: (caller) =>
        Effect.flatMap(Effect.zip(current, now), ([record, at]) =>
          Effect.fromOption(
            todayIn(record, caller.handle, at, decisionsPerDay)
          ).pipe(Effect.mapError(() => new NotDecider({})))
        ),
      verdict: (_caller, input) =>
        Effect.flatMap(current, (record) =>
          record.asks.has(input.ask)
            ? Effect.succeed(
                Option.match(verdictIn(record, input.ask, input.head), {
                  onNone: () => ({}),
                  onSome: (verdict) => ({ verdict }),
                })
              )
            : Effect.fail(new UnknownAsk({ ask: input.ask }))
        ),
    });

    return Context.make(
      Projects,
      Projects.of({
        create: projects.create,
        get: (project) =>
          isFixture(project)
            ? Effect.map(projects.get(project), overlaid)
            : projects.get(project),
      })
    ).pipe(
      Context.add(DevProjected, {
        events: Effect.gen(function* () {
          const all = yield* projected.events;
          const told = yield* Ref.get(fixtures.told);

          return [
            ...all.filter(({ project }) => !isFixture(project)),
            ...Option.match(told, {
              onNone: () => [],
              onSome: ({ record }) =>
                record.events.map((event) =>
                  ProjectedEvent.make({ event, project: vellum })
                ),
            }),
          ];
        }),
      })
    );
  })
);

/**
 * The fixtures told into a world the default seed has seeded: the fillers,
 * then vellum (made and first pushed through the service, its record told
 * over its repo), and the world's clock left at the record's morning.
 */
const seedFixtures = Effect.gen(function* () {
  const fixtures = yield* Fixtures;

  yield* seedFillers(30);

  const { landed } = yield* startedAt(
    vellum,
    vellumInitializer,
    vellumFiles,
    vellumStart
  );

  const { story, told } = yield* tellVellum(landed);
  const record = yield* decodeRecord(told());

  yield* Ref.set(fixtures.told, Option.some({ record, story, told }));
  yield* (yield* DevClock).set(fixturesNow);
}).pipe(Effect.orDie);

/**
 * A fresh world with the fixtures, seeded: the default seed, then the
 * fixtures. In `live` mode the lint child lands `liveAfter` after vellum's
 * `watch` is first answered.
 */
export const withFixtures = (
  mode: "on" | "live",
  liveAfter: Duration.Duration = LIVE_AFTER
) =>
  Layer.effectDiscard(Effect.andThen(seedDev, seedFixtures)).pipe(
    Layer.provideMerge(
      devWorldWith(
        overlay.pipe(
          Layer.provideMerge(
            fixturesLayer(
              mode === "live" ? Option.some(liveAfter) : Option.none()
            )
          )
        )
      )
    )
  );
