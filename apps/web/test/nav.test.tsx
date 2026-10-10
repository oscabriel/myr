/**
 * A project's section row, rendered to HTML: the seven sections every
 * project page shares, in one line under the page's head where the rail is
 * not drawn, each linking to its page, and only the page being read marked
 * as the current one. Inside the router it draws the router's links; a view
 * rendered alone draws the same addresses as plain links.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectNav } from "../src/features/project/project-nav.tsx";
import { renderAt } from "./render.tsx";

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

const sections = (current: string) =>
  [
    { href: "/datekit", text: "Asks" },
    { href: "/datekit/tree/main", text: "Code" },
    { href: "/datekit/commits/main", text: "Landings" },
    { href: "/datekit/refs", text: "Refs" },
    { href: "/datekit/people", text: "Policy" },
    { href: "/datekit/ledger", text: "Ledger" },
    { href: "/datekit/env", text: "Env shape" },
  ].map((link) => ({ current: link.text === current, ...link }));

describe("a project's section row", () => {
  it("links all seven sections, and marks only the page being read", () => {
    const markup = renderToStaticMarkup(
      <ProjectNav current="code" project={datekit} />
    );

    expect(markup).toMatch(/^<nav\b[^>]*aria-label="datekit"/u);
    expect(linksOf(markup)).toStrictEqual(sections("Code"));
  });

  it("calls the project's policy Policy, at its address", () => {
    const policy = linksOf(
      renderToStaticMarkup(<ProjectNav current="people" project={datekit} />)
    ).filter(({ current }) => current);

    expect(policy).toStrictEqual([
      { current: true, href: "/datekit/people", text: "Policy" },
    ]);
  });

  it("are links, not buttons", () => {
    const markup = renderToStaticMarkup(
      <ProjectNav current="overview" project={datekit} />
    );

    expect(markup).not.toContain('role="button"');
  });

  it.effect(
    "draws the router's links inside the router, the page being read marked by it",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/datekit/ledger",
          <ProjectNav current="ledger" project={datekit} />
        );

        expect(linksOf(markup)).toStrictEqual(sections("Ledger"));
        expect(markup).toMatch(
          /<a\b[^>]*data-status="active"[^>]*>Ledger<\/a>/u
        );
      })
  );

  it("scrolls sideways inside itself and never wraps", () => {
    const markup = renderToStaticMarkup(
      <ProjectNav current="ledger" project={datekit} />
    );

    expect(markup).toMatch(/^<nav\b[^>]*class="[^"]*overflow-x-auto/u);
    expect(markup).not.toContain("flex-wrap");
  });
});
