/**
 * A proposal's page, rendered to HTML with `react-dom/server` from a
 * `showProposal` answer decoded with the protocol's own schema: the want and
 * its proposer, where the platform's draft stands, the drafted files, the
 * red-first evidence and who drafted it, the last refusal when it failed,
 * "Draft again" for the proposer or a decider while it is open and not
 * drafting, and the way to its decision when one is open.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { DRAFT_ROUNDS } from "@repo/project/draft-runs";
import { Client, Contracts, ShowProposal } from "@repo/protocol/contracts";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { DraftState } from "@repo/protocol/domain/proposal";
import { DecisionId, Handle, LaneName, ProjectName } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { UnknownProject, UnknownProposal } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Cause, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";

import { projectTodayAtom } from "../src/client/proposal.ts";
import { keysOf } from "../src/client/watch.ts";
import { ProposalFailure } from "../src/features/proposal/failure.tsx";
import {
  DRAFT_ATTEMPTS,
  ProposalView,
} from "../src/features/proposal/proposal-view.tsx";
import { readProposal } from "../src/routes/$project/proposals/$proposal.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";
import { markupOf, plainText } from "./ask-fixtures.ts";

const datekit = ProjectName.make("datekit");

const decodeShown = Schema.decodeUnknownSync(ShowProposal.successSchema);

const model = "@cf/moonshotai/kimi-k2.7-code";

const askFile = `${Brand.configDir}/asks/format-keeps-offset.ask.ts`;

const testFile = "src/format.offset.test.ts";

type Shown = typeof ShowProposal.successSchema.Type;

/** A proposal with no draft yet, as `showProposal` answers it, holding `files`. */
const shownWith = (files: readonly string[]): Shown =>
  decodeShown({
    files: files.map((path) => ({ content: `// ${path}\n`, path })),
    proposal: {
      expiresAt: "2026-10-21T09:00:00.000Z",
      files,
      id: "prop-000007",
      openedAt: "2026-10-07T09:00:00.000Z",
      project: "datekit",
      proposer: "lin-h",
      state: "open",
      want: "formatISO keeps the offset it was given.",
    },
  });

/** `base` with its proposal's draft at `draft`. */
const withDraft = (base: Shown, draft: DraftState): Shown => ({
  ...base,
  proposal: { ...base.proposal, draft },
});

const drafting = withDraft(
  shownWith([]),
  DraftState.cases.Drafting.make({
    round: 1,
    startedAt: DateTime.makeUnsafe("2026-10-07T09:00:01Z"),
  })
);

const ready = withDraft(
  shownWith([askFile, testFile]),
  DraftState.cases.Ready.make({
    attempts: 2,
    model,
    red: {
      lane: LaneName.make("unit"),
      signature: "expected '+02:00', got 'Z'",
    },
    round: 1,
  })
);

const failed = withDraft(
  shownWith([]),
  DraftState.cases.Failed.make({
    attempts: 3,
    model,
    refusal: "NotRedFirst",
    round: 2,
  })
);

const decision = DecisionId.make("dec-000003");

const view = (
  { files, proposal }: Shown,
  linked: Option.Option<DecisionId> = Option.none()
) =>
  markupOf(
    <ProposalView
      decision={linked}
      files={files}
      mayRedraft
      project={datekit}
      proposal={proposal}
    />
  );

const DRAFT_AGAIN = /<button[^>]*>[^<]*Draft again/u;

describe(ProposalView, () => {
  it("shows the want and the proposer", () => {
    const text = plainText(view(drafting));

    expect(text).toContain("formatISO keeps the offset it was given.");
    expect(text).toContain("lin-h");
  });

  it("while drafting, shows the spinner and no Draft again", () => {
    const markup = view(drafting);

    expect(markup).toContain('data-slot="spinner"');
    expect(plainText(markup)).toContain("Drafting");
    expect(markup).not.toMatch(DRAFT_AGAIN);
  });

  it("while drafting with a note, shows the note the round was asked with", () => {
    const noted = withDraft(
      shownWith([]),
      DraftState.cases.Drafting.make({
        note: "only the parser",
        round: 2,
        startedAt: DateTime.makeUnsafe("2026-10-07T09:00:01Z"),
      })
    );

    expect(plainText(view(noted))).toContain("Note: only the parser");
    expect(plainText(view(drafting))).not.toContain("Note:");
  });

  it("once ready, shows both files, the red-first run, who drafted it and its decision", () => {
    const markup = view(ready, Option.some(decision));
    const text = plainText(markup);

    expect(text).toContain(askFile);
    expect(text).toContain(testFile);
    expect(text).toContain(
      "fails twice the same way in lane unit: expected '+02:00', got 'Z'"
    );
    expect(text).toContain(`drafted by ${model}, attempt 2 of 3`);
    expect(markup).toContain('href="/datekit/decisions/dec-000003"');
  });

  it("once ready, shows no spinner", () => {
    expect(view(ready)).not.toContain('data-slot="spinner"');
  });

  it("once failed, shows the last refusal's headline and Draft again", () => {
    const markup = view(failed);

    expect(plainText(markup)).toContain("NotRedFirst");
    expect(markup).toMatch(DRAFT_AGAIN);
  });

  it("failed after a ready round, still shows that round's files as a draft a decider can accept", () => {
    const kept = withDraft(
      ready,
      DraftState.cases.Failed.make({
        attempts: 3,
        model,
        refusal: "NotRedFirst",
        round: 2,
      })
    );

    const text = plainText(view(kept));

    expect(text).toContain(askFile);
    expect(text).toContain(testFile);
    expect(text).toContain("An earlier round's ready draft");
    expect(plainText(view(ready))).not.toContain("An earlier round");
  });

  it("offers Draft again only to the proposer or a decider", () => {
    const markup = markupOf(
      <ProposalView
        decision={Option.none()}
        files={[]}
        mayRedraft={false}
        project={datekit}
        proposal={failed.proposal}
      />
    );

    expect(markup).not.toMatch(DRAFT_AGAIN);
  });

  it("counts attempts out of the platform's own number of draft attempts", () => {
    expect(DRAFT_ATTEMPTS).toBe(DRAFT_ROUNDS);
  });

  it("once accepted, offers no button", () => {
    const accepted: Shown = {
      ...ready,
      proposal: { ...ready.proposal, state: "accepted" },
    };

    const markup = view(accepted);

    expect(plainText(markup)).toContain("accepted");
    expect(markup).not.toContain("<button");
  });
});

describe("a failed call on the proposal page", () => {
  const here = "/datekit/proposals/prop-000007";

  it("with no session, asks to sign in and come back to the page", () => {
    const markup = markupOf(
      <ProposalFailure
        cause={Cause.fail(new Unauthenticated({}))}
        doing="draft it again"
        here={here}
      />
    );

    expect(markup).toContain(
      `href="/auth/signin?${new URLSearchParams({ return: here }).toString()}"`
    );
    expect(plainText(markup)).toContain("Sign in");
    expect(plainText(markup)).not.toContain("Today is a decider's page");
  });

  it("refused, shows the refusal", () => {
    const markup = markupOf(
      <ProposalFailure
        cause={Cause.fail(new UnknownProposal({ proposal: ready.proposal.id }))}
        doing="draft it again"
        here={here}
      />
    );

    expect(plainText(markup)).toContain("UnknownProposal");
    expect(markup).not.toContain("/auth/signin");
  });
});

/** A platform that knows datekit's prop-000007 only, counting what it is asked. */
const platformHandlers = (
  asked: Ref.Ref<{ proposal: number; today: number }>
) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("showProposal", ({ project, proposal }) =>
      Effect.gen(function* () {
        yield* Ref.update(asked, (seen) => ({
          ...seen,
          proposal: seen.proposal + 1,
        }));

        if (project !== datekit) {
          return yield* new UnknownProject({ project });
        }

        if (proposal !== ready.proposal.id) {
          return yield* new UnknownProposal({ proposal });
        }

        return ready;
      })
    ),
    Contracts.toLayerHandler("today", () =>
      Ref.update(asked, (seen) => ({ ...seen, today: seen.today + 1 })).pipe(
        Effect.as({
          budget: { finishes: 0, total: 5, used: 0 },
          decider: Handle.make("okonkwo"),
          decisions: [],
          expiringSoon: [],
          newcomers: [],
          overflow: 0,
          unattended: [],
        })
      )
    ),
    asTester
  );

const counted = () => Ref.make({ proposal: 0, today: 0 });

describe(readProposal, () => {
  it.effect("reads the proposal and its files, encoded for the page", () =>
    Effect.gen(function* () {
      const asked = yield* counted();

      const read = yield* readProposal("datekit", "prop-000007").pipe(
        Effect.provide(
          Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
            Layer.provide(platformHandlers(asked))
          )
        )
      );

      expect(decodeShown(read).files.map(({ path }) => path)).toStrictEqual([
        askFile,
        testFile,
      ]);
    })
  );

  it.effect(
    "is a not-found for a proposal or a project the platform does not know",
    () =>
      Effect.gen(function* () {
        const asked = yield* counted();

        const platform = Layer.effect(
          Client,
          RpcTest.makeClient(Contracts)
        ).pipe(Layer.provide(platformHandlers(asked)));

        const noProposal = yield* Effect.flip(
          readProposal("datekit", "prop-000099").pipe(Effect.provide(platform))
        );

        const noProject = yield* Effect.flip(
          readProposal("burrow", "prop-000007").pipe(Effect.provide(platform))
        );

        expect(isNotFound(noProposal)).toBeTruthy();
        expect(isNotFound(noProject)).toBeTruthy();
        expect((yield* Ref.get(asked)).proposal).toBe(2);
      })
  );

  it.effect(
    "is a not-found, asking nothing, for an address that names no proposal",
    () =>
      Effect.gen(function* () {
        const asked = yield* counted();

        const refused = yield* Effect.flip(
          readProposal("datekit", "not a proposal").pipe(
            Effect.provide(
              Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
                Layer.provide(platformHandlers(asked))
              )
            )
          )
        );

        expect(isNotFound(refused)).toBeTruthy();
        expect((yield* Ref.get(asked)).proposal).toBe(0);
      })
  );
});

/** Lets the atoms' fibers run until `done` holds, or long enough that it would have. */
const runUntil = (done: Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(
    Effect.andThen(done),
    Effect.repeat({ times: 200, until: (held) => held })
  );

describe("the proposal page's Today", () => {
  it.effect(
    "reads again when the proposal's draft settles, so its new decision is linked",
    () =>
      Effect.gen(function* () {
        const asked = yield* counted();

        // One browser tab whose `ContractsClient` reaches the stub platform in process.
        const registry = yield* Effect.acquireRelease(
          Effect.sync(() =>
            AtomRegistry.make({
              initialValues: [
                Atom.initialValue(
                  ContractsClient.runtime.layer,
                  Layer.effect(
                    ContractsClient,
                    RpcTest.makeClient(webContracts, { flatten: true })
                  ).pipe(
                    Layer.provide(platformHandlers(asked)),
                    Layer.provideMerge(Reactivity.layer)
                  )
                ),
              ],
            })
          ),
          (made) =>
            Effect.sync(() => {
              made.dispose();
            })
        );

        const today = projectTodayAtom(datekit);

        registry.mount(today);
        yield* AtomRegistry.getResult(registry, today, {
          suspendOnWaiting: true,
        });

        // What the watch does on `ProposalDrafted` (`keysOf` in `watch.ts`).
        yield* AtomRegistry.getResult(
          registry,
          ContractsClient.runtime.atom(
            Reactivity.invalidate(
              keysOf(
                datekit,
                ProjectEvent.cases.ProposalDrafted.make({
                  at: DateTime.makeUnsafe("2026-10-07T09:05:00Z"),
                  proposal: ready.proposal.id,
                  ready: true,
                  seq: 4,
                })
              )
            )
          ),
          { suspendOnWaiting: true }
        );

        expect(
          yield* runUntil(
            Ref.get(asked).pipe(Effect.map(({ today: seen }) => seen > 1))
          )
        ).toBeTruthy();
      })
  );
});
