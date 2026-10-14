import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectTabs } from "../src/features/project/project-header.tsx";
import { projectTabOf } from "../src/features/shared/shell/sections.ts";
import { renderAt } from "./render.tsx";

const datekit = ProjectName.make("oscabriel/datekit");

const linksOf = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<text>.*?)<\/a>/gu)].map(
    ({ groups }) => ({
      current: /aria-current="page"/u.test(groups?.attributes ?? ""),
      href: /href="(?<href>[^"]*)"/u.exec(groups?.attributes ?? "")?.groups
        ?.href,
      text: (groups?.text ?? "").replaceAll(/<[^>]+>/gu, ""),
    })
  );

const tabs = (current: string) =>
  [
    { href: "/oscabriel/datekit", text: "Overview" },
    { href: "/oscabriel/datekit/tree/main", text: "Code" },
    { href: "/oscabriel/datekit#open-asks", text: "Asks" },
    { href: "/oscabriel/datekit/commits/main?show=landings", text: "Landings" },
    { href: "/oscabriel/datekit#proposals", text: "Proposals" },
    { href: "/oscabriel/datekit/discussions", text: "Discussions" },
    { href: "/oscabriel/datekit#who-decides", text: "People" },
    { href: "/oscabriel/datekit/people", text: "Policy" },
    { href: "/oscabriel/datekit/visibility", text: "Visibility" },
  ].map((link) => ({ current: link.text === current, ...link }));

describe("a project's tabs", () => {
  it("links all nine, in ADR 0041's order, and marks only the page being read", () => {
    const markup = renderToStaticMarkup(
      <ProjectTabs current="code" project={datekit} />
    );

    expect(markup).toMatch(/^<nav\b[^>]*aria-label="oscabriel\/datekit tabs"/u);
    expect(linksOf(markup)).toStrictEqual(tabs("Code"));
  });

  it("counts the open asks on the Asks tab, from the asks the page read", () => {
    const markup = renderToStaticMarkup(
      <ProjectTabs
        current="overview"
        open={{ asks: 5, takeable: 2 }}
        project={datekit}
      />
    );

    expect(
      linksOf(markup).find(({ href }) => href?.endsWith("#open-asks") === true)
        ?.text
    ).toBe("Asks5");
  });

  it("are links, not buttons", () => {
    const markup = renderToStaticMarkup(
      <ProjectTabs current="overview" project={datekit} />
    );

    expect(markup).not.toContain('role="button"');
    expect(markup).not.toContain("<button");
  });

  it.effect(
    "draws the router's links inside the router, marking only the tab of the page being read",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit/visibility",
          <ProjectTabs
            current={projectTabOf("/oscabriel/datekit/visibility")}
            project={datekit}
          />
        );

        expect(linksOf(markup)).toStrictEqual(tabs("Visibility"));
        expect(markup).toMatch(
          /<a\b[^>]*data-status="active"[^>]*>Visibility<\/a>/u
        );
      })
  );

  it.effect(
    "never lets the router mark a second tab where a tab opens a region of Overview",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit",
          <ProjectTabs current="overview" project={datekit} />
        );

        expect(
          linksOf(markup)
            .filter(({ current }) => current)
            .map(({ text }) => text)
        ).toStrictEqual(["Overview"]);
      })
  );

  it.effect(
    "keeps Overview current where a tab has opened one of its regions, so the mark never rests on a fragment",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit#open-asks",
          <ProjectTabs
            current={projectTabOf("/oscabriel/datekit")}
            project={datekit}
          />
        );

        expect(
          [
            ...markup.matchAll(
              /<a\b[^>]*data-current=""[^>]*>(?<text>[^<]*)/gu
            ),
          ].map(({ groups }) => groups?.text)
        ).toStrictEqual(["Overview"]);
      })
  );

  // The tabs stick with the header, in the project's frame (project.test.tsx).
  it("scrolls sideways inside itself, never wrapping", () => {
    const markup = renderToStaticMarkup(
      <ProjectTabs current="code" project={datekit} />
    );

    expect(markup).toContain("overflow-x-auto");
    expect(markup).not.toContain("flex-wrap");
  });

  it("fades its right edge below tablet, the cue that tabs lie off screen where the scrollbar is hidden", () => {
    const markup = renderToStaticMarkup(
      <ProjectTabs current="code" project={datekit} />
    );

    const fade =
      /<div\b[^>]*class="(?<classes>[^"]*)"[^>]*data-tabs-fade=""/u.exec(markup)
        ?.groups?.classes ?? "";

    expect(fade.split(" ")).toStrictEqual(
      expect.arrayContaining([
        "after:bg-linear-to-l",
        "after:from-background",
        "after:pointer-events-none",
        "tablet:after:hidden",
      ])
    );
    expect(markup.indexOf('data-tabs-fade=""')).toBeLessThan(
      markup.indexOf("overflow-x-auto")
    );
  });
});

describe(projectTabOf, () => {
  it.each([
    ["/oscabriel/datekit", "overview"],
    ["/oscabriel/datekit/tree/main/src", "code"],
    ["/oscabriel/datekit/blob/main/README.md", "code"],
    ["/oscabriel/datekit/why/main/README.md", "code"],
    ["/oscabriel/datekit/refs", "code"],
    ["/oscabriel/datekit/asks/fix-week-start", "asks"],
    ["/oscabriel/datekit/decisions/dec-000001", "asks"],
    ["/oscabriel/datekit/answers/fix-week-start", "landings"],
    ["/oscabriel/datekit/commits/main", "landings"],
    ["/oscabriel/datekit/commits/%40bram%2Fparse-iso", "landings"],
    [
      "/oscabriel/datekit/commit/1111111111111111111111111111111111111111",
      "landings",
    ],
    ["/oscabriel/datekit/proposals/prop-000001", "proposals"],
    ["/oscabriel/datekit/people", "policy"],
    ["/oscabriel/datekit/visibility", "visibility"],
  ])("puts %s under %s", (pathname, tab) => {
    expect(projectTabOf(pathname)).toBe(tab);
  });

  it("names no tab off a project", () => {
    expect(projectTabOf("/asks")).toBeUndefined();
  });
});
