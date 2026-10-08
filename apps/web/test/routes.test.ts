/**
 * The web takes some first path segments for its own pages and files, and
 * `/$project` takes every other one. A project named like one of the web's
 * would be unreachable at `<web>/<project>`, so `ProjectName` refuses each
 * such name. This holds the protocol's list to the routes
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

/** Route files that serve no segment of their own: the shell, `/`, a project. */
const notSegments = new Set(["__root", "index"]);

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

describe("the web's own paths", () => {
  it("are found: every page and file the web serves at its top", () => {
    expect(segments).toStrictEqual([
      ".well-known",
      "apple-touch-icon.png",
      "assets",
      "auth",
      "favicon.ico",
      "icons",
      "install.sh",
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

  it("are the protocol's reserved names, where a project's name could spell one", () => {
    expect(
      segments.filter((segment) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment))
    ).toStrictEqual([...reservedProjectNames]);
  });
});
