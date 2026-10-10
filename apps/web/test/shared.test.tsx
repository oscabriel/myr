/**
 * The pieces every page repeats, rendered to HTML with `react-dom/server`
 * (no DOM library): a refusal reads as `git push` printed it, credit
 * trailers read as the landing commit carries them, and an answer's outcome
 * and stages read the same on every page that shows one.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import {
  AskId,
  DecisionId,
  Handle,
  LandedSha,
  RepoPath,
} from "@repo/protocol/ids";
import { OutOfScope, Weakened } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { DateTime, Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandLine } from "../src/features/shared/command.tsx";
import { CreditTrailers } from "../src/features/shared/credits.tsx";
import { EmptyState } from "../src/features/shared/empty.tsx";
import { HandleLink } from "../src/features/shared/handle.tsx";
import {
  PageShell,
  SiteFooter,
  SiteHeader,
} from "../src/features/shared/layout.tsx";
import { OutcomeView, StageStrip } from "../src/features/shared/outcome.tsx";
import { PostureBadge } from "../src/features/shared/posture.tsx";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import { themeColors } from "../src/features/shared/theme.ts";
import { When } from "../src/features/shared/time.tsx";

import styles from "../src/styles.css?raw";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    );

/** Where each of `parts` starts in `text`, each searched after the one before; -1 once one is missing. */
const positionsInOrder = (text: string, parts: readonly string[]) => {
  const positions: number[] = [];
  let from = 0;

  for (const part of parts) {
    const at = from < 0 ? -1 : text.indexOf(part, from);

    positions.push(at);
    from = at < 0 ? -1 : at + part.length;
  }

  return positions;
};

/** Each `<li>` that names a stage, as `[stage, state]`. */
const stagesOf = (element: ReactElement) =>
  [...markupOf(element).matchAll(/<li\b[^>]*>/gu)].flatMap(([tag]) => {
    const stage = /data-stage="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
    const state = /data-state="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

    return stage === undefined || state === undefined ? [] : [[stage, state]];
  });

const handle = Schema.decodeSync(Handle);

const repoPath = Schema.decodeSync(RepoPath);

const outOfScope = new OutOfScope({
  paths: [repoPath("packages/format/src/format.ts"), repoPath("README.md")],
});

const weakened = new Weakened({
  at: { line: 12, path: repoPath("packages/parse/test/parse.test.ts") },
  weakening: { marker: ".skip(" },
});

const refusals = [outOfScope, weakened] as const;

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

describe(RefusalView, () => {
  it("shows every line explain gives, in order, each refusal's tag, and then its next command", () => {
    const text = textOf(<RefusalView refusals={refusals} />);

    const expected = refusals.flatMap((refusal) => [
      ...explain([refusal]).map((line) => line.trim()),
      refusal.next,
    ]);

    expect(
      positionsInOrder(text, expected).every((at) => at >= 0)
    ).toBeTruthy();
    expect(text).toContain("OutOfScope");
    expect(text).toContain("Weakened");

    for (const refusal of refusals) {
      expect(refusal.next.startsWith(`${Brand.cli} `)).toBeTruthy();
    }
  });

  it("points at the path and line of a refusal that has one", () => {
    const text = textOf(<RefusalView refusals={[weakened]} />);

    expect(text).toContain("packages/parse/test/parse.test.ts:12");
  });

  it("says whether retrying can help, without rewording the refusal", () => {
    const markup = markupOf(<RefusalView refusals={refusals} />);

    expect(markup).toContain('data-refusal="OutOfScope"');
    expect(markup).toContain('data-retryable="false"');
  });
});

describe(CreditTrailers, () => {
  const credits = [
    { handle: handle("bram"), role: "Signed-off-by" },
    { handle: handle("ines"), role: "Asked-by" },
  ] as const;

  const assisted = [{ harness: "claude-code", verified: true }] as const;

  it("lists credit in the order of the trailer roles, as the landing commit does", () => {
    const text = textOf(
      <CreditTrailers assisted={assisted} credits={credits} />
    );

    expect(
      positionsInOrder(text, ["Asked-by: ines", "Signed-off-by: bram"]).every(
        (at) => at >= 0
      )
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

describe(PostureBadge, () => {
  it("shows the label it is given and keeps the posture as a data attribute", () => {
    const element = (
      <PostureBadge
        label="Open · sealed checks in parser"
        posture="openWithSealedEvidence"
      />
    );

    expect(textOf(element)).toBe("Open · sealed checks in parser");
    expect(markupOf(element)).toContain(
      'data-posture="openWithSealedEvidence"'
    );
  });
});

describe(HandleLink, () => {
  it("links a handle to that person's page", () => {
    expect(markupOf(<HandleLink handle={handle("ines-v")} />)).toMatch(
      /^<a\b[^>]*\bhref="\/people\/ines-v"[^>]*>ines-v<\/a>$/u
    );
  });
});

describe(OutcomeView, () => {
  const sha = Schema.decodeSync(LandedSha)(
    "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"
  );

  const waiting = [
    [Outcome.cases.Checking.make({ stage: "checks" }), "Checking", "checks"],
    [
      Outcome.cases.AwaitingDecision.make({
        decision: Schema.decodeSync(DecisionId)("dec-000001"),
      }),
      "Waiting on decision",
      "dec-000001",
    ],
    [
      Outcome.cases.AwaitingFinish.make({ decider: handle("okonkwo") }),
      "waiting for a decider's finish",
      "okonkwo",
    ],
    [
      Outcome.cases.WaitingOnParent.make({
        ask: Schema.decodeSync(AskId)("split-format"),
      }),
      "waiting for",
      "split-format",
    ],
  ] as const;

  it.each(waiting)(
    "reads %o as waiting, never as a refusal",
    (outcome, wording, names) => {
      const element = <OutcomeView outcome={outcome} />;

      expect(markupOf(element)).toContain(`data-outcome="${outcome._tag}"`);
      expect(markupOf(element)).toContain('data-state="waiting"');
      expect(textOf(element)).toContain(wording);
      expect(textOf(element)).toContain(names);
    }
  );

  it("reads a landing as final, with its short sha", () => {
    const element = (
      <OutcomeView outcome={Outcome.cases.Landed.make({ sha })} />
    );

    expect(markupOf(element)).toContain('data-state="final"');
    expect(textOf(element)).toContain("Landed as 9b1c3e5");
  });

  it("shows a refusal through RefusalView", () => {
    const element = (
      <OutcomeView outcome={Outcome.cases.Refused.make({ refusals })} />
    );

    expect(markupOf(element)).toContain('data-state="final"');
    expect(markupOf(element)).toContain(
      markupOf(<RefusalView refusals={refusals} />)
    );
  });
});

const strip = (stage: StageName, outcome: Outcome) =>
  stagesOf(<StageStrip outcome={outcome} stage={stage} />);

describe(StageStrip, () => {
  it("marks the stages before the current one passed, and the rest pending", () => {
    expect(
      strip("checks", Outcome.cases.Checking.make({ stage: "checks" }))
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "current"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("marks the stage that refused, and leaves the rest unreached", () => {
    expect(
      strip("shape", Outcome.cases.Refused.make({ refusals }))
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "refused"],
      ["merge", "pending"],
      ["cheap", "pending"],
      ["checks", "pending"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("marks a landed answer's later stages as not needed", () => {
    const sha = Schema.decodeSync(LandedSha)(
      "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"
    );

    expect(strip("checks", Outcome.cases.Landed.make({ sha }))).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "skipped"],
      ["human", "skipped"],
    ]);
  });
});

describe(When, () => {
  it("says how far ahead a time is", () => {
    const at = DateTime.add(now, { hours: 3 });
    const element = <When at={at} now={now} />;

    expect(textOf(element)).toBe("in 3 h");
    expect(markupOf(element)).toContain('dateTime="2026-10-07T15:00:00.000Z"');
  });

  it("says how long ago a time was", () => {
    expect(
      textOf(<When at={DateTime.subtract(now, { days: 2 })} now={now} />)
    ).toBe("2 d ago");
    expect(
      textOf(<When at={DateTime.subtract(now, { minutes: 5 })} now={now} />)
    ).toBe("5 min ago");
  });

  it("says now for anything under a minute either way", () => {
    expect(
      textOf(<When at={DateTime.add(now, { seconds: 20 })} now={now} />)
    ).toBe("now");
  });
});

describe(CommandLine, () => {
  it("shows the command, with a button that copies it", () => {
    const command = `${Brand.cli} claim fix-week-start`;
    const element = <CommandLine command={command} />;

    expect(textOf(element)).toContain(command);
    expect(markupOf(element)).toMatch(/<button\b[^>]*>.*Copy.*<\/button>/u);
  });
});

describe(EmptyState, () => {
  it("says what is empty and the command that would change it", () => {
    const command = `${Brand.cli} ask open`;
    const text = textOf(<EmptyState command={command} title="No open asks" />);

    expect(text).toContain("No open asks");
    expect(text).toContain(command);
  });
});

describe(PageShell, () => {
  it("gives a page one main region headed by its title", () => {
    const markup = markupOf(
      <PageShell title="Today">
        <p>Decisions 2 of 5</p>
      </PageShell>
    );

    expect(markup).toMatch(/<main\b[^>]*>.*<h1\b[^>]*>Today<\/h1>.*<\/main>/u);
    expect(markup).toContain("<p>Decisions 2 of 5</p>");
  });
});

describe("the shell", () => {
  const platformUrl = "https://platform-test.example.workers.dev";

  it("marks the page the reader is on in the header", () => {
    const markup = markupOf(
      <SiteHeader
        pathname="/today"
        session={<a href="/auth/signin">Sign in</a>}
      />
    );

    expect(markup).toMatch(/<a\b[^>]*aria-current="page"[^>]*>Today<\/a>/u);
    expect(markup).not.toMatch(/<a\b[^>]*aria-current="page"[^>]*>Asks<\/a>/u);
    expect(markup).toContain(">Sign in</a>");
  });

  it("links Asks, Today and Agents in the header, marking Agents current on its page", () => {
    const markup = markupOf(<SiteHeader pathname="/agents" session={null} />);

    const links = [
      ...markup.matchAll(
        /<a\b[^>]*href="(?<href>[^"]+)"[^>]*>(?<label>[^<]+)<\/a>/gu
      ),
    ].map(({ groups }) => [groups?.href, groups?.label]);

    expect(links).toStrictEqual([
      ["#main", "Skip to content"],
      ["/", Brand.name],
      ["/", "Asks"],
      ["/today", "Today"],
      ["/agents", "Agents"],
    ]);
    expect(markup).toMatch(/<a\b[^>]*aria-current="page"[^>]*>Agents<\/a>/u);
    expect(markup).not.toMatch(/<a\b[^>]*aria-current="page"[^>]*>Today<\/a>/u);
  });

  it("gives the command-line ways in at the foot of every page: plain git and the CLI", () => {
    const text = textOf(<SiteFooter platformUrl={platformUrl} />);

    expect(text).toContain("Plain git: clone any project");
    expect(text).toContain(`git clone ${platformUrl}/<project>.git`);
    expect(text).toContain(`curl -fsSL ${platformUrl}/install.sh | sh`);
  });

  it("sends a reader who wants to connect an agent to the Agents page", () => {
    const markup = markupOf(<SiteFooter platformUrl={platformUrl} />);

    expect(markup).toMatch(/<a\b[^>]*href="\/agents"[^>]*>/u);
    expect(textOf(<SiteFooter platformUrl={platformUrl} />)).toContain(
      "Connect an agent"
    );
  });

  it("names the paper colours the theme-color meta repeats", () => {
    expect(styles).toContain(`--background: ${themeColors.light};`);
    expect(styles).toContain(`--background: ${themeColors.dark};`);
  });
});

describe("the shared pieces", () => {
  // Views only: props in, markup out. A shared piece that fetched would
  // tie every page that shows it to one transport (src/surfaces.ts).
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/shared/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const transport =
    /from\s+["'](?:@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);

    const reaching = Object.entries(sources).flatMap(([path, source]) =>
      transport.test(source) ? [path] : []
    );

    expect(reaching).toStrictEqual([]);
  });
});
