/**
 * The dev world's seed, read back through the contracts a fresh world
 * serves: the same world every time, every time it holds counted in whole
 * minutes from one fixed start (so a page looks the same on every machine
 * and every run), and an answer that landed with its credit.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Handle, ProjectName } from "@repo/protocol/ids";
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Equal,
  Layer,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { devStart } from "../src/dev/clock.ts";
import { devServer } from "../src/dev/server.ts";
import { devToken } from "../src/dev/sessions.ts";

const PROJECTS = [ProjectName.make("burrow"), ProjectName.make("datekit")];

const decider = devToken(Handle.make("ines-v"));

const contributor = devToken(Handle.make("bram"));

/**
 * A fresh world, seeded and served, and `read` run against it: each
 * `as(token)` is a client whose requests carry that bearer, or none.
 */
const inFreshWorld = <A, E>(
  read: (
    as: (token?: string) => Layer.Layer<Client>
  ) => Effect.Effect<A, E, Scope.Scope>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { dispose, handler } = devServer();

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const as = (token?: string) =>
        Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
          Layer.provide(
            RpcClient.layerProtocolHttp({
              transformClient: HttpClient.mapRequest((request) =>
                token === undefined
                  ? request
                  : HttpClientRequest.bearerToken(request, token)
              ),
              url: "http://localhost/rpc",
            })
          ),
          Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
          Layer.provide(
            Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
              handler(new Request(input, init))
            )
          )
        );

      return yield* read(as);
    })
  );

/** The client a layer from `as(token)` makes, for as long as the world lives. */
const clientOf = (layer: Layer.Layer<Client>) =>
  Effect.map(Layer.build(layer), Context.get(Client));

/** The front page and the project list, as anyone reads them. */
const pages = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const { entries } = yield* anyone.frontPage({});
    const { projects } = yield* anyone.listProjects({});

    return { entries, projects };
  })
);

/** Every instant a reader of the seeded world can see. */
const instants = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const ines = yield* clientOf(as(decider));
    const bram = yield* clientOf(as(contributor));

    const events = yield* Effect.forEach(PROJECTS, (project) =>
      Stream.runCollect(anyone.watch({ project }))
    );

    const today = yield* ines.today({});
    const { claims } = yield* bram.status({});

    return [
      ...events
        .flat()
        .flatMap((event) => [
          event.at,
          ...(ProjectEvent.guards.Landed(event)
            ? [event.landing.landedAt]
            : []),
        ]),
      ...today.decisions.flatMap(({ expiresAt, openedAt }) => [
        openedAt,
        expiresAt,
      ]),
      ...today.unattended.map(({ landedAt }) => landedAt),
      ...claims.flatMap(({ lapsesAt, openedAt, warnsAt }) => [
        openedAt,
        warnsAt,
        lapsesAt,
      ]),
    ];
  })
);

/** datekit's landed answer, as Today samples it and as `landing` reads it. */
const landedAnswer = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const ines = yield* clientOf(as(decider));
    const { unattended } = yield* ines.today({});
    const [sampled] = unattended;

    if (sampled === undefined) {
      return yield* Effect.die("datekit has no landed answer");
    }

    const { landing } = yield* anyone.landing({
      project: sampled.project,
      sha: sampled.sha,
    });

    return { landing, sampled };
  })
);

/** The project list beside datekit's landed answer, as anyone reads them. */
const listedWithLanding = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const ines = yield* clientOf(as(decider));
    const { projects } = yield* anyone.listProjects({});
    const { unattended } = yield* ines.today({});

    return { landedAt: unattended.map(({ landedAt }) => landedAt), projects };
  })
);

/**
 * Each test seeds whole worlds, the first one cold, while turbo runs every
 * package's tests at once: about 0.5 s alone, near vitest's 5 s default
 * under that load once burrow's migrate opens as a family of eight asks.
 */
const seededWorlds = { timeout: 30_000 };

describe("the dev seed", seededWorlds, () => {
  it.live("gives two fresh worlds equal front pages and project lists", () =>
    Effect.gen(function* () {
      const first = yield* pages;
      const second = yield* pages;

      expect(first.entries).toHaveLength(10);
      expect(first.projects.map(({ project }) => project)).toStrictEqual(
        PROJECTS
      );
      expect(Equal.equals(first, second)).toBeTruthy();
    })
  );

  it.live("counts every time it holds in whole minutes from one start", () =>
    Effect.gen(function* () {
      const seen = yield* instants;
      const minute = Duration.toMillis(Duration.minutes(1));

      expect(seen.length).toBeGreaterThan(20);

      for (const instant of seen) {
        const since = Duration.toMillis(DateTime.distance(devStart, instant));

        expect(since).toBeGreaterThanOrEqual(0);
        expect(since % minute).toBe(0);
      }
    })
  );

  it.live(
    "lists each project with when it last landed, as D1's project list does",
    () =>
      Effect.gen(function* () {
        const { landedAt, projects } = yield* listedWithLanding;

        expect(
          projects.map(({ landedAt: at, project }) => [project, at])
        ).toStrictEqual([
          ["burrow", undefined],
          ["datekit", landedAt[0]],
        ]);
        expect(landedAt).toHaveLength(1);
      })
  );

  it.live("lands bram's answer to datekit with its credit trailers", () =>
    Effect.gen(function* () {
      const { landing, sampled } = yield* landedAnswer;

      expect(landing).toStrictEqual(sampled);
      expect(landing.ask).toBe("diff-in-days-dst");
      expect(landing.author).toBe("bram");
      expect(
        landing.credits.map(({ handle, role }) => `${role}: ${handle}`)
      ).toStrictEqual(["Asked-by: ines-v", "Signed-off-by: bram"]);
    })
  );
});
