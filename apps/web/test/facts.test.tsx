/**
 * The inspector's fact blocks: typed facts under a label, never prose the
 * page already says. A claim never shows a deadline (no read carries one),
 * agents sit below the line that says they are not credit, long hashes are
 * shortened with the whole value kept, and the gate marks where an answer
 * stands.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Glob } from "@repo/protocol/domain/common";
import { Outcome } from "@repo/protocol/domain/outcome";
import { AreaName, CommitSha, Handle } from "@repo/protocol/ids";
import { DateTime, Effect } from "effect";

import {
  ClaimFacts,
  CreditFacts,
  FactBlock,
  GateFacts,
  HeldBackFacts,
  ProvenanceFacts,
  StateFacts,
  TakeItFacts,
  TerritoryFacts,
  verdictProvenance,
} from "../src/features/shared/facts.tsx";
import {
  ask,
  askId,
  landing,
  now,
  project,
  suite,
  verdictOf,
} from "./ask-fixtures.ts";
import {
  allInOrder,
  attributeOf,
  markupOf,
  tagsWith,
  textIn,
  textOf,
} from "./markup.ts";
import { renderAt } from "./render.tsx";

const tamsin = Handle.make("tamsin");

const checking = Outcome.cases.Checking.make({ stage: "checks" });

describe(FactBlock, () => {
  it("heads its content with its label", () => {
    const text = textOf(<FactBlock label="Posture">Open</FactBlock>);

    expect(allInOrder(text, ["Posture", "Open"])).toBeTruthy();
  });
});

describe(ClaimFacts, () => {
  it("names who holds the claim and when they last pushed, and never a deadline", () => {
    const text = textOf(
      <ClaimFacts
        claimant={tamsin}
        lastPush={{
          at: DateTime.subtract(now, { hours: 2 }),
          head: CommitSha.make("b".repeat(40)),
        }}
        now={now}
      />
    );

    expect(text).toContain("Claimed by tamsin");
    expect(text).toContain("2 h ago");
    expect(text).not.toMatch(/until|deadline|expires|lapses|left/iu);
  });

  it("tells the claimant they hold it, with what they run next", () => {
    const text = textOf(
      <ClaimFacts claimant={tamsin} now={now} viewer={tamsin} />
    );

    expect(text).toContain("You hold this claim");
    expect(text).toContain(`${Brand.cli} check`);
    expect(text).toContain("git push");
  });
});

describe(CreditFacts, () => {
  it("puts the agents below the line that says they are not credit", () => {
    const text = textOf(
      <CreditFacts
        assisted={landing.assisted}
        credits={landing.credits}
        heldBack={landing.heldBackTrailer}
      />
    );

    const label = text.indexOf("not credit");

    expect(text.indexOf("Asked-by: ines-v")).toBeLessThan(label);
    expect(text.indexOf("Assisted-by:")).toBeGreaterThan(label);
  });
});

describe(ProvenanceFacts, () => {
  it("shortens a 64-hex value and keeps the whole of it in its title", () => {
    const markup = markupOf(
      <ProvenanceFacts entries={verdictProvenance(verdictOf(checking), now)} />
    );

    const patch = "c".repeat(64);

    expect(markup).toContain(`title="${patch}"`);
    expect(markup).toContain(`>${"c".repeat(7)}<`);
    expect(markup.split(patch).length - 1).toBeLessThanOrEqual(3);
  });

  it("keeps each entry's copy button inside its value, so the list holds only terms and values", () => {
    const markup = markupOf(
      <ProvenanceFacts entries={verdictProvenance(verdictOf(checking), now)} />
    );

    const [list] = /<dl\b.*<\/dl>/su.exec(markup) ?? [""];

    const outside = list
      .replaceAll(/<dt\b.*?<\/dt>/gsu, "")
      .replaceAll(/<dd\b.*?<\/dd>/gsu, "");

    expect(list).toContain("<button");
    expect(outside).not.toContain("<button");
  });

  it("shortens a hash named by its algorithm, keeping the algorithm", () => {
    const markup = markupOf(
      <ProvenanceFacts entries={[{ label: "Suite", value: suite }]} />
    );

    expect(markup).toContain(`title="${suite}"`);
    expect(markup).toContain(">sha256:4f2a4f…<");
  });
});

describe(GateFacts, () => {
  it("marks the stage an answer stands at as the current step", () => {
    const markup = markupOf(<GateFacts outcome={checking} stage="checks" />);

    const current = tagsWith(markup, "aria-current");

    expect(current).toHaveLength(1);
    expect(attributeOf(current[0] ?? "", "aria-current")).toBe("step");
    expect(attributeOf(current[0] ?? "", "data-stage")).toBe("checks");
  });

  it("lists the seven stages in the order of their cost on a project", () => {
    const text = textOf(<GateFacts />);

    expect(
      allInOrder(text, [
        "Parse",
        "Shape",
        "Merge",
        "Cheap",
        "Checks",
        "Held-back",
        "Decider",
      ])
    ).toBeTruthy();
  });
});

describe(HeldBackFacts, () => {
  it("gives one sealed line per area, or says nothing is held back", () => {
    const some = markupOf(
      <HeldBackFacts
        areas={[{ area: AreaName.make("export"), detail: "7 sealed checks" }]}
      />
    );

    expect(textOf(<HeldBackFacts areas={[]} />)).toContain("Nothing held back");
    expect(some).toContain('data-area="export"');
    expect(some).toContain("text-sealed");
  });
});

describe(StateFacts, () => {
  it("repeats the status line and gives the next command", () => {
    const text = textOf(
      <StateFacts
        command={`${Brand.cli} status`}
        subject={{ kind: "answer", outcome: checking }}
      />
    );

    expect(text).toContain("Checking at the checks stage");
    expect(text).toContain(`${Brand.cli} status`);
  });
});

describe(TakeItFacts, () => {
  it("says who may take an ask held for newcomers, then clone, claim and check in order", () => {
    const text = textOf(
      <TakeItFacts
        ask={{ ...ask, mentor: Handle.make("okonkwo"), reserve: "newcomers" }}
        platformUrl="https://platform.example"
      />
    );

    expect(text).toContain("Held for newcomers, mentored by okonkwo");
    expect(
      allInOrder(text, [
        `git clone https://platform.example/${project}.git`,
        `${Brand.cli} claim ${askId} --project ${project}`,
        `${Brand.cli} check`,
      ])
    ).toBeTruthy();
  });
});

describe(TerritoryFacts, () => {
  it.effect(
    "links the territory to its tree and a red-first check to its file",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit",
          <TerritoryFacts ask={ask} />
        );

        expect(markup).toContain(
          'href="/oscabriel/datekit/tree/main/packages/parse"'
        );
        expect(markup).toContain(
          'href="/oscabriel/datekit/blob/main/test/parse-week.test.ts"'
        );
        expect(markup).toContain("red first");
      })
  );

  it.effect(
    "names the paths of a one-package repo's territory, and the whole project only when it covers every path",
    () =>
      Effect.gen(function* () {
        const paths = yield* renderAt(
          "/oscabriel/datekit",
          <TerritoryFacts
            ask={{
              ...ask,
              territory: { module: ".", paths: [Glob.make("src/parse.ts")] },
            }}
          />
        );

        const whole = yield* renderAt(
          "/oscabriel/datekit",
          <TerritoryFacts
            ask={{
              ...ask,
              territory: { module: ".", paths: [Glob.make("**")] },
            }}
          />
        );

        expect(textIn(paths)).toContain("src/parse.ts");
        expect(textIn(paths)).not.toContain("The whole project");
        expect(whole).toContain('href="/oscabriel/datekit/tree/main"');
      })
  );
});
