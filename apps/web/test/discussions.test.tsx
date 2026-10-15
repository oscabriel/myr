import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import {
  Discussion,
  DiscussionListing,
} from "@repo/protocol/domain/discussion";
import { DiscussionId, ProjectName } from "@repo/protocol/ids";
import { UnknownDiscussion, UnknownProject } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Layer, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import { DiscussionView } from "../src/features/discussion/discussion-view.tsx";
import { DiscussionsView } from "../src/features/discussion/discussions-view.tsx";
import {
  crumbsFor,
  projectSections,
  projectTabOf,
} from "../src/features/shared/shell/sections.ts";
import { readDiscussion } from "../src/routes/$owner/$project/discussions/$discussion.tsx";
import { readDiscussions } from "../src/routes/$owner/$project/discussions/index.tsx";
import { inOrder, markupOf, plainText } from "./ask-fixtures.ts";
import { elementWith, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

const datekit = ProjectName.make("oscabriel/datekit");

const now = DateTime.makeUnsafe("2026-10-07T13:00:00Z");

const first = DiscussionId.make("disc-000001");

const second = DiscussionId.make("disc-000002");

const open = Schema.decodeSync(Discussion)({
  id: "disc-000001",
  openedAt: "2026-10-07T12:00:00.000Z",
  opener: "wren",
  posts: [
    {
      at: "2026-10-07T12:00:00.000Z",
      body: "Weeks start on Monday in ISO 8601; which does parseISO assume?",
      by: "wren",
    },
    {
      at: "2026-10-07T12:30:00.000Z",
      body: "ISO, always.",
      by: "ines-v",
    },
  ],
  project: "oscabriel/datekit",
  state: "open",
  title: "Which day starts a week?",
});

const asked = Schema.decodeSync(Discussion)({
  ask: "parse-iso-week",
  id: "disc-000002",
  openedAt: "2026-10-07T12:10:00.000Z",
  opener: "tove",
  posts: [
    {
      at: "2026-10-07T12:10:00.000Z",
      body: "Could parseISO take week dates too?",
      by: "tove",
    },
  ],
  project: "oscabriel/datekit",
  state: "asked",
  title: "ISO week dates",
});

const listings = Schema.decodeSync(Schema.Array(DiscussionListing))([
  {
    id: "disc-000001",
    lastPostAt: "2026-10-07T12:30:00.000Z",
    openedAt: "2026-10-07T12:00:00.000Z",
    opener: "wren",
    posts: 2,
    project: "oscabriel/datekit",
    state: "open",
    title: "Which day starts a week?",
  },
  {
    ask: "parse-iso-week",
    id: "disc-000002",
    lastPostAt: "2026-10-07T12:10:00.000Z",
    openedAt: "2026-10-07T12:10:00.000Z",
    opener: "tove",
    posts: 1,
    project: "oscabriel/datekit",
    state: "asked",
    title: "ISO week dates",
  },
]);

const commandsOf = (markup: string) =>
  [
    ...markup.matchAll(/<code\b[^>]*select-all[^>]*>(?<line>.*?)<\/code>/gsu),
  ].map((found) =>
    plainText((found.groups?.line ?? "").replaceAll(/ \\\n\s*/gu, " ")).trim()
  );

const list = (
  <DiscussionsView discussions={listings} now={now} project={datekit} />
);

describe("a project's discussions page", () => {
  it("lists each thread by title, opener, posts, last post and state, each linked to its page", () => {
    const markup = mainOf(markupOf(list));
    const rows = elementWith(markup, "data-discussions");

    expect(markup).toMatch(/<h1\b[^>]*>Discussions<\/h1>/u);
    expect(rows).toContain('href="/oscabriel/datekit/discussions/disc-000001"');
    expect(rows).toContain('href="/oscabriel/datekit/discussions/disc-000002"');
    expect(rows).toContain('href="/oscabriel/datekit/asks/parse-iso-week"');
    expect(
      inOrder(plainText(rows), [
        "Which day starts a week?",
        "wren",
        "2 posts",
        "30 min ago",
        "Open",
        "ISO week dates",
        "tove",
        "1 post",
        "Became an ask",
        "parse-iso-week",
      ])
    ).toBeTruthy();
  });

  it("shows the command to open a thread, copyable, and no form", () => {
    const markup = markupOf(list);

    expect(commandsOf(markup)).toContain(
      `${Brand.cli} discussion post --project oscabriel/datekit --title "<title>" --body "<post>"`
    );
    expect(markup).not.toMatch(/<form\b|<textarea\b/u);
  });

  it("says so, with the command, when there are none", () => {
    const markup = markupOf(
      <DiscussionsView discussions={[]} now={now} project={datekit} />
    );

    expect(plainText(mainOf(markup))).toContain("No discussions yet");
    expect(markup).not.toContain("data-discussions");
  });

  it.effect("is the Discussions tab, with its crumbs", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/oscabriel/datekit/discussions", list);
      const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

      expect(plainText(crumbs)).toContain("Discussions");
      expect(
        projectSections("oscabriel/datekit").find(
          ({ tab }) => tab === "discussions"
        )
      ).toStrictEqual({
        label: "Discussions",
        tab: "discussions",
        to: "/oscabriel/datekit/discussions",
      });
      expect([
        projectTabOf("/oscabriel/datekit/discussions"),
        projectTabOf("/oscabriel/datekit/discussions/disc-000001"),
      ]).toStrictEqual(["discussions", "discussions"]);
      expect(
        crumbsFor("/oscabriel/datekit/discussions/disc-000001")
      ).toStrictEqual([
        { label: "oscabriel/datekit", to: "/oscabriel/datekit" },
        { label: "Discussions", to: "/oscabriel/datekit/discussions" },
        { label: "disc-000001", mono: true },
      ]);
    })
  );
});

describe("a discussion's page", () => {
  it("shows the posts in order, each by its person and time, and the reply command while open", () => {
    const markup = markupOf(<DiscussionView discussion={open} now={now} />);
    const main = mainOf(markup);
    const posts = elementWith(main, "data-posts");

    expect(main).toMatch(/<h1\b[^>]*>Which day starts a week\?<\/h1>/u);
    expect(
      inOrder(plainText(posts), [
        "wren",
        "1 h ago",
        "Weeks start on Monday in ISO 8601; which does parseISO assume?",
        "ines-v",
        "30 min ago",
        "ISO, always.",
      ])
    ).toBeTruthy();
    expect(posts).toMatch(/<a\b[^>]*href="\/people\/wren"[^>]*>wren<\/a>/u);
    expect(commandsOf(markup)).toContain(
      `${Brand.cli} discussion post disc-000001 --project oscabriel/datekit --body "<post>"`
    );
    expect(markup).not.toMatch(/<form\b|<textarea\b/u);
  });

  it("names the ask a maintainer opened from it, linked, and offers no reply", () => {
    const markup = markupOf(<DiscussionView discussion={asked} now={now} />);

    const became = elementWith(mainOf(markup), "data-became");

    expect(became).toMatch(
      /<a\b[^>]*href="\/oscabriel\/datekit\/asks\/parse-iso-week"[^>]*>parse-iso-week<\/a>/u
    );
    expect(plainText(markup)).toContain("Became an ask");
    expect(plainText(markup)).toContain("takes no more posts");
    expect(commandsOf(markup)).toStrictEqual([]);
  });
});

const platformOf = () =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide(
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("listDiscussions", ({ project }) =>
          project === datekit
            ? Effect.succeed({ discussions: listings })
            : Effect.fail(new UnknownProject({ project }))
        ),
        Contracts.toLayerHandler(
          "showDiscussion",
          ({ discussion, project }) => {
            if (project !== datekit) {
              return Effect.fail(new UnknownProject({ project }));
            }

            return discussion === first
              ? Effect.succeed({ discussion: open })
              : Effect.fail(new UnknownDiscussion({ discussion }));
          }
        ),
        asTester
      )
    )
  );

describe("the discussion reads", () => {
  it.effect("list a project's discussions and show one", () =>
    Effect.gen(function* () {
      const listed = yield* readDiscussions("oscabriel/datekit");
      const shown = yield* readDiscussion("oscabriel/datekit", "disc-000001");

      expect(listed.listed.discussions.map(({ id }) => id)).toStrictEqual([
        "disc-000001",
        "disc-000002",
      ]);
      expect(shown.discussion.id).toBe("disc-000001");
    }).pipe(Effect.provide(platformOf()))
  );

  it.effect(
    "are not-founds for an unknown project, discussion or address",
    () =>
      Effect.gen(function* () {
        const failed = yield* Effect.all([
          Effect.flip(readDiscussions("oscabriel/no-such-project")),
          Effect.flip(readDiscussion("oscabriel/datekit", second)),
          Effect.flip(readDiscussion("oscabriel/datekit", "not-an-id")),
          Effect.flip(readDiscussions("Not_A-Project")),
        ]);

        expect(failed.map(isNotFound)).toStrictEqual([true, true, true, true]);
      }).pipe(Effect.provide(platformOf()))
  );
});
