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
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
import { DraftState } from "@repo/protocol/domain/proposal";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LaneName,
  ProjectName,
  ProposalId,
  RepoPath,
} from "@repo/protocol/ids";
import { DecisionClosed } from "@repo/protocol/refusal";
import type { UnknownDecision } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { Cause, DateTime, Effect, Exit, Layer, Option, Ref } from "effect";
import { AsyncResult, Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { decideAtom } from "../src/client/decide.ts";
import { keys } from "../src/client/keys.ts";
import { todayAtom } from "../src/client/today.ts";
import { DecisionCard } from "../src/features/decision/decision-card.tsx";
import {
  DecisionRead,
  DecisionView,
} from "../src/features/decision/decision-page.tsx";
import type { DecisionPageData } from "../src/features/decision/decision-page.tsx";
import { patchFiles } from "../src/features/finish/files.ts";
import { waiverPatchOf } from "../src/features/finish/patch.ts";
import { ProposalFailure } from "../src/features/proposal/failure.tsx";
import {
  DraftRead,
  draftReadOf,
  readDraft,
} from "../src/features/proposal/live-draft.ts";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import {
  readOfCause,
  TodayRead,
  TodayView,
} from "../src/features/today/today-page.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees of `markup`: the text without its tags. */
const plainTextOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ");

/** Today as the page reads it from the atom: listed, or why not. */
const readOf = (result: AsyncResult.AsyncResult<Today, unknown>): TodayRead => {
  if (AsyncResult.isSuccess(result)) {
    return TodayRead.cases.Read.make({ today: result.value });
  }

  return AsyncResult.isFailure(result)
    ? readOfCause(result.cause)
    : TodayRead.cases.Unreachable.make({});
};

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
          markupOf(
            <TodayView now={now} onDecide={() => {}} read={readOf(today)} />
          )
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
            read={readOf(today)}
          />
        );

        expect(Exit.isFailure(outcome)).toBeTruthy();
        expect(asked.today).toBe(2);
        expect(markup).toContain(markupOf(<RefusalView refusals={[closed]} />));
        expect(markup).not.toContain('data-decision="dec-000002"');
      })
  );
});

/** The Accept button's opening tag. */
const acceptOf = (markup: string) =>
  /<button[^>]*data-choice="accept"[^>]*>/u.exec(markup)?.[0] ?? "";

describe("DecisionCard for an OpenProposal", () => {
  const askFile = `${Brand.configDir}/asks/x.ask.ts`;

  const proposal = ProposalId.make("prop-000007");

  const opening: Decision = {
    deciders: [okonkwo],
    default: "decline",
    evidence: [
      { label: "want", value: "formatISO keeps the offset it was given." },
      {
        label: askFile,
        value: 'export default ask({ id: "x", kind: kinds.fix });\n',
      },
      { label: "red first", value: "unit: expected '+02:00', got 'Z'" },
    ],
    expiresAt: DateTime.makeUnsafe("2026-10-08T10:00:00Z"),
    id: DecisionId.make("dec-000003"),
    openedAt: DateTime.makeUnsafe("2026-10-06T10:00:00Z"),
    project: datekit,
    subject: DecisionSubject.cases.OpenProposal.make({ proposal }),
  };

  const card = (draft: DraftState) =>
    markupOf(
      <DecisionCard
        decision={opening}
        draft={readDraft(draft)}
        now={now}
        onDecide={() => {}}
      />
    );

  /** `showProposal`'s answer for the proposal, its draft at `draft`. */
  const shown = (draft?: DraftState) => {
    const wanted = {
      expiresAt: opening.expiresAt,
      files: [],
      id: proposal,
      openedAt: opening.openedAt,
      project: datekit,
      proposer: Handle.make("lin-h"),
      state: "open" as const,
      want: "formatISO keeps the offset it was given.",
    };

    return {
      files: [],
      proposal: draft === undefined ? wanted : { ...wanted, draft },
    };
  };

  /** The card once the browser's read of the proposal answered with `draft`. */
  const cardRead = (draft?: DraftState) =>
    markupOf(
      <DecisionCard
        decision={opening}
        draft={draftReadOf(AsyncResult.success(shown(draft)))}
        now={now}
        onDecide={() => {}}
      />
    );

  const drafting = DraftState.cases.Drafting.make({
    round: 2,
    startedAt: now,
  });

  const ready = DraftState.cases.Ready.make({
    attempts: 1,
    model: "@cf/moonshotai/kimi-k2.7-code",
    red: { lane: LaneName.make("unit"), signature: "expected '+02:00'" },
    round: 1,
  });

  const failed = DraftState.cases.Failed.make({
    attempts: 3,
    model: "@cf/moonshotai/kimi-k2.7-code",
    refusal: "NotRedFirst",
    round: 2,
  });

  it("shows a file's path as a heading and its content in a pre", () => {
    const markup = card(ready);

    expect(markup).toMatch(new RegExp(`<h4[^>]*>${askFile}</h4>`, "u"));
    expect(markup).toMatch(
      /<pre[^>]*>export default ask\(\{ id: &quot;x&quot;, kind: kinds\.fix \}\);\n<\/pre>/u
    );
    expect(markup).not.toMatch(new RegExp(`<dt[^>]*>${askFile}</dt>`, "u"));
    expect(markup).toMatch(/<dt[^>]*>red first<\/dt>/u);
  });

  it("holds Accept while the proposal's draft is drafting", () => {
    const markup = card(drafting);

    expect(acceptOf(markup)).toContain('disabled=""');
    expect(markup).toContain("Drafting…");
    expect(
      /<button[^>]*data-choice="decline"[^>]*>/u.exec(markup)?.[0]
    ).not.toContain('disabled=""');
  });

  it("holds Accept on the server, until the browser has read the draft", () => {
    const markup = markupOf(
      <DecisionCard decision={opening} now={now} onDecide={() => {}} />
    );

    expect(acceptOf(markup)).toContain('disabled=""');
    expect(markup).toContain("Reading the draft…");
    expect(draftReadOf(AsyncResult.initial(true))).toStrictEqual(
      DraftRead.Unread({ failed: false })
    );
  });

  it("holds Accept, without a spinner, when the browser could not read the draft", () => {
    const read = draftReadOf(AsyncResult.failure(Cause.fail("offline")));

    const markup = markupOf(
      <DecisionCard
        decision={opening}
        draft={read}
        now={now}
        onDecide={() => {}}
      />
    );

    expect(read).toStrictEqual(DraftRead.Unread({ failed: true }));
    expect(acceptOf(markup)).toContain('disabled=""');
    expect(markup).toContain("Draft not read; reload");
    expect(markup).not.toContain("Reading the draft…");
    expect(
      /<button[^>]*data-choice="accept"[^>]*>.*?<\/button>/u.exec(markup)?.[0]
    ).not.toContain('data-slot="spinner"');
  });

  it("offers Accept once the read draft is ready, failed (an earlier ready draft or the want alone), or the proposal is a want alone", () => {
    for (const markup of [cardRead(ready), cardRead(failed), cardRead()]) {
      expect(acceptOf(markup)).not.toContain('disabled=""');
      expect(markup).not.toContain("Reading the draft…");
      expect(markup).not.toContain("Drafting…");
    }
  });

  it("holds Accept, saying why, while the read draft is drafting", () => {
    const markup = cardRead(drafting);

    expect(acceptOf(markup)).toContain('disabled=""');
    expect(markup).toContain("Drafting…");
    expect(markup).not.toContain("Reading the draft…");
  });

  it("offers Accept once the draft is ready", () => {
    const markup = card(ready);

    expect(acceptOf(markup)).not.toContain('disabled=""');
    expect(markup).not.toContain("Drafting…");
  });

  it("shows a check at the repo's root as code too", () => {
    const markup = markupOf(
      <DecisionCard
        decision={{
          ...opening,
          evidence: [
            ...opening.evidence,
            { label: "offset.test.ts", value: "test('keeps +02:00');\n" },
          ],
        }}
        draft={readDraft(ready)}
        now={now}
        onDecide={() => {}}
      />
    );

    expect(markup).toMatch(/<h4[^>]*>offset\.test\.ts<\/h4>/u);
    expect(markup).not.toMatch(/<dt[^>]*>offset\.test\.ts<\/dt>/u);
    expect(markup).toMatch(/<dt[^>]*>want<\/dt>/u);
  });

  it("links the proposal's page", () => {
    expect(card(ready)).toContain('href="/datekit/proposals/prop-000007"');
  });
});

const vellum = ProjectName.make("vellum");

/** A waiver on the answer to escape-attribute-quotes, carrying the answer's diff of the marker's file. */
const waiver: Decision = {
  deciders: [okonkwo],
  default: "decline",
  evidence: [
    {
      label: "patch",
      value: [
        "diff --git a/test/attributes.test.ts b/test/attributes.test.ts",
        "index 1111111..2222222 100644",
        "--- a/test/attributes.test.ts",
        "+++ b/test/attributes.test.ts",
        "@@ -6,4 +6,5 @@",
        ' import { escape } from "../src/escape.ts";',
        " ",
        ' test("quotes", () => {',
        '+test.skip("a quote in a code span", () => {});',
        '   expect(escape(\'"\')).toBe("&quot;");',
        "",
      ].join("\n"),
    },
  ],
  expiresAt: DateTime.makeUnsafe("2026-10-08T10:00:00Z"),
  id: DecisionId.make("dec-000002"),
  openedAt: DateTime.makeUnsafe("2026-10-06T10:00:00Z"),
  project: vellum,
  subject: DecisionSubject.cases.Waiver.make({
    ask: AskId.make("escape-attribute-quotes"),
    at: { line: 9, path: RepoPath.make("test/attributes.test.ts") },
    marker: ".skip(",
    reason: "A quote in a code span needs the escaper's context.",
  }),
};

const pageOf = (
  read: DecisionRead,
  chosen?: Decision,
  failure?: ReactElement
) => {
  const data: DecisionPageData = {
    decision: waiver.id,
    now,
    project: vellum,
    read,
  };

  const files = DecisionRead.guards.Found(read)
    ? Option.match(waiverPatchOf(read.decision), {
        onNone: () => [],
        onSome: (patch) => patchFiles(patch, [], "test"),
      })
    : [];

  return markupOf(
    <DecisionView
      data={data}
      files={files}
      here="/vellum/decisions/dec-000002"
      onDecide={() => {}}
      taken={chosen}
      {...(failure === undefined ? {} : { failure })}
    />
  );
};

const found = DecisionRead.cases.Found.make({
  decision: waiver,
  placed: [],
  soon: true,
});

describe(DecisionView, () => {
  it("titles the page with the subject and says when it expires, its default and whose move it is", () => {
    const text = plainTextOf(pageOf(found));

    expect(text).toContain(
      "Allow .skip( at test/attributes.test.ts:9 in the answer to escape-attribute-quotes"
    );
    expect(text).toContain("Expires in 22 h");
    expect(text).toContain("default: decline");
    expect(text).toContain("your move");
  });

  it("draws a waiver's marker at its line, in the answer's diff of that file", () => {
    const markup = pageOf(found);
    const line = markup.indexOf('data-line="9"');
    const note = markup.indexOf('data-note-line="9"');
    const after = markup.indexOf('data-line="10"');

    expect(markup).toContain('data-file="test/attributes.test.ts"');
    expect(line).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(line);
    expect(after).toBeGreaterThan(note);
    expect(markup.slice(note, after)).toContain('data-marker=".skip("');
  });

  it("says each fact of the evidence once: who pushed the answer, and no second answer or restated escape", () => {
    const text = plainTextOf(
      pageOf(
        DecisionRead.cases.Found.make({
          decision: {
            ...waiver,
            evidence: [
              ...waiver.evidence,
              { label: "answer", value: "bram at 97caa5b (push-97caa5b-bram)" },
              {
                label: "escape",
                value:
                  "test/attributes.test.ts:9: .skip( -- A quote in a code span needs the escaper's context.",
              },
            ],
          },
          placed: [],
          soon: true,
        })
      )
    );

    expect(text).toContain("Pushed by bram at 97caa5b (push-97caa5b-bram)");
    expect(text.match(/\bAnswer\b/gu)).toHaveLength(1);
    expect(text).not.toContain("test/attributes.test.ts:9: .skip(");
  });

  it("says under each choice what it does", () => {
    const markup = pageOf(found);

    expect(markup).toContain('data-consequence="accept"');
    expect(markup).toContain('data-consequence="decline"');
    expect(plainTextOf(markup)).toContain(
      "The answer goes on through the gate with .skip( allowed there, with you as Decided-by."
    );
  });

  it("once decided, shows the record and no choices", () => {
    const markup = pageOf(found, {
      ...waiver,
      decided: { at: now, by: okonkwo, choice: "accept", note: "Split out." },
    });

    expect(markup).not.toContain("data-choice=");
    expect(markup).toContain('data-decided="accept"');
    expect(plainTextOf(markup)).toContain("Accepted");
    expect(plainTextOf(markup)).toContain("Split out.");
  });

  it("says why a choice came back refused, before the choices", () => {
    const closed = new DecisionClosed({ decision: waiver.id });

    const markup = pageOf(
      found,
      undefined,
      <ProposalFailure
        cause={Cause.fail(closed)}
        doing="take this decision"
        here="/vellum/decisions/dec-000002"
      />
    );

    const refusal = markup.indexOf('data-refusal="DecisionClosed"');

    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(markup.indexOf("data-choices="));
  });

  it("signed out, says what a decision is and who takes it, with no choices and no evidence", () => {
    const markup = pageOf(DecisionRead.cases.SignedOut.make({}));
    const text = plainTextOf(markup);

    expect(markup).not.toContain("data-choice=");
    expect(markup).not.toContain(".skip(");
    expect(text).toContain("A decider takes it on their Today");
    expect(markup).toContain('href="/vellum/people"');
    expect(text).toContain(`${Brand.cli} today --project vellum`);
  });
});
