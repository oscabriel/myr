/**
 * The web takes some first path segments for its own pages and files, and
 * `/$owner/$project` takes every other one. A project owned by one of the
 * web's words would be unreachable at `<web>/<owner>/<name>`, so
 * `ProjectName` refuses each such owner. This holds the protocol's list to the routes
 * and the public files the web really has.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectName, reservedProjectNames } from "@repo/protocol/ids";
import { Schema } from "effect";

// Keys only: nothing here is loaded.
const routes = Object.keys(import.meta.glob("../src/routes/**/*.{ts,tsx}"));

const publicFiles = Object.keys(
  import.meta.glob("../public/**/*", { query: "?url" })
);

/** The first path segment `file` serves under, as a browser spells it. */
const firstSegment = (file: string, root: string) =>
  (file.slice(root.length).split("/")[0] ?? "")
    .replace(/\.tsx?$/u, "")
    .replaceAll("[.]", ".");

/**
 * Files that serve no segment of their own: the shell, `/`, a project, and
 * `_headers`, which the asset host reads and never serves.
 */
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

/**
 * Words reserved before the web serves a page at them: `import` is the
 * import page's address, reserved before the page lands, so no owner takes
 * it in the meantime.
 */
const RESERVED_BEFORE_THEIR_PAGE = ["import"];

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
      "favicon.ico",
      "home",
      "icons",
      "install.sh",
      "llms-full.txt",
      "llms.txt",
      "people",
      "releases",
      "robots.txt",
      "rpc",
      "today",
    ]);
  });

  it("are names no project may take", () => {
    expect(
      segments.filter((segment) => Schema.is(ProjectName)(segment))
    ).toStrictEqual([]);
  });

  it("are the protocol's reserved names, where an owner could spell one", () => {
    expect(
      [
        ...segments.filter((segment) =>
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)
        ),
        ...RESERVED_BEFORE_THEIR_PAGE,
      ].toSorted()
    ).toStrictEqual([...reservedProjectNames]);
  });
});
