// The switch is a `VITE_` variable because the dev world runs in the Worker's runtime,
// which sees no other variable of the shell that started Vite.
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

import { DevClock, devStart } from "./clock.ts";
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

export type FixtureMode = "off" | "on" | "live";

const Switch = Schema.Literals(["1", "on", "live"]);

export const fixturesMode: FixtureMode = Option.match(
  Schema.decodeUnknownOption(Switch)(import.meta.env.VITE_DEV_FIXTURES),
  {
    onNone: (): FixtureMode => "off",
    onSome: (on): FixtureMode => (on === "live" ? "live" : "on"),
  }
);

export const fixturesOn = fixturesMode !== "off";

export const LIVE_AFTER = Duration.seconds(20);

interface Told {
  readonly record: FixtureRecord;
  readonly story: Story;
  readonly told: () => FixtureRecord;
}

export class Fixtures extends Context.Service<
  Fixtures,
  {
    readonly told: Ref.Ref<Option.Option<Told>>;
    readonly liveAfter: Option.Option<Duration.Duration>;
    readonly armedAt: Ref.Ref<Option.Option<bigint>>;
    readonly landed: Ref.Ref<boolean>;
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

const callerOf = (principal: Principal) =>
  Principal.match(principal, {
    Anonymous: () => Option.none<Person>(),
    Person: (person) => Option.some(person),
  });

const isFixture = (project: ProjectName) => project === vellum;

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

    const current = Effect.flatMap(Ref.get(fixtures.told), (told) =>
      Option.match(told, {
        onNone: () => Effect.die("vellum's story is not told yet"),
        onSome: ({ record }) => Effect.succeed(record),
      })
    );

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

    // Only a read's start counts, so a later page of the same replay never lands it mid-replay.
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

            const armed = yield* Ref.modify(
              fixtures.armedAt,
              (was): readonly [Option.Option<bigint>, Option.Option<bigint>] =>
                Option.isSome(was)
                  ? [was, was]
                  : [Option.none(), Option.some(at)]
            );

            if (Option.isNone(armed)) {
              return;
            }

            const waited = Duration.nanos(at - armed.value);

            // Taken in one step, so two reads at once land it only once.
            if (
              Duration.isLessThan(waited, after) ||
              (yield* Ref.getAndSet(fixtures.landed, true))
            ) {
              return;
            }

            yield* write((story) =>
              Effect.flatMap(devClock.step, (landedAt) =>
                landLintChild(story, landedAt)
              )
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
      // Anyone but a maintainer or the log's claimant hears `NotDecider` whether or not a log is kept,
      // so the reply tells no one which logs exist.
      evidence: (caller, ref) =>
        Effect.gen(function* () {
          const record = yield* current;
          const log = Option.fromUndefinedOr(record.logs.get(ref));

          const allowed = Option.exists(
            callerOf(caller),
            ({ handle }) =>
              record.decisions.some(({ deciders }) =>
                deciders.some((each) => sameHandle(each, handle))
              ) ||
              Option.exists(log, ({ claimant }) => sameHandle(claimant, handle))
          );

          if (!allowed) {
            return yield* new NotDecider({});
          }

          if (Option.isNone(log)) {
            return yield* new UnknownProject({ project: vellum });
          }

          return {
            lane: log.value.lane,
            text: log.value.text,
            truncated: false,
          };
        }),
      // A claim's fork is made when the forks are first read, not when the
      // world is built: each copies the repo, and most worlds read no code.
      forks: () =>
        fixtures.lock
          .withPermits(1)(
            Effect.flatMap(
              Effect.flatMap(Ref.get(fixtures.told), Effect.fromOption),
              ({ story }) => provided(story.forkClaims())
            ).pipe(Effect.orDie, Effect.andThen(current))
          )
          .pipe(Effect.map(({ forks }) => forks)),
      head: () => Effect.map(current, ({ head }) => ({ landed: head })),
      landing: (_caller, sha) =>
        Effect.flatMap(current, (record) =>
          Option.match(landingIn(record, sha), {
            onNone: () => Effect.fail(new UnknownCommit({ sha })),
            onSome: (landing) => Effect.succeed({ landing }),
          })
        ),
      landingCount: () =>
        Effect.map(current, ({ landings }) => landings.length),
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
      standing: () =>
        Effect.map(current, (record) => ({
          posture: record.ledger.posture,
          seen: lastSeqOf(record),
        })),
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

export const withFixtures = (
  mode: "on" | "live",
  liveAfter: Duration.Duration = LIVE_AFTER,
  start: DateTime.Utc = devStart
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
        ),
        start
      )
    )
  );
