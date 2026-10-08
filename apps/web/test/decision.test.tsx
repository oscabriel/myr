/**
 * Deciding from Today: the `decide` atom sends the decider's choice as the
 * contract's payload, and on success reads Today and the project again, so
 * the decision leaves the list and the project shows what it changed. A
 * decision someone else closed first comes back as the `DecisionClosed`
 * refusal, shown as such, and Today reads again without it.
 *
 * The atoms run in an `AtomRegistry` whose `ContractsClient` is the protocol's
 * own client over in-process handlers that record each call (`RpcTest`); no
 * HTTP and no platform.
 */
import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
import { CommitSha, DecisionId, Handle, ProjectName } from "@repo/protocol/ids";
import { DecisionClosed } from "@repo/protocol/refusal";
import type { UnknownDecision } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { DateTime, Effect, Exit, Layer, Ref } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { decideAtom } from "../src/client/decide.ts";
import { keys } from "../src/client/keys.ts";
import { todayAtom } from "../src/client/today.ts";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import { TodayView } from "../src/features/today/today-page.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const okonkwo = Handle.make("okonkwo");

const datekit = ProjectName.make("datekit");

const stray: Decision = {
  deciders: [okonkwo],
  default: "revert",
  evidence: [],
  expiresAt: DateTime.makeUnsafe("2026-10-08T10:00:00Z"),
  id: DecisionId.make("dec-000002"),
  openedAt: DateTime.makeUnsafe("2026-10-06T10:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.StrayPush.make({
    after: CommitSha.make("b".repeat(40)),
    before: CommitSha.make("a".repeat(40)),
    ref: RefNameText.make("refs/heads/main"),
  }),
};

const todayWith = (decisions: readonly Decision[]): Today => ({
  budget: { finishes: 0, total: 5, used: 1 },
  decider: okonkwo,
  decisions,
  expiringSoon: decisions.map(({ id }) => id),
  newcomers: [],
  overflow: 0,
  unattended: [],
});

/** What the platform was asked, call by call. */
interface Asked {
  readonly decide: readonly unknown[];
  readonly listAsks: number;
  readonly today: number;
}

type Decide = (payload: {
  readonly choice: Choice;
}) => Effect.Effect<
  { readonly decision: Decision },
  DecisionClosed | UnknownDecision
>;

/**
 * The web's `ContractsClient`, answered in process: `today` answers the
 * stray push until a decision is taken and nothing after, `listAsks` answers
 * an empty list, and `decide` answers `answer`. Each call is recorded.
 */
const contracts = (asked: Ref.Ref<Asked>, answer: Decide) => {
  const decided = Ref.makeUnsafe(false);

  const handlers = Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("today", () =>
      Ref.update(asked, (all) => ({ ...all, today: all.today + 1 })).pipe(
        Effect.andThen(Ref.get(decided)),
        Effect.map((done) => todayWith(done ? [] : [stray]))
      )
    ),
    Contracts.toLayerHandler("listAsks", () =>
      Ref.update(asked, (all) => ({ ...all, listAsks: all.listAsks + 1 })).pipe(
        Effect.as({ asks: [] })
      )
    ),
    Contracts.toLayerHandler("decide", (payload) =>
      Ref.update(asked, (all) => ({
        ...all,
        decide: [...all.decide, payload],
      })).pipe(
        Effect.andThen(Ref.set(decided, true)),
        Effect.andThen(answer(payload))
      )
    )
  );

  return Layer.effect(ContractsClient)(
    RpcTest.makeClient(webContracts, { flatten: true })
  ).pipe(
    Layer.provide([handlers, asTester]),
    Layer.provideMerge(Reactivity.layer)
  );
};

/** A registry whose atoms reach `contracts` instead of `/rpc`. */
const registryOver = (
  layer: Layer.Layer<ContractsClient | Reactivity.Reactivity>
) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      AtomRegistry.make({
        initialValues: [
          Atom.initialValue(ContractsClient.runtime.layer, layer),
        ],
      })
    ),
    (registry) =>
      Effect.sync(() => {
        registry.dispose();
      })
  );

const projectAsks = ContractsClient.query(
  "listAsks",
  { project: datekit },
  { reactivityKeys: keys.project(datekit) }
);

/** Today and a read of the project, both on screen, read once; then `input` decided. */
const decideOnce = (
  answer: Decide,
  input: {
    readonly choice: Choice;
    readonly note?: string;
  }
) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make<Asked>({ decide: [], listAsks: 0, today: 0 });
    const registry = yield* registryOver(contracts(asked, answer));
    const today = todayAtom();

    registry.mount(today);
    registry.mount(projectAsks);
    registry.mount(decideAtom);

    yield* AtomRegistry.getResult(registry, today);
    yield* AtomRegistry.getResult(registry, projectAsks);

    registry.set(decideAtom, {
      decision: stray.id,
      project: datekit,
      ...input,
    });

    const outcome = yield* Effect.exit(
      AtomRegistry.getResult(registry, decideAtom, { suspendOnWaiting: true })
    );

    yield* AtomRegistry.getResult(registry, today, { suspendOnWaiting: true });
    yield* AtomRegistry.getResult(registry, projectAsks, {
      suspendOnWaiting: true,
    });

    return {
      asked: yield* Ref.get(asked),
      decided: registry.get(decideAtom),
      outcome,
      today: registry.get(today),
    };
  }).pipe(Effect.scoped);

const taken: Decide = ({ choice }) =>
  Effect.succeed({
    decision: {
      ...stray,
      decided: { at: now, by: okonkwo, choice },
    },
  });

describe("the decide atom", () => {
  it.live(
    "sends the choice and the note as the decide contract's payload",
    () =>
      Effect.gen(function* () {
        const { asked, outcome } = yield* decideOnce(taken, {
          choice: "revert",
          note: "Pushed by the old deploy key.",
        });

        expect(Exit.isSuccess(outcome)).toBeTruthy();
        expect(asked.decide).toStrictEqual([
          {
            choice: "revert",
            decision: "dec-000002",
            note: "Pushed by the old deploy key.",
            project: "datekit",
          },
        ]);
      })
  );

  it.live("sends no note when the decider wrote none", () =>
    Effect.gen(function* () {
      const { asked } = yield* decideOnce(taken, { choice: "adopt" });

      expect(asked.decide).toStrictEqual([
        { choice: "adopt", decision: "dec-000002", project: "datekit" },
      ]);
    })
  );

  it.live(
    "on success reads Today and the project again, and the decision leaves Today",
    () =>
      Effect.gen(function* () {
        const { asked, today } = yield* decideOnce(taken, {
          choice: "revert",
        });

        expect({
          listAsks: asked.listAsks,
          today: asked.today,
        }).toStrictEqual({ listAsks: 2, today: 2 });
        expect(
          markupOf(<TodayView now={now} onDecide={() => {}} result={today} />)
        ).not.toContain('data-decision="dec-000002"');
      })
  );

  it.live(
    "shows DecisionClosed as the refusal, and reads Today again without the decision",
    () =>
      Effect.gen(function* () {
        const closed = new DecisionClosed({ decision: stray.id });

        const { asked, decided, outcome, today } = yield* decideOnce(
          () => Effect.fail(closed),
          { choice: "revert" }
        );

        const markup = markupOf(
          <TodayView
            decided={decided}
            now={now}
            onDecide={() => {}}
            result={today}
          />
        );

        expect(Exit.isFailure(outcome)).toBeTruthy();
        expect(asked.today).toBe(2);
        expect(markup).toContain(markupOf(<RefusalView refusals={[closed]} />));
        expect(markup).not.toContain('data-decision="dec-000002"');
      })
  );
});
