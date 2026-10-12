// A project owned by one of the web's own first segments would be unreachable, so `ProjectName` refuses each such owner.
import { describe, expect, it } from "@effect/vitest";
import { ProjectName, reservedProjectNames } from "@repo/protocol/ids";
import { Schema } from "effect";

// Keys only: nothing here is loaded.
const routes = Object.keys(import.meta.glob("../src/routes/**/*.{ts,tsx}"));

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
      "import",
      "install.sh",
      "llms-full.txt",
      "llms.txt",
      "people",
      "privacy",
      "releases",
      "robots.txt",
      "rpc",
      "terms",
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
      segments.filter((segment) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment))
    ).toStrictEqual([...reservedProjectNames]);
  });
});
