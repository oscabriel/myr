/**
 * A landing's credit, as the commit carries it: the trailers in the order
 * of their roles, each person linked, the held-back commitment on its own
 * line and the agents apart; and its one-line form for a row, which names
 * the people by role and never the agents.
 */
import { describe, expect, it } from "@effect/vitest";
import { Handle } from "@repo/protocol/ids";
import { Schema } from "effect";

import {
  CompactCredit,
  CreditTrailers,
} from "../src/features/shared/credits.tsx";
import { allInOrder, markupOf, textOf } from "./markup.ts";

const handle = Schema.decodeSync(Handle);

const credits = [
  { handle: handle("bram"), role: "Signed-off-by" },
  { handle: handle("ines"), role: "Asked-by" },
] as const;

const assisted = [{ harness: "claude-code", verified: true }] as const;

describe(CreditTrailers, () => {
  it("lists credit in the order of the trailer roles, as the landing commit does", () => {
    const text = textOf(
      <CreditTrailers assisted={assisted} credits={credits} />
    );

    expect(
      allInOrder(text, ["Asked-by: ines", "Signed-off-by: bram"])
    ).toBeTruthy();
  });

  it("links each credited person to their page", () => {
    const markup = markupOf(<CreditTrailers assisted={[]} credits={credits} />);

    expect(markup).toContain('href="/people/ines"');
    expect(markup).toContain('href="/people/bram"');
  });

  it("shows Assisted-by apart, in a list labelled as not credit", () => {
    const text = textOf(
      <CreditTrailers assisted={assisted} credits={credits} />
    );

    const label = text.indexOf("not credit");
    const assistedAt = text.indexOf("Assisted-by: claude-code (verified)");

    expect(label).toBeGreaterThan(text.indexOf("Signed-off-by: bram"));
    expect(assistedAt).toBeGreaterThan(label);
    expect(text.indexOf("Assisted-by")).toBe(assistedAt);
  });

  it("names an agent's model the way the trailer does", () => {
    const text = textOf(
      <CreditTrailers
        assisted={[{ harness: "pi", model: "opus-4", verified: false }]}
        credits={credits}
      />
    );

    expect(text).toContain("Assisted-by: pi:opus-4 (claimed)");
  });

  it("shows a held-back trailer as its own Held-back line", () => {
    const text = textOf(
      <CreditTrailers
        assisted={[]}
        credits={credits}
        heldBack="7/7 @ sha256:4f2a"
      />
    );

    expect(text).toContain("Held-back: 7/7 @ sha256:4f2a");
  });

  it("leaves out the agents list when no agent helped", () => {
    const text = textOf(<CreditTrailers assisted={[]} credits={credits} />);

    expect(text).not.toContain("not credit");
  });
});

describe(CompactCredit, () => {
  it("says who took part in one line, by role in trailer order", () => {
    expect(textOf(<CompactCredit credits={credits} />)).toBe(
      "Asked by ines · answered by bram"
    );
  });

  it("names everyone in a role, and each role once", () => {
    expect(
      textOf(
        <CompactCredit
          credits={[
            { handle: handle("okonkwo"), role: "Decided-by" },
            { handle: handle("bram"), role: "Signed-off-by" },
            { handle: handle("tamsin"), role: "Signed-off-by" },
            { handle: handle("ines"), role: "Asked-by" },
          ]}
        />
      )
    ).toBe("Asked by ines · answered by bram and tamsin · decided by okonkwo");
  });

  it("links each person to their page", () => {
    const markup = markupOf(<CompactCredit credits={credits} />);

    expect(markup).toContain('href="/people/ines"');
    expect(markup).toContain('href="/people/bram"');
  });

  it("never names an agent, and says nothing when nobody is credited", () => {
    expect(textOf(<CompactCredit credits={credits} />)).not.toContain(
      "Assisted"
    );
    expect(markupOf(<CompactCredit credits={[]} />)).toBe("");
  });
});
