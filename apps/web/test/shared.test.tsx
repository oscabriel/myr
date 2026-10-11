/**
 * The pieces every page repeats, rendered to HTML with `react-dom/server`
 * (no DOM library): a state as its mark and its word, a posture as the
 * platform labels it, a person by handle, a time as a distance, a command
 * whole and copyable, and an empty list with the command that fills it.
 * (Refusals and outcomes: `outcome.test.tsx`; credit: `credits.test.tsx`.)
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import { DateTime, Schema } from "effect";

import { Definition, Definitions } from "../src/features/ask/fields.tsx";
import {
  CommandLine,
  InspectorCommands,
} from "../src/features/shared/command.tsx";
import { CopyAction } from "../src/features/shared/copy-action.tsx";
import { EmptyState } from "../src/features/shared/empty.tsx";
import { HandleLink } from "../src/features/shared/handle.tsx";
import {
  STATE_MARK_NAMES,
  STATE_MARKS,
} from "../src/features/shared/marks.tsx";
import { PostureBadge } from "../src/features/shared/posture.tsx";
import {
  FactsSkeleton,
  RowSkeleton,
} from "../src/features/shared/skeleton.tsx";
import { StateBadge } from "../src/features/shared/state-badge.tsx";
import { themeColors } from "../src/features/shared/theme.ts";
import { When } from "../src/features/shared/time.tsx";
import { markupOf, textOf } from "./markup.ts";

import styles from "../src/styles.css?raw";

const handle = Schema.decodeSync(Handle);

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

describe(StateBadge, () => {
  const states = STATE_MARK_NAMES;

  it.each(states)(
    "says %s in a word beside its mark, which the screen reader skips",
    (state) => {
      const element = <StateBadge mark={state} />;
      const markup = markupOf(element);

      expect(textOf(element).trim()).toBe(STATE_MARKS[state].word);
      expect(STATE_MARKS[state].word.length).toBeGreaterThan(0);
      expect(markup).toMatch(/<svg\b[^>]*aria-hidden="true"/u);
      expect(markup).toContain(`data-mark="${state}"`);
    }
  );

  it("is never a pill: no fill and no rounded edge", () => {
    for (const state of states) {
      const markup = markupOf(<StateBadge mark={state} />);

      expect(markup).not.toMatch(/\brounded-(?:full|md|lg|xl)\b|\bbg-/u);
    }
  });

  it("gives refused to a refusal only, and waiting its own role", () => {
    expect(STATE_MARKS.refused.tone).toBe("text-refused");
    expect(STATE_MARKS.waiting.tone).toBe("text-waiting");
    expect(STATE_MARKS.retry.tone).toBe("text-waiting");
    expect(
      states.filter((state) => STATE_MARKS[state].tone === "text-refused")
    ).toStrictEqual(["refused"]);
  });

  it("can say a state in its own words", () => {
    expect(textOf(<StateBadge mark="open" word="Open to take" />).trim()).toBe(
      "Open to take"
    );
  });
});

describe(CopyAction, () => {
  it("holds its command as text and is named for what it copies", () => {
    const command = `${Brand.cli} claim fix-week-start --project datekit`;

    const markup = markupOf(
      <CopyAction command={command} label="Copy claim command" />
    );

    expect(markup).toMatch(/^<button\b[^>]*aria-label="Copy claim command"/u);
    expect(markup).toContain(`<code class="sr-only">${command}</code>`);
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("the skeletons", () => {
  it("hold a row's place at its height, and a fact block's under its label", () => {
    expect(markupOf(<RowSkeleton />)).toContain("h-16");
    expect(markupOf(<RowSkeleton />)).not.toMatch(/animate-|shimmer/u);
    expect(markupOf(<FactsSkeleton labels={["State", "Claim"]} />)).toContain(
      "Claim"
    );
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

/** Each line's hang, in ch, as the command line sets it. */
const hangs = (command: string) =>
  [
    ...markupOf(<CommandLine command={command} />).matchAll(
      /padding-left:(?<hang>\d+)ch;text-indent:-\k<hang>ch/gu
    ),
  ].map((found) => Number(found.groups?.hang));

describe(CommandLine, () => {
  it("shows the command, with a button that copies it", () => {
    const command = `${Brand.cli} claim fix-week-start`;
    const element = <CommandLine command={command} />;

    expect(textOf(element)).toContain(command);
    expect(markupOf(element)).toMatch(/<button\b[^>]*>.*Copy.*<\/button>/u);
  });

  it("keeps each word whole on its line, so a narrow column breaks between words", () => {
    const command = `${Brand.cli} claim lint-heading-levels --project vellum`;
    const markup = markupOf(<CommandLine command={command} />);

    const words = [
      ...markup.matchAll(
        /<span class="inline-block[^"]*">(?<word>[^<]*)<\/span>/gu
      ),
    ].map(([, word]) => word);

    expect(words).toStrictEqual(command.split(" "));
    // The words keep the command's own spaces between them.
    expect(textOf(<CommandLine command={command} />)).toContain(command);
  });

  it("hangs a line 6ch, less when its longest word would not fit beside the hang", () => {
    // `today` (5ch) beside a 6ch hang needs 11ch; the line is 9ch, so the
    // box hugging it would break the word in two. It never wraps, so its
    // hang never shows.
    expect(hangs(`${Brand.cli} today`)).toStrictEqual([4]);
    expect(
      hangs(
        `${Brand.cli} claim lint-heading-levels --project vellum \\\n  --json`
      )
    ).toStrictEqual([6, 2]);
  });

  it("takes the bleed form in the inspector: pane-wide, ruled above and below, hanging 2ch, an icon-only Copy", () => {
    const command = `${Brand.cli} claim lint-heading-levels --project vellum`;

    const markup = markupOf(
      <InspectorCommands>
        <CommandLine command={command} />
      </InspectorCommands>
    );

    const box = /<div\b[^>]*data-form="bleed"[^>]*>/u.exec(markup)?.[0] ?? "";

    expect(box).toMatch(/\bborder-y\b/u);
    expect(box).not.toMatch(/\bborder\b(?!-)/u);
    expect(markup).toMatch(/padding-left:2ch;text-indent:-2ch/u);
    expect(markup).toMatch(
      /<button\b[^>]*class="[^"]*\bsize-7\b[^"]*"[^>]*>.*<span class="sr-only">Copy<\/span><\/button>/u
    );
    expect(markupOf(<CommandLine command={command} />)).toMatch(
      /data-form="box"/u
    );
  });
});

describe(EmptyState, () => {
  it("says what is empty and the command that would change it", () => {
    const command = `${Brand.cli} ask open`;
    const text = textOf(<EmptyState command={command} title="No open asks" />);

    expect(text).toContain("No open asks");
    expect(text).toContain(command);
    expect(
      markupOf(<EmptyState command={command} title="No open asks" />)
    ).toContain(markupOf(<CommandLine command={command} />));
  });

  it("gives a way onward when no command changes it", () => {
    const text = textOf(
      <EmptyState
        onward={<a href="/datekit">Back to datekit</a>}
        title="Nobody has answered this ask yet."
      />
    );

    expect(text).toContain("Back to datekit");
  });
});

describe(Definitions, () => {
  it("reads each term before its value, in a list named for what it holds", () => {
    const element = (
      <Definitions label="Limits">
        <Definition term="Claims at once">2</Definition>
        <Definition term="Proposals a week">5</Definition>
      </Definitions>
    );

    const markup = markupOf(element);

    expect(markup).toMatch(/^<dl\b[^>]*aria-label="Limits"/u);
    expect(markup.match(/<dt\b/gu)).toHaveLength(2);
    expect(textOf(element)).toBe("Claims at once2Proposals a week5");
  });
});

describe("the theme", () => {
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
