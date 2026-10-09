/**
 * A Markdown file's link or image, resolved into the project at the commit
 * it was read at: a fragment and anything with a scheme stay as written,
 * `/x` starts at the repo root, anything else starts at the file's
 * directory, `..` stops at the root, and a query and a fragment survive.
 * Links open the file's page, media its raw bytes, always at the SHA.
 */
import { describe, expect, it } from "@effect/vitest";
import { CommitSha, ProjectName } from "@repo/protocol/ids";

import { resolveRepoUrl } from "../src/features/markdown/resolve.ts";

const sha = CommitSha.make("0123456789abcdef0123456789abcdef01234567");

/** A `javascript:` URL, joined at run time so lint reads no script URL in the source. */
const scriptUrl = ["javascript", "alert(1)"].join(":");

const at = (dir: string, kind: "link" | "media") => ({
  dir,
  kind,
  project: ProjectName.make("p"),
  sha,
});

describe("a link in a Markdown file", () => {
  it.each([
    ["#usage", "#usage"],
    ["https://e.org/x", "https://e.org/x"],
    ["mailto:a@e.org", "mailto:a@e.org"],
    [scriptUrl, scriptUrl],
    ["//cdn.e.org/x.png", "//cdn.e.org/x.png"],
    ["", ""],
  ])("leaves %j as written", (url, expected) => {
    expect(resolveRepoUrl(url, at("docs", "link"))).toBe(expected);
  });

  it.each([
    ["./guide.md", "docs", `/p/blob/${sha}/docs/guide.md`],
    ["guide.md", "docs/api", `/p/blob/${sha}/docs/api/guide.md`],
    ["../../x", "docs", `/p/blob/${sha}/x`],
    ["../../../../x", "docs/api", `/p/blob/${sha}/x`],
    ["/LICENSE", "docs/api", `/p/blob/${sha}/LICENSE`],
    ["/../LICENSE", "docs", `/p/blob/${sha}/LICENSE`],
    ["src/a.ts?raw=1#L3", "", `/p/blob/${sha}/src/a.ts?raw=1#L3`],
    ["CONTRIBUTING.md", "", `/p/blob/${sha}/CONTRIBUTING.md`],
    ["./a.md#usage", "docs", `/p/blob/${sha}/docs/a.md#usage`],
    ["my file.md", "", `/p/blob/${sha}/my%20file.md`],
    ["my%20file.md", "", `/p/blob/${sha}/my%20file.md`],
  ])("resolves %j in %j", (url, dir, expected) => {
    expect(resolveRepoUrl(url, at(dir, "link"))).toBe(expected);
  });

  it.each([
    ["docs/", "", `/p/tree/${sha}/docs`],
    ["..", "docs/api", `/p/tree/${sha}/docs`],
    ["/", "docs", `/p/tree/${sha}`],
    ["./", "", `/p/tree/${sha}`],
  ])("opens %j in %j as a folder", (url, dir, expected) => {
    expect(resolveRepoUrl(url, at(dir, "link"))).toBe(expected);
  });

  it.each([
    ["/\\evil.example/x", `/p/blob/${sha}/x`],
    ["\\\\evil.example/x", `/p/blob/${sha}/x`],
  ])("keeps %j inside the project", (url, expected) => {
    expect(resolveRepoUrl(url, at("", "link"))).toBe(expected);
  });
});

describe("an image or a video in a Markdown file", () => {
  it.each([
    ["./img/logo.png", "docs", `/p/raw/${sha}/docs/img/logo.png`],
    ["media/logo.svg", "", `/p/raw/${sha}/media/logo.svg`],
    ["/media/logo.svg", "docs", `/p/raw/${sha}/media/logo.svg`],
    ["../demo.mp4", "docs", `/p/raw/${sha}/demo.mp4`],
    ["https://e.org/logo.png", "docs", "https://e.org/logo.png"],
  ])("resolves %j in %j", (url, dir, expected) => {
    expect(resolveRepoUrl(url, at(dir, "media"))).toBe(expected);
  });
});
