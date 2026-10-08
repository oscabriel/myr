/**
 * The web's contracts as its atoms read them, with `#backend` under the
 * `development` condition: the same `ContractsClient` group, the same
 * reactivity keys and the same `/rpc` path, answered by the dev world in
 * process instead of a platform. Each registry stands for one browser: its
 * client's requests carry that browser's session cookie, or none, which
 * the backend turns into the bearer the dev world reads (issue 513).
 * Every test reads the one world the module's `backend` seeds, in order;
 * only the last changes it.
 */
import { describe, expect, it } from "@effect/vitest";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { UnknownAsk } from "@repo/protocol/refusal";
import { env } from "cloudflare:workers";
import { Array, DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import type { AsyncResult } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { backend } from "#backend";

import { keys } from "../src/client/keys.ts";
import { serverClientOver } from "../src/server/client.ts";
import { SESSION_COOKIE, whoamiHandler } from "../src/server/session.ts";
import { ContractsClient, webContracts } from "../src/surfaces.ts";

const WEB_URL = "http://localhost:3000";

const datekit = ProjectName.make("datekit");

/** The decider of datekit in the dev world, and the token that signs them in. */
const DECIDER = "dev-ines-v";

/**
 * `ContractsClient` as one browser runs it: its HTTP protocol posts to the
 * web's `/rpc`, which hands the request to `backend` in process, with
 * `token` in the session cookie when there is one.
 */
const browser = (token?: string) =>
  Layer.effect(
    ContractsClient,
    RpcClient.make(webContracts, { flatten: true })
  ).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({
        transformClient: HttpClient.mapRequest((request) =>
          token === undefined
            ? request
            : HttpClientRequest.setHeader(
                request,
                "cookie",
                `${SESSION_COOKIE}=${token}`
              )
        ),
        url: `${WEB_URL}/rpc`,
      })
    ),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
        backend(new Request(input, init), env)
      )
    ),
    Layer.provideMerge(Reactivity.layer)
  );

/** A registry whose `ContractsClient` is `browser(token)`'s. */
const registryAs = (token?: string) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(ContractsClient.runtime.layer, browser(token)),
    ],
  });

/** An atom's value once it has one, past any refetch under way. */
const settled = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.exit(
    AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
  );

const todayAtom = ContractsClient.query(
  "today",
  {},
  { reactivityKeys: keys.today() }
);

/**
 * The first test waits for the module's world to be seeded, cold, while
 * turbo runs every package's tests at once (near vitest's 5 s default).
 */
const seededWorld = { timeout: 30_000 };

describe("the dev world, through the web's atoms", seededWorld, () => {
  it.live(
    "lists every open ask of both projects on the front page, the newcomers' one untakeable",
    () =>
      Effect.gen(function* () {
        const registry = registryAs();

        const page = yield* settled(
          registry,
          ContractsClient.query(
            "frontPage",
            {},
            { reactivityKeys: keys.front() }
          )
        );

        expect(Exit.isSuccess(page)).toBeTruthy();

        const entries = Exit.isSuccess(page) ? page.value.entries : [];

        expect(
          entries
            .map(
              ({ ask, project, takeable }) =>
                `${project}/${ask.ask} ${takeable}`
            )
            .toSorted()
        ).toStrictEqual([
          "burrow/drop-legacy-fetch false",
          "burrow/drop-legacy-fetch-burrow-auth true",
          "burrow/drop-legacy-fetch-burrow-billing true",
          "burrow/drop-legacy-fetch-burrow-catalog true",
          "burrow/drop-legacy-fetch-burrow-kit true",
          "burrow/drop-legacy-fetch-burrow-notify true",
          "burrow/drop-legacy-fetch-burrow-search true",
          "datekit/add-months-clamp true",
          "datekit/format-ordinal false",
          "datekit/parse-iso-week false",
        ]);

        const reserved = entries.find(({ ask }) => ask.reserve !== undefined);

        expect(reserved?.ask.ask).toBe("format-ordinal");
        expect(reserved?.ask.reserve).toBe("newcomers");
        expect(reserved?.ask.claimed).toBeFalsy();
      })
  );

  it.live(
    "lists a project's asks, and an ask it never opened is UnknownAsk",
    () =>
      Effect.gen(function* () {
        const registry = registryAs();

        const listed = yield* settled(
          registry,
          ContractsClient.query(
            "listAsks",
            { project: datekit },
            { reactivityKeys: keys.project(datekit) }
          )
        );

        expect(
          Exit.isSuccess(listed)
            ? listed.value.asks.map(({ ask }) => ask).toSorted()
            : []
        ).toStrictEqual([
          "add-months-clamp",
          "format-ordinal",
          "parse-iso-week",
        ]);

        const unknown = AskId.make("no-such-ask");

        const shown = yield* settled(
          registry,
          ContractsClient.query(
            "showAsk",
            { ask: unknown, project: datekit },
            { reactivityKeys: keys.ask(datekit, unknown) }
          )
        );

        const error = Exit.isFailure(shown)
          ? Option.getOrUndefined(Exit.findErrorOption(shown))
          : undefined;

        expect(Schema.is(UnknownAsk)(error)).toBeTruthy();
      })
  );

  it.live("keeps Today from an anonymous browser", () =>
    Effect.gen(function* () {
      const anonymous = yield* settled(registryAs(), todayAtom);

      const refused = Exit.isFailure(anonymous)
        ? Option.getOrUndefined(Exit.findErrorOption(anonymous))
        : undefined;

      expect(Schema.is(Unauthenticated)(refused)).toBeTruthy();
    })
  );

  it.live(
    "signs a browser in as the person whose dev token its session cookie holds, as /auth/dev sets it",
    () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          whoamiHandler((request) => serverClientOver(backend)(env, request))({
            request: new Request(`${WEB_URL}/auth/whoami`, {
              headers: { cookie: `${SESSION_COOKIE}=${DECIDER}` },
            }),
          })
        );

        expect(
          JSON.parse(yield* Effect.promise(() => response.text()))
        ).toStrictEqual({ handle: "ines-v" });
      })
  );

  it.live("shows the decider their Today, with the seed's decisions", () =>
    Effect.gen(function* () {
      const today = yield* settled(registryAs(DECIDER), todayAtom);

      expect(
        Exit.isSuccess(today)
          ? {
              budget: today.value.budget,
              decider: today.value.decider,
              newcomers: today.value.newcomers,
              projects: Array.dedupe(
                today.value.decisions.map(({ project }) => project)
              ),
              subjects: today.value.decisions
                .map(({ subject }) => subject._tag)
                .toSorted(),
              unattended: today.value.unattended.map(({ ask }) => ask),
            }
          : undefined
      ).toStrictEqual({
        budget: { finishes: 0, total: 5, used: 2 },
        decider: "ines-v",
        newcomers: ["bram"],
        projects: ["datekit"],
        subjects: ["OpenProposal", "OpenProposal", "StrayPush"],
        unattended: ["diff-in-days-dst"],
      });
    })
  );

  it.live(
    "closes a decision the decider declines, and Today refetches without it",
    () =>
      Effect.gen(function* () {
        const registry = registryAs(DECIDER);
        const unmount = registry.mount(todayAtom);
        const before = yield* settled(registry, todayAtom);

        const proposal = Exit.isSuccess(before)
          ? before.value.decisions.find(({ subject }) =>
              DecisionSubject.guards.OpenProposal(subject)
            )
          : undefined;

        expect(proposal).toBeDefined();

        if (proposal === undefined) {
          return;
        }

        const decide = ContractsClient.mutation("decide");

        registry.set(decide, {
          payload: {
            choice: "decline",
            decision: proposal.id,
            project: proposal.project,
          },
          reactivityKeys: [...keys.today(), ...keys.project(proposal.project)],
        });

        const decided = yield* settled(registry, decide);

        const taken = Exit.isSuccess(decided)
          ? decided.value.decision.decided
          : undefined;

        expect(taken?.choice).toBe("decline");
        // The world serves at the instant its seed left the clock.
        expect(
          taken === undefined ? undefined : DateTime.formatIso(taken.at)
        ).toBe("2026-10-07T09:21:00.000Z");

        const after = yield* settled(registry, todayAtom);

        expect(
          Exit.isSuccess(after)
            ? after.value.decisions.map(({ id }) => id).includes(proposal.id)
            : true
        ).toBeFalsy();
        expect(Exit.isSuccess(after) ? after.value.budget.used : 0).toBe(3);

        unmount();
      })
  );
});
