/**
 * The propose form, rendered to HTML with `react-dom/server`: a signed-in
 * member writes a want, may name a territory from the project's top
 * folders, and lets the platform's agent draft the ask (checked by
 * default). A line from the why page arrives as `?about&line&at` and starts
 * the want. Signed out, the page offers sign-in and no form. What the form
 * sends is the `proposeAsk` contract's own payload.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { ProposeAsk } from "@repo/protocol/contracts";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { CapReached } from "@repo/protocol/refusal";
import { Cause, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { proposalMade, topFolders } from "../src/client/propose.ts";
import { ProposalFailure } from "../src/features/proposal/failure.tsx";
import {
  ProposeView,
  proposalPayload,
  territoryChoices,
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
    expect(markup).toMatch(/<button[^>]*type="submit"/u);
  });

  it("says on Propose why it waits, until there is a want", () => {
    const empty = signedIn();

    const written = signedIn(
      Option.some({ at, line: 12, path: RepoPath.make("src/format.ts") })
    );

    expect(empty).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*type="submit")[^>]*>Write the want first<\/button>/u
    );
    expect(written).toMatch(
      /<button[^>]*type="submit"[^>]*>Propose<\/button>/u
    );
    expect(written).not.toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*type="submit")/u
    );
  });

  it("offers each of the project's top folders as the territory, through the kit's select, never a native one", () => {
    const markup = signedIn();

    expect(markup).toContain('name="territory"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain('data-slot="select-trigger"');
    expect(territoryChoices(modules)).toStrictEqual([
      { label: "Let the agent choose", value: "" },
      { label: "docs", value: "docs" },
      { label: "src", value: "src" },
    ]);
  });

  it("gives the same proposal as a command, and what makes a good want", () => {
    const text = plainText(signedIn());

    expect(text).toContain(`${Brand.cli} propose --draft "<want>"`);
    expect(text).toContain("not how to change the code");
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
    expect(plainText(markup)).toContain(
      `${Brand.cli} propose --draft "<want>"`
    );
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

describe(topFolders, () => {
  it("offers each top folder once, sorted, and no dot folder or root file", () => {
    expect(
      topFolders(
        [
          "src/format.ts",
          "README.md",
          `${Brand.configDir}/asks/x.ask.ts`,
          "test/format.test.ts",
          "src/parse/iso.ts",
          ".github/workflows/ci.yml",
          "docs/guide.md",
        ].map((path) => RepoPath.make(path))
      )
    ).toStrictEqual(["docs", "src", "test"]);
  });
});

/** `proposeAsk`'s answer: the proposal `id`, made. */
const made = (id: string) =>
  Schema.decodeUnknownSync(ProposeAsk.successSchema)({
    proposal: {
      expiresAt: "2026-10-21T09:00:00.000Z",
      files: [],
      id,
      openedAt: "2026-10-07T09:00:00.000Z",
      project: "datekit",
      proposer: "lin-h",
      state: "open",
      want: "formatISO keeps the offset.",
    },
  });

describe(proposalMade, () => {
  const earlier = AsyncResult.success(made("prop-000004"));

  it("names the proposal a send made, once it answered", () => {
    expect(
      proposalMade(AsyncResult.success(made("prop-000005")))
    ).toStrictEqual(Option.some("prop-000005"));
  });

  it("names none while a later send is on its way, or after it was refused", () => {
    expect(proposalMade(AsyncResult.waiting(earlier))).toStrictEqual(
      Option.none()
    );
    expect(
      proposalMade(
        AsyncResult.fail(new CapReached({ cap: 3 }), {
          previousSuccess: Option.some(earlier),
        })
      )
    ).toStrictEqual(Option.none());
  });
});

describe("the sign-in link", () => {
  it("comes back to the form, at the line a why page named", () => {
    const markup = markupOf(
      <ProposeView
        about={Option.some({
          at,
          line: 12,
          path: RepoPath.make("src/format.ts"),
        })}
        modules={modules}
        project={datekit}
        signedIn={false}
      />
    );

    const href = /href="(?<href>\/auth\/signin[^"]*)"/u
      .exec(markup)
      ?.groups?.href?.replaceAll("&amp;", "&");

    const back = new URL(href ?? "/", "https://web.test").searchParams.get(
      "return"
    );

    const there = new URL(back ?? "/", "https://web.test");

    expect(there.pathname).toBe("/datekit/proposals/new");
    expect(Object.fromEntries(there.searchParams)).toStrictEqual({
      about: "src/format.ts",
      at,
      line: "12",
    });
  });
});

describe("a refused send on the propose form", () => {
  it("with no session, asks to sign in and come back to the form as it was", () => {
    const here = `/datekit/proposals/new?about=src%2Fformat.ts&at=${at}&line=12`;

    const markup = markupOf(
      <ProposalFailure
        cause={Cause.fail(new Unauthenticated({}))}
        doing="propose it"
        here={here}
      />
    );

    expect(markup).toContain(
      `href="/auth/signin?return=%2Fdatekit%2Fproposals%2Fnew%3Fabout%3Dsrc%252Fformat.ts%26at%3D${at}%26line%3D12"`
    );
    expect(plainText(markup)).not.toContain("Today is a decider's page");
  });
});
