/**
 * A project's nav, rendered to HTML: the seven tabs every project page
 * shares, each linking to its page, and only the page being read marked
 * as the current one.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectNav } from "../src/features/project/project-nav.tsx";

const datekit = ProjectName.make("datekit");

/** Each link in `markup`: its text, its href, and whether it is current. */
const linksOf = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<text>.*?)<\/a>/gu)].map(
    ({ groups }) => ({
      current: /aria-current="page"/u.test(groups?.attributes ?? ""),
      href: /href="(?<href>[^"]*)"/u.exec(groups?.attributes ?? "")?.groups
        ?.href,
      text: (groups?.text ?? "").replaceAll(/<[^>]+>/gu, ""),
    })
  );

describe("a project's nav", () => {
  it("links all seven tabs, and marks only the page being read", () => {
    const markup = renderToStaticMarkup(
      <ProjectNav current="code" project={datekit} />
    );

    expect(markup).toMatch(/^<nav\b[^>]*aria-label="datekit"/u);
    expect(linksOf(markup)).toStrictEqual([
      { current: false, href: "/datekit", text: "Overview" },
      { current: true, href: "/datekit/tree/main", text: "Code" },
      { current: false, href: "/datekit/commits/main", text: "Landings" },
      { current: false, href: "/datekit/refs", text: "Refs" },
      { current: false, href: "/datekit/people", text: "People" },
      { current: false, href: "/datekit/ledger", text: "Ledger" },
      { current: false, href: "/datekit/env", text: "Env shape" },
    ]);
  });

  it("are links, not buttons", () => {
    const markup = renderToStaticMarkup(
      <ProjectNav current="overview" project={datekit} />
    );

    expect(markup).not.toContain('role="button"');
  });

  it("marks the tab it is given", () => {
    const current = linksOf(
      renderToStaticMarkup(<ProjectNav current="ledger" project={datekit} />)
    ).filter((link) => link.current);

    expect(current).toStrictEqual([
      { current: true, href: "/datekit/ledger", text: "Ledger" },
    ]);
  });
});
