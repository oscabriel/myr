/**
 * The dev world with its fixtures switched on: every state a page draws,
 * served through the contracts the pages call, beside datekit and burrow.
 * Each case reads a fresh world the way a browser would, over `/rpc`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AskId,
  DecisionId,
  Handle,
  ProjectName,
  ProposalId,
} from "@repo/protocol/ids";
import { Context, DateTime, Duration, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { askStates, familyMarks } from "../src/client/events.ts";
import type { DevWorldOptions } from "../src/dev/server.ts";
import { devServer } from "../src/dev/server.ts";
import { devToken } from "../src/dev/sessions.ts";

const vellum = ProjectName.make("vellum");

const ask = (id: string) => AskId.make(id);

const signedIn = (handle: string) => devToken(Handle.make(handle));

/** A client of `handler`'s `/rpc`, whose calls carry `token` as their bearer when there is one. */
const connect = (
  handler: (request: Request) => Promise<Response>,
  token?: string
) =>
  Effect.map(
    Layer.build(
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
      )
    ),
    Context.get(Client)
  );

type Reader = Effect.Success<ReturnType<typeof connect>>;

/** A fresh world with `options`, served, and `read` run against it. */
const inWorld = <A, E>(
  options: DevWorldOptions,
  read: (
    as: (token?: string) => Effect.Effect<Reader, never, Scope.Scope>
  ) => Effect.Effect<A, E, Scope.Scope>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { dispose, handler } = devServer(options);

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return yield* read((token) => connect(handler, token));
    })
  );

const withFixtures: DevWorldOptions = { fixtures: "on" };

/** vellum's events, as `watch` replays them from the first. */
const eventsOf = (client: Reader) =>
  Effect.map(
    Stream.runCollect(client.watch({ project: vellum })),
    (events): readonly ProjectEvent[] => events
  );

/** The `AskClosed` events among `events`. */
const closedIn = (events: readonly ProjectEvent[]) =>
  events.filter(ProjectEvent.guards.AskClosed);

/** The tag of each answer state's verdict outcome, by ask. */
const ANSWERS = {
  "carry-footnotes-to-epub": "Landed",
  "cli-version-flag": "Landed",
  "escape-attribute-quotes": "AwaitingDecision",
  "footnote-backrefs": "WaitingOnParent",
  "render-code-blocks": "Landed",
  "render-nested-lists": "Refused",
  "retire-old-tokenizer-vellum-lint": "Checking",
  "retire-old-tokenizer-vellum-parser": "Refused",
  "trim-trailing-spaces": "Refused",
  "wrap-long-table-cells": "AwaitingFinish",
} as const;

const answersRead = inWorld(withFixtures, (as) =>
  Effect.gen(function* () {
    const anyone = yield* as();

    const verdicts = yield* Effect.forEach(Object.keys(ANSWERS), (id) =>
      Effect.map(
        anyone.verdict({ ask: ask(id), project: vellum }),
        ({ verdict }) => [id, verdict] as const
      )
    );

    const byAsk = new Map(verdicts);

    const landingOf = (id: string) => {
      const outcome = byAsk.get(id)?.outcome;

      return outcome !== undefined && Outcome.guards.Landed(outcome)
        ? Effect.map(
            anyone.landing({ project: vellum, sha: outcome.sha }),
            ({ landing }) => landing
          )
        : Effect.die(`${id} did not land`);
    };

    return {
      byAsk,
      decided: yield* landingOf("carry-footnotes-to-epub"),
      events: yield* eventsOf(anyone),
      plain: yield* landingOf("cli-version-flag"),
    };
  })
);

/** Each refusal of a refused outcome, as its tag and the place it points at. */
const refusalsOf = (outcome: Outcome | undefined) =>
  outcome !== undefined && Outcome.guards.Refused(outcome)
    ? outcome.refusals
    : [];

/**
 * Each test seeds a whole world with its fixtures while turbo runs every
 * package's tests at once, as `dev-backend.test.ts` does.
 */
const seededWorlds = { timeout: 30_000 };

describe("the dev world's fixtures", seededWorlds, () => {
  it.live(
    "list more than eight projects, vellum and one with no open asks among them",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const { projects } = yield* (yield* as()).listProjects({});
          const names = new Set(projects.map(({ project }) => project));

          expect(projects.length).toBeGreaterThan(8);
          expect(
            ["burrow", "datekit", "vellum"].filter(
              (name) => !names.has(ProjectName.make(name))
            )
          ).toStrictEqual([]);
          expect(
            projects.find(({ project }) => project === "mossgate")?.openAsks
          ).toBe(0);
        })
      )
  );

  it.live("give every answer state its verdict", () =>
    Effect.gen(function* () {
      const { byAsk } = yield* answersRead;

      expect(
        Object.fromEntries(
          [...byAsk].map(([id, verdict]) => [id, verdict?.outcome._tag])
        )
      ).toStrictEqual(ANSWERS);
      expect({
        checking: byAsk.get("retire-old-tokenizer-vellum-lint")?.outcome,
        decision: byAsk.get("escape-attribute-quotes")?.outcome,
        finish: byAsk.get("wrap-long-table-cells")?.outcome,
        parent: byAsk.get("footnote-backrefs")?.outcome,
      }).toStrictEqual({
        checking: Outcome.cases.Checking.make({ stage: "checks" }),
        decision: Outcome.cases.AwaitingDecision.make({
          decision: DecisionId.make("dec-000002"),
        }),
        finish: Outcome.cases.AwaitingFinish.make({
          decider: Handle.make("ines-v"),
        }),
        parent: Outcome.cases.WaitingOnParent.make({
          ask: ask("number-footnotes"),
        }),
      });
    })
  );

  it.live(
    "refuse at Shape with a place, at the held-back stage by area, and at the checks with a failed lane's log",
    () =>
      Effect.gen(function* () {
        const { byAsk } = yield* answersRead;
        const scope = byAsk.get("trim-trailing-spaces");
        const held = byAsk.get("retire-old-tokenizer-vellum-parser");
        const checks = byAsk.get("render-nested-lists");

        const [outside] = refusalsOf(scope?.outcome);
        const [sealed] = refusalsOf(held?.outcome);
        const [failed] = refusalsOf(checks?.outcome);

        expect([scope?.stage, outside?._tag, outside?.at]).toStrictEqual([
          "shape",
          "OutOfScope",
          { line: 3, path: "packages/cli/src/args.ts" },
        ]);
        expect([held?.stage, sealed?._tag, held?.heldBack]).toMatchObject([
          "heldBack",
          "HeldBackFailed",
          [{ area: "parser", passed: 3, total: 4 }],
        ]);
        expect([checks?.stage, failed?._tag]).toStrictEqual([
          "checks",
          "ChecksFailed",
        ]);
        expect(
          checks?.lanes
            .filter(({ result }) => result === "failed")
            .map(({ lane, logRef }) => [lane, logRef !== undefined])
        ).toStrictEqual([["unit", true]]);
      })
  );

  it.live(
    "land one answer with a decision and the Held-back trailer, and one with neither",
    () =>
      Effect.gen(function* () {
        const { byAsk, decided, plain } = yield* answersRead;

        expect(decided.heldBackTrailer).toMatch(
          /^export 7\/7 @ sha256:[0-9a-f]{64}; parser 4\/4 @ sha256:[0-9a-f]{64}$/u
        );
        expect(decided.credits.map(({ role }) => role)).toContain("Decided-by");
        expect({
          attended: plain.credits.filter(
            ({ role }) => role === "Decided-by" || role === "Finished-by"
          ),
          heldBack: byAsk.get("cli-version-flag")?.heldBack,
          trailer: plain.heldBackTrailer,
        }).toStrictEqual({ attended: [], heldBack: [], trailer: undefined });
      })
  );

  it.live("replay an answer's three rounds: refused twice, then landed", () =>
    Effect.gen(function* () {
      const { events } = yield* answersRead;
      const progress = askStates(events).get(ask("render-code-blocks"));

      expect(progress?.rounds.map(({ outcome }) => outcome._tag)).toStrictEqual(
        ["Refused", "Refused", "Checking"]
      );
      expect(progress?.landed).toBeDefined();
    })
  );

  it.live(
    "fold the first family's events into one child in every mark, its delete child waiting",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const parent = ask("retire-old-tokenizer");
          const shown = yield* anyone.showAsk({ ask: parent, project: vellum });
          const states = askStates(yield* eventsOf(anyone));
          const family = familyMarks(shown.ask, states);
          const { asks } = yield* anyone.listAsks({ project: vellum });

          // The parent stores its six children, then the delete child.
          expect(shown.ask.blockedBy).toHaveLength(7);
          expect(shown.ask.blockedBy.at(-1)).toBe(
            "retire-old-tokenizer-delete"
          );
          expect(
            family.children.slice(0, 6).map(({ mark }) => mark)
          ).toStrictEqual([
            "landed",
            "landed",
            "checking",
            "refused",
            "claimed",
            "open",
          ]);
          expect(
            asks.find(({ ask: id }) => id === "retire-old-tokenizer-delete")
          ).toBeDefined();
        })
      )
  );

  it.live(
    "land the second family's children and open its delete child to take",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const parent = ask("rename-page-size");
          const shown = yield* anyone.showAsk({ ask: parent, project: vellum });
          const states = askStates(yield* eventsOf(anyone));
          const { entries } = yield* anyone.frontPage({});

          const children = shown.ask.blockedBy.filter(
            (child) => child !== "rename-page-size-delete"
          );

          expect(children.length).toBeGreaterThanOrEqual(2);
          expect(
            children.filter((child) => states.get(child)?.landed === undefined)
          ).toStrictEqual([]);
          expect(
            entries.find(
              (entry) =>
                entry.project === vellum &&
                entry.ask.ask === "rename-page-size-delete"
            )?.takeable
          ).toBeTruthy();
        })
      )
  );

  it.live(
    "hold asks open, held for newcomers, claimed with and without a push, and one with a long want",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const { asks } = yield* anyone.listAsks({ project: vellum });
          const states = askStates(yield* eventsOf(anyone));
          const held = asks.find(({ reserve }) => reserve === "newcomers");

          const mentored = yield* anyone.showAsk({
            ask: held?.ask ?? ask("missing"),
            project: vellum,
          });

          const render = states.get(ask("retire-old-tokenizer-vellum-render"));

          expect(mentored.ask.mentor).toBe("okonkwo");
          expect(asks.some(({ want }) => want.length > 80)).toBeTruthy();
          expect([render?.claimant, render?.lastPush]).toStrictEqual([
            "sefa",
            undefined,
          ]);
          expect(states.get(ask("number-footnotes"))?.lastPush).toBeDefined();
        })
      )
  );

  it.live(
    "put every kind of decision on a decider's Today, one due within the day and two of five taken",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const project = vellum;
          const ines = yield* as(signedIn("ines-v"));
          const mine = yield* ines.today({ project });
          const merged = yield* ines.today({});

          const others = yield* Effect.forEach(["okonkwo", "lin-h"], (handle) =>
            Effect.flatMap(as(signedIn(handle)), (client) =>
              client.today({ project })
            )
          );

          const kinds = new Set(
            [mine, ...others].flatMap(({ decisions }) =>
              decisions.map(({ subject }) => subject._tag)
            )
          );

          expect({
            budget: [mine.budget.used, mine.budget.total],
            dueToday: mine.expiringSoon.length,
            overflow: mine.overflow,
            shown: mine.decisions.some(({ id }) => id === mine.expiringSoon[0]),
          }).toStrictEqual({
            budget: [2, 5],
            dueToday: 1,
            overflow: 3,
            shown: true,
          });
          expect([
            mine.newcomers.length > 0,
            mine.unattended.length > 0,
            merged.overflow >= 3,
          ]).toStrictEqual([true, true, true]);
          expect([...kinds].toSorted()).toStrictEqual([
            "Finish",
            "OpenProposal",
            "PostureChange",
            "ProxyWidened",
            "RaiseRatchet",
            "SecretInTree",
            "StrayPush",
            "Vouch",
            "Waiver",
          ]);
        })
      )
  );

  it.live(
    "show a Finish decision with its diff, a refusal's place inside it, and the fork to finish from",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const ines = yield* as(signedIn("ines-v"));
          const { decisions } = yield* ines.today({ project: vellum });

          const finish = decisions.find(({ subject }) =>
            DecisionSubject.guards.Finish(subject)
          );

          const patch = finish?.evidence.find(
            ({ label }) => label === "patch"
          )?.value;

          const rounds =
            askStates(yield* eventsOf(ines)).get(ask("wrap-long-table-cells"))
              ?.rounds ?? [];

          const placed = rounds
            .flatMap(({ outcome }) => refusalsOf(outcome))
            .flatMap(({ at }) => (at === undefined ? [] : [at]));

          expect(finish?.evidence.map(({ label }) => label)).toContain("fork");
          expect(placed).toHaveLength(1);
          expect(patch).toContain(`+++ b/${placed[0]?.path}`);
        })
      )
  );

  it.live(
    "keep a ledger of sealed evidence: a layer, two areas, and history of every kind",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const ledger = yield* anyone.ledger({ project: vellum });
          const { projects } = yield* anyone.listProjects({});

          expect([
            ledger.posture,
            projects.find(({ project }) => project === vellum)?.posture,
          ]).toStrictEqual([
            "openWithSealedEvidence",
            "openWithSealedEvidence",
          ]);
          expect(
            ledger.layers.map(({ name, reason }) => [name, reason.length > 0])
          ).toStrictEqual([["maintainers", true]]);
          expect(
            ledger.entries.flatMap((entry) =>
              LedgerEntry.guards.CommitmentPublished(entry)
                ? [[entry.area, entry.checks, entry.authors]]
                : []
            )
          ).toStrictEqual([
            ["export", 7, 3],
            ["parser", 4, 3],
          ]);
          expect(new Set(ledger.entries.map(({ _tag }) => _tag))).toStrictEqual(
            new Set([
              "Admitted",
              "CommitmentPublished",
              "CountChanged",
              "LayerDeclared",
              "PostureChanged",
              "Released",
              "ValueSet",
            ])
          );
        })
      )
  );

  it.live(
    "declare an env schema with a write-only item someone set, and never a value",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const declared = yield* (yield* as()).envShape({ project: vellum });

          const token = declared.items.find(
            ({ key }) => key === "SENTRY_AUTH_TOKEN"
          );

          expect(declared.items).toHaveLength(4);
          expect({
            proxy: token?.proxy,
            sensitive: token?.sensitive,
            setBy: token?.value?.setBy,
          }).toStrictEqual({
            proxy: { domains: ["sentry.io"], path: "/api/**" },
            sensitive: true,
            setBy: "ines-v",
          });
          expect(
            declared.items.some(({ deprecated }) => deprecated === true)
          ).toBeTruthy();
          expect(
            declared.items.filter(
              ({ placeholder }) => placeholder !== undefined
            )
          ).toStrictEqual([]);
        })
      )
  );

  it.live("state a policy with deciders by path and a denounced person", () =>
    inWorld(withFixtures, (as) =>
      Effect.gen(function* () {
        const { policy } = yield* (yield* as()).projectPolicy({
          project: vellum,
        });

        expect(
          new Set(policy?.deciders.map(({ paths }) => paths)).size
        ).toBeGreaterThan(2);
        expect(
          policy?.vouches
            .filter(({ denounced }) => denounced)
            .map(({ handle }) => handle)
        ).toStrictEqual(["wren"]);
      })
    )
  );

  it.live("draft proposals into every state a draft settles in", () =>
    inWorld(withFixtures, (as) =>
      Effect.gen(function* () {
        const anyone = yield* as();

        const shown = yield* Effect.forEach(
          ["prop-000002", "prop-000003", "prop-000004", "prop-000005"],
          (id) =>
            anyone.showProposal({
              project: vellum,
              proposal: ProposalId.make(id),
            })
        );

        expect(
          shown.map(({ files, proposal }) => [
            proposal.draft?._tag,
            files.length,
          ])
        ).toStrictEqual([
          ["Ready", 3],
          ["Failed", 0],
          ["Failed", 3],
          ["Drafting", 0],
        ]);
      })
    )
  );

  it.live(
    "list landings across three days, tags, and claim forks in every state",
    () =>
      inWorld(withFixtures, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const refs = yield* anyone.listRefs({ project: vellum });
          const { commits } = yield* anyone.log({ project: vellum });

          const landings = commits.flatMap(({ landing }) =>
            landing === undefined ? [] : [landing]
          );

          expect(refs.tags.length).toBeGreaterThan(0);
          expect(
            new Set(refs.forks.map(({ kind, state }) => state ?? kind))
          ).toStrictEqual(
            new Set([
              "answered",
              "lapsed",
              "live",
              "released",
              "warned",
              "working",
            ])
          );
          expect(
            new Set(
              landings.map(({ landedAt }) =>
                DateTime.formatIsoDateUtc(landedAt)
              )
            ).size
          ).toBeGreaterThanOrEqual(3);
          expect([
            landings.some(({ opened }) => opened !== undefined),
            landings.some(
              ({ heldBackTrailer }) => heldBackTrailer !== undefined
            ),
          ]).toStrictEqual([true, true]);
        })
      )
  );
});

describe("the dev world's live landing", seededWorlds, () => {
  it.live(
    "lands one more child of the first family after the project's watch is first read",
    () =>
      inWorld({ fixtures: "live", liveAfter: Duration.zero }, (as) =>
        Effect.gen(function* () {
          const anyone = yield* as();
          const first = yield* eventsOf(anyone);
          const second = yield* eventsOf(anyone);

          const landed = closedIn(second).find(
            (event) => !closedIn(first).some(({ seq }) => seq === event.seq)
          );

          expect(closedIn(second)).toHaveLength(closedIn(first).length + 1);
          expect(landed?.ask).toBe("retire-old-tokenizer-vellum-lint");
          expect(landed?.seq).toBeGreaterThan(
            Math.max(...first.map(({ seq }) => seq))
          );
        })
      )
  );
});
