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
import type { ClaimControl } from "../src/features/shared/facts.tsx";
import { ask, landing, now, suite, verdictOf } from "./ask-fixtures.ts";
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

const ignore = () => {};

const control = (overrides: Partial<ClaimControl> = {}): ClaimControl => ({
  busy: false,
  here: "/oscabriel/datekit/asks/parse-iso-week",
  onClaim: ignore,
  onRelease: ignore,
  signedIn: true,
  ...overrides,
});

const actions = (markup: string, action: string) =>
  tagsWith(markup, "data-action").filter((tag) =>
    tag.includes(`data-action="${action}"`)
  );

const remote =
  "https://git.example.dev/oscabriel/datekit--parse-iso-week--tamsin.git";

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

  it("tells the claimant they hold it, with no command to run", () => {
    const text = textOf(
      <ClaimFacts claimant={tamsin} now={now} viewer={tamsin} />
    );

    expect(text).toContain("You hold this claim");
    expect(text).not.toContain(`${Brand.cli} check`);
    expect(text).not.toContain("git push");
  });

  it("gives the claimant their fork's address to push to, copyable, and a way to release it", () => {
    const markup = markupOf(
      <ClaimFacts
        claimant={tamsin}
        control={control({ remote })}
        now={now}
        viewer={tamsin}
      />
    );

    expect(textIn(markup)).toContain("Push your answer to your fork");
    expect(actions(markup, "release")).toHaveLength(1);
    expect(markup).toContain('aria-label="Copy the fork&#x27;s address"');
    expect(textIn(markup)).toContain(remote);
  });

  it("offers no release to someone who does not hold the claim", () => {
    const markup = markupOf(
      <ClaimFacts
        claimant={tamsin}
        control={control({ remote })}
        now={now}
        viewer={Handle.make("okonkwo")}
      />
    );

    expect(markup).not.toContain('data-action="release"');
    expect(markup).not.toContain(remote);
  });

  it("holds its button while a release is on its way, and says why one failed", () => {
    const markup = markupOf(
      <ClaimFacts
        claimant={tamsin}
        control={control({ busy: true, failure: <p>NotClaimed</p> })}
        now={now}
        viewer={tamsin}
      />
    );

    expect(attributeOf(actions(markup, "release")[0] ?? "", "disabled")).toBe(
      ""
    );
    expect(textIn(markup)).toContain("Releasing…");
    expect(textIn(markup)).toContain("NotClaimed");
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

  it("sets each entry as a label over its value, the block shape every other block has", () => {
    const markup = markupOf(
      <ProvenanceFacts entries={verdictProvenance(verdictOf(checking), now)} />
    );

    const terms = [
      ...markup.matchAll(/<dt\b[^>]*class="(?<classes>[^"]*)"/gu),
    ].map((match) => match.groups?.classes ?? "");

    const entries = (
      markup.match(/<div\b[^>]*data-provenance="[^"]*"[^>]*>/gu) ?? []
    ).map(
      (tag) => /class="(?<classes>[^"]*)"/u.exec(tag)?.groups?.classes ?? ""
    );

    expect(entries).toHaveLength(7);
    expect(
      entries.every((classes) => classes.split(" ").includes("flex-col"))
    ).toBeTruthy();
    expect(terms.some((classes) => /\bw-\d+\b/u.test(classes))).toBeFalsy();
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
        "Maintainer",
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
  it("repeats the status line, with no next command", () => {
    const text = textOf(
      <StateFacts subject={{ kind: "answer", outcome: checking }} />
    );

    expect(text).toContain("Checking at the checks stage");
    expect(text).not.toContain(Brand.cli);
  });
});

describe(TakeItFacts, () => {
  it("says who may take an ask held for newcomers, with no command to clone, claim or check", () => {
    const text = textOf(
      <TakeItFacts
        ask={{ ...ask, mentor: Handle.make("okonkwo"), reserve: "newcomers" }}
      />
    );

    expect(text).toContain("Held for newcomers, mentored by okonkwo");
    expect(text).not.toContain("git clone");
    expect(text).not.toContain(Brand.cli);
  });

  it("claims it with a button for a signed-in reader", () => {
    const markup = markupOf(<TakeItFacts ask={ask} control={control()} />);

    expect(actions(markup, "claim")).toHaveLength(1);
    expect(textIn(markup)).toContain("Claim it");
    expect(markup).not.toContain("/auth/signin");
  });

  it("asks a signed-out reader to sign in and come back, with no button", () => {
    const markup = markupOf(
      <TakeItFacts ask={ask} control={control({ signedIn: false })} />
    );

    expect(markup).not.toContain('data-action="claim"');
    expect(markup).toContain(
      'href="/auth/signin?return=%2Foscabriel%2Fdatekit%2Fasks%2Fparse-iso-week"'
    );
    expect(textIn(markup)).toContain("Sign in to claim it");
  });

  it("draws no control at all when the page hands it none", () => {
    const markup = markupOf(<TakeItFacts ask={ask} />);

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("/auth/signin");
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
