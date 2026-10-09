/**
 * The propose form, rendered to HTML with `react-dom/server`: a signed-in
 * member writes a want, may name a territory from the project's top
 * folders, and lets the platform's agent draft the ask (checked by
 * default). A line from the why page arrives as `?about&line&at` and starts
 * the want. Signed out, the page offers sign-in and no form. What the form
 * sends is the `proposeAsk` contract's own payload.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProposeAsk } from "@repo/protocol/contracts";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import {
  ProposeView,
  proposalPayload,
} from "../src/features/propose/propose-view.tsx";
import type { About } from "../src/features/propose/propose-view.tsx";
import { markupOf, plainText } from "./ask-fixtures.ts";

const datekit = ProjectName.make("datekit");

const at = CommitSha.make("4c2e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c");

const modules = [RepoPath.make("docs"), RepoPath.make("src")];

const signedIn = (about: Option.Option<About> = Option.none()) =>
  markupOf(
    <ProposeView about={about} modules={modules} project={datekit} signedIn />
  );

/** The want's textarea, as the server renders it: its opening tag and text. */
const textareaOf = (markup: string) =>
  /<textarea[^>]*>(?<text>[^<]*)<\/textarea>/u.exec(markup);

describe(ProposeView, () => {
  it("signed in, offers a want and the draft box, checked", () => {
    const markup = signedIn();

    expect(textareaOf(markup)?.[0]).toContain('name="want"');
    expect(markup).toMatch(
      /role="checkbox"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="checkbox"/u
    );
    expect(plainText(markup)).toContain(
      "Let the platform's agent draft the ask"
    );
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Propose/u);
  });

  it("offers each of the project's top folders as the territory", () => {
    const markup = signedIn();

    expect(markup).toContain('name="territory"');
    expect(markup).toContain('<option value="src">src</option>');
    expect(markup).toContain('<option value="docs">docs</option>');
  });

  it("starts the want at the line a why page names", () => {
    const markup = signedIn(
      Option.some({ at, line: 12, path: RepoPath.make("src/format.ts") })
    );

    expect(textareaOf(markup)?.groups?.text).toBe(
      "In `src/format.ts` line 12 at 4c2e6a8: "
    );
  });

  it("signed out, shows no form and links to sign in", () => {
    const markup = markupOf(
      <ProposeView
        about={Option.none()}
        modules={modules}
        project={datekit}
        signedIn={false}
      />
    );

    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<textarea");
    expect(markup).toMatch(/<a[^>]*href="\/auth\/signin[^"]*"[^>]*>Sign in/u);
  });
});

describe(proposalPayload, () => {
  const isPayload = Schema.is(ProposeAsk.payloadSchema);

  it("asks for a draft when the box is checked", () => {
    const payload = proposalPayload({
      draft: true,
      project: datekit,
      want: "  formatISO keeps the offset.  ",
    });

    expect(payload).toStrictEqual({
      draft: true,
      project: "datekit",
      want: "formatISO keeps the offset.",
    });
    expect(isPayload(payload)).toBeTruthy();
  });

  it("carries no draft key when the box is clear, and the territory when named", () => {
    const payload = proposalPayload({
      draft: false,
      project: datekit,
      territory: RepoPath.make("src"),
      want: "formatISO keeps the offset.",
    });

    expect(payload).toStrictEqual({
      project: "datekit",
      territory: "src",
      want: "formatISO keeps the offset.",
    });
    expect(Object.hasOwn(payload, "draft")).toBeFalsy();
  });
});
