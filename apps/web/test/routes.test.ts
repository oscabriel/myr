// A project owned by one of the web's own first segments would be unreachable, so `ProjectName` refuses each such owner.
import { describe, expect, it } from "@effect/vitest";
import { ProjectName, reservedProjectNames } from "@repo/protocol/ids";
import type { StaticDataRouteOption } from "@tanstack/react-router";
import { Schema } from "effect";

// Keys only: nothing here is loaded.
const routes = Object.keys(import.meta.glob("../src/routes/**/*.{ts,tsx}"));

// Every page module, loaded: a file whose name starts with `-` is a piece of a page, never a route.
const pages: Readonly<
  Record<
    string,
    {
      readonly options: {
        readonly component?: unknown;
        readonly staticData?: StaticDataRouteOption;
      };
    }
  >
> = import.meta.glob(
  [
    "../src/routes/**/*.tsx",
    "!../src/routes/**/-*.tsx",
    "!../src/routes/__root.tsx",
  ],
  { eager: true, import: "Route" }
);

const SHELLS: ReadonlySet<string | undefined> = new Set([
  "site",
  "project",
  "docs",
  "focus",
]);

const publicFiles = Object.keys(
  import.meta.glob("../public/**/*", { query: "?url" })
);

const firstSegment = (file: string, root: string) =>
  (file.slice(root.length).split("/")[0] ?? "")
    .replace(/\.tsx?$/u, "")
    .replaceAll("[.]", ".");

// `_headers` is read by the asset host and never served.
const notSegments = new Set(["__root", "_headers", "index"]);

const segments = [
  ...new Set([
    ...routes.map((file) => firstSegment(file, "../src/routes/")),
    ...publicFiles.map((file) => firstSegment(file, "../public/")),
    // Vite's client build serves its chunks and styles under `/assets/`.
    "assets",
  ]),
]
  .filter((segment) => !notSegments.has(segment) && !segment.startsWith("$"))
  .toSorted();

// Reserved before their page exists (ADR 0041), so no project takes the name meanwhile; each leaves this list with its route.
const AHEAD_OF_THEIR_PAGE: readonly string[] = [];

describe("the web's own paths", () => {
  it("are found: every page and file the web serves at its top", () => {
    expect(segments).toStrictEqual([
      ".well-known",
      "agents",
      "agents.md",
      "apple-touch-icon.png",
      "asks",
      "assets",
      "auth",
      "docs",
      "explore",
      "favicon.ico",
      "home",
      "icons",
      "import",
      "inbox",
      "install",
      "install.sh",
      "llms-full.txt",
      "llms.txt",
      "og.png",
      "people",
      "privacy",
      "releases",
      "robots.txt",
      "rpc",
      "settings",
      "terms",
      "today",
      "tour",
    ]);
  });

  it("are names no project may take", () => {
    expect(
      segments.filter((segment) => Schema.is(ProjectName)(segment))
    ).toStrictEqual([]);
  });

  it("are the protocol's reserved names, where an owner could spell one, with those reserved ahead of their page", () => {
    expect(
      [
        ...segments.filter((segment) =>
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)
        ),
        ...AHEAD_OF_THEIR_PAGE,
      ].toSorted()
    ).toStrictEqual([...reservedProjectNames]);
  });

  it("leave a name reserved ahead only while no page answers at it", () => {
    expect(
      AHEAD_OF_THEIR_PAGE.filter((name) => segments.includes(name))
    ).toStrictEqual([]);
  });
});

describe("the web's pages", () => {
  it("are found: every route module that draws a page", () => {
    expect(
      Object.values(pages).filter(({ options }) => "component" in options)
        .length
    ).toBeGreaterThan(20);
  });

  it("each name one of the four shells, so none is drawn in a frame it did not choose", () => {
    expect(
      Object.entries(pages).flatMap(([file, { options }]) =>
        "component" in options && !SHELLS.has(options.staticData?.shell)
          ? [file]
          : []
      )
    ).toStrictEqual([]);
  });
});
