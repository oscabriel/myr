/**
 * The dev world's seed, read back through the contracts a fresh world
 * serves: the same world every time, every time it holds counted in whole
 * minutes from one fixed start (so a page looks the same on every machine
 * and every run), and an answer that landed with its credit.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
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

const PROJECTS = [
  ProjectName.make("oscabriel/burrow"),
  ProjectName.make("oscabriel/datekit"),
];

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
    const burrow = ProjectName.make("oscabriel/burrow");

    const landed = yield* Effect.orDie(
      Effect.fromNullishOr((yield* anyone.listRefs({ project: burrow })).landed)
    );

    // burrow has only its asks' openings, each a landing; the last is main.
    const { landing: opening } = yield* anyone.landing({
      project: burrow,
      sha: landed,
    });

    return {
      landedAt: unattended.map(({ landedAt }) => landedAt),
      opening,
      projects,
    };
  })
);

/** The project list beside each project's ledger, as anyone reads them. */
const listedWithLedgers = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const { projects } = yield* anyone.listProjects({});

    const ledgers = yield* Effect.forEach(PROJECTS, (project) =>
      anyone.ledger({ project })
    );

    return { ledgers, projects };
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

  it.live("adds none of the fixtures without their switch", () =>
    Effect.gen(function* () {
      const { entries, projects } = yield* pages;
      const listed = new Set(projects.map(({ project }) => project));

      for (const fixture of [
        "vellum",
        "amberlog",
        "cinderbox",
        "fernwick",
        "mossgate",
        "quillon",
        "tidepool",
      ]) {
        expect(listed.has(ProjectName.make(fixture))).toBeFalsy();
      }

      expect(
        entries.every(({ project }) => PROJECTS.includes(project))
      ).toBeTruthy();
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
        const { landedAt, opening, projects } = yield* listedWithLanding;

        expect(
          projects.map(({ landedAt: at, project }) => [project, at])
        ).toStrictEqual([
          ["burrow", opening.landedAt],
          ["datekit", landedAt[0]],
        ]);
        expect(opening.opened).toBeDefined();
        expect(landedAt).toHaveLength(1);
      })
  );

  it.live("lists each project at the posture its own ledger gives", () =>
    Effect.gen(function* () {
      const { ledgers, projects } = yield* listedWithLedgers;

      expect(
        projects.map(({ posture, project }) => [project, posture])
      ).toStrictEqual(
        ledgers.map(({ posture, project }) => [project, posture])
      );
      // The dev world composes no visibility cartridge, so every ledger,
      // and the list with it, reads Open.
      expect(ledgers.map(({ posture }) => posture)).toStrictEqual([
        "open",
        "open",
      ]);
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

  it.live(
    "discloses the harness bram pushed through as Assisted-by, credited to nobody",
    () =>
      Effect.gen(function* () {
        const { landing } = yield* landedAnswer;

        expect(landing.assisted).toStrictEqual([
          { harness: "claude-code", model: "haiku", verified: false },
        ]);
        expect(landing.credits.map(({ handle }) => handle)).not.toContain(
          "claude-code"
        );
      })
  );
});

/** Each of `paths` on a fresh world's own handler: its status, headers and body. */
const fetched = (paths: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { dispose, handler } = devServer();

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return yield* Effect.forEach(paths, (path) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            handler(new Request(`http://localhost${path}`))
          );

          return {
            cache: response.headers.get("cache-control"),
            csp: response.headers.get("content-security-policy") ?? "",
            nosniff: response.headers.get("x-content-type-options"),
            status: response.status,
            text: yield* Effect.promise(() => response.text()),
          };
        })
      );
    })
  );

describe("the dev world's raw files", seededWorlds, () => {
  it.live(
    "answer a project's file as the platform does, and a path that climbs out with a 404",
    () =>
      Effect.gen(function* () {
        const [manifest, climbed] = yield* fetched([
          "/datekit/raw/main/package.json",
          "/datekit/raw/main/..%2F..%2Fpackage.json",
        ]);

        expect(manifest).toMatchObject({
          cache: "public, max-age=60",
          nosniff: "nosniff",
          status: 200,
        });
        expect(manifest?.csp).toContain("sandbox");
        expect(manifest?.text).toContain('"name": "datekit"');
        expect([climbed?.status, climbed?.text]).toStrictEqual([404, ""]);
      })
  );
});

/**
 * bram proposes a want for datekit with a draft, and what follows: the
 * proposal as anyone reads it, and ines-v's Today before and after.
 */
const drafted = inFreshWorld((as) =>
  Effect.gen(function* () {
    const anyone = yield* clientOf(as());
    const ines = yield* clientOf(as(decider));
    const bram = yield* clientOf(as(contributor));
    const project = ProjectName.make("oscabriel/datekit");
    const before = yield* ines.today({ project });

    const { proposal } = yield* bram.proposeAsk({
      draft: true,
      project,
      want: "datekit reads ordinal dates such as 2026-280.",
    });

    const shown = yield* anyone.showProposal({
      project,
      proposal: proposal.id,
    });

    return {
      after: yield* ines.today({ project }),
      before,
      proposed: proposal,
      shown,
    };
  })
);

describe("a draft in the dev world", seededWorlds, () => {
  it.live(
    "is drafted as it is proposed, red first on the scripted Checker, and its decision joins the decider's Today",
    () =>
      Effect.gen(function* () {
        const { after, before, proposed, shown } = yield* drafted;

        // The seeded decisions expire first and fill the day's budget, so
        // the draft's decision waits on Today as its overflow.
        expect({
          files: shown.files.map(({ path }) => path),
          overflow: [before.overflow, after.overflow],
          proposed: proposed.draft?._tag,
          ready: shown.proposal.draft?._tag,
          shown: after.decisions.map(({ id }) => id),
        }).toStrictEqual({
          files: [
            `${Brand.configDir}/asks/parse-ordinal.ask.ts`,
            "test/asks/parse-ordinal.test.ts",
          ],
          overflow: [0, 1],
          proposed: "Drafting",
          ready: "Ready",
          shown: before.decisions.map(({ id }) => id),
        });
      })
  );
});
