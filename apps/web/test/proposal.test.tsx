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
import { ShowProposal } from "@repo/protocol/contracts";
import { DraftState } from "@repo/protocol/domain/proposal";
import { DecisionId, LaneName, ProjectName } from "@repo/protocol/ids";
import { DateTime, Option, Schema } from "effect";

import { ProposalView } from "../src/features/proposal/proposal-view.tsx";
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
