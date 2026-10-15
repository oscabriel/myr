import { RegistryContext } from "@effect/atom-react";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { PostDiscussion } from "@repo/protocol/contracts";
import {
  Discussion,
  DiscussionListing,
} from "@repo/protocol/domain/discussion";
import { DiscussionId, Handle, ProjectName } from "@repo/protocol/ids";
import {
  Denounced,
  UnknownDiscussion,
  UnknownProject,
} from "@repo/protocol/refusal";
import { asPerson, asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Cause, DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";

import { postDiscussionAtom } from "../src/client/discussion.ts";
import { DiscussionView } from "../src/features/discussion/discussion-view.tsx";
import { DiscussionsView } from "../src/features/discussion/discussions-view.tsx";
import type { Poster } from "../src/features/discussion/post-form.tsx";
import { usePoster } from "../src/features/discussion/use-poster.tsx";
import { CallFailure } from "../src/features/shared/call-failure.tsx";
import {
  crumbsFor,
  projectSections,
  projectTabOf,
} from "../src/features/shared/shell/sections.ts";
import { readDiscussion } from "../src/routes/$owner/$project/discussions/$discussion.tsx";
import { readDiscussions } from "../src/routes/$owner/$project/discussions/index.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";
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

const list = <DiscussionsView discussions={listings} now={now} />;

const wren = Handle.make("wren");

const signedIn: Poster = {
  handle: Option.some(wren),
  here: "/oscabriel/datekit/discussions",
};

const signedOut: Poster = { ...signedIn, handle: Option.none() };

const formsIn = (markup: string) =>
  [...markup.matchAll(/<form\b[^>]*data-post-form="(?<kind>\w+)"/gu)].map(
    (found) => found.groups?.kind
  );

const fieldsIn = (markup: string) =>
  [...markup.matchAll(/<(?:input|textarea)\b[^>]*name="(?<name>\w+)"/gu)].map(
    (found) => found.groups?.name
  );

const returnOf = (markup: string) => {
  const href = /href="(?<href>\/auth\/signin[^"]*)"/u
    .exec(markup)
    ?.groups?.href?.replaceAll("&amp;", "&");

  return href === undefined
    ? undefined
    : new URL(href, "https://web.test").searchParams.get("return");
};

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

  it("says who may open a thread, and gives a signed-in reader a form for its title and first post, with no command", () => {
    const markup = markupOf(
      <DiscussionsView discussions={listings} now={now} poster={signedIn} />
    );

    expect(plainText(markup)).toContain(
      "Anyone not denounced may open a thread"
    );
    expect(formsIn(markup)).toStrictEqual(["open"]);
    expect(fieldsIn(markup)).toStrictEqual(["title", "body"]);
    expect(commandsOf(markup)).toStrictEqual([]);
    expect(plainText(markup)).not.toContain(`${Brand.cli} discussion post`);
  });

  it("gives a signed-out reader no form, only a way to sign in that comes back here", () => {
    const markup = markupOf(
      <DiscussionsView discussions={listings} now={now} poster={signedOut} />
    );

    expect(formsIn(markup)).toStrictEqual([]);
    expect(returnOf(markup)).toBe("/oscabriel/datekit/discussions");
    expect(plainText(markup)).toContain("Sign in to open a discussion");
  });

  it("says so when there are none", () => {
    const markup = markupOf(<DiscussionsView discussions={[]} now={now} />);

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
  it("shows the posts in order, each by its person and time, and a reply form while open, with no command", () => {
    const markup = markupOf(
      <DiscussionView discussion={open} now={now} poster={signedIn} />
    );

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
    expect(commandsOf(markup)).toStrictEqual([]);
    expect(formsIn(markup)).toStrictEqual(["reply"]);
  });

  it("names the ask a maintainer opened from it, linked, and offers no reply", () => {
    const markup = markupOf(
      <DiscussionView discussion={asked} now={now} poster={signedIn} />
    );

    const became = elementWith(mainOf(markup), "data-became");

    expect(became).toMatch(
      /<a\b[^>]*href="\/oscabriel\/datekit\/asks\/parse-iso-week"[^>]*>parse-iso-week<\/a>/u
    );
    expect(plainText(markup)).toContain("Became an ask");
    expect(plainText(markup)).toContain("takes no more posts");
    expect(formsIn(markup)).toStrictEqual([]);
  });

  it("offers a signed-out reader of an open thread no form, only a way to sign in", () => {
    const markup = markupOf(
      <DiscussionView
        discussion={open}
        now={now}
        poster={{
          ...signedOut,
          here: "/oscabriel/datekit/discussions/disc-000001",
        }}
      />
    );

    expect(formsIn(markup)).toStrictEqual([]);
    expect(returnOf(markup)).toBe("/oscabriel/datekit/discussions/disc-000001");
  });
});

type PostPayload = typeof PostDiscussion.payloadSchema.Type;

const browserWith = (
  sent: PostPayload[],
  answer: (
    payload: PostPayload
  ) => Effect.Effect<
    typeof PostDiscussion.successSchema.Type,
    typeof PostDiscussion.errorSchema.Type
  >
) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(
        ContractsClient.runtime.layer,
        Layer.effect(
          ContractsClient,
          RpcTest.makeClient(webContracts, { flatten: true })
        ).pipe(
          Layer.provide([
            Layer.mergeAll(
              unanswered,
              Contracts.toLayerHandler("postDiscussion", (payload) => {
                sent.push(payload);

                return answer(payload);
              })
            ),
            asPerson(wren),
          ]),
          Layer.provideMerge(Reactivity.layer)
        )
      ),
    ],
  });

// A server's render reads who is signed in as not yet known; this one says, as the browser would, that wren is.
const Thread = ({ seen }: { readonly seen?: (poster: Poster) => void }) => {
  const poster = usePoster(datekit, first);

  seen?.(poster);

  return (
    <DiscussionView
      discussion={open}
      now={now}
      poster={{ ...poster, checking: false, handle: Option.some(wren) }}
    />
  );
};

const reply = (registry: AtomRegistry.AtomRegistry, body: string) =>
  Effect.gen(function* () {
    const posters: Poster[] = [];

    yield* renderAt(
      "/oscabriel/datekit/discussions/disc-000001",
      <RegistryContext.Provider value={registry}>
        <Thread
          seen={(poster) => {
            posters.push(poster);
          }}
        />
      </RegistryContext.Provider>
    );

    // A page in the browser keeps the atom mounted while it waits; a
    // server's render keeps nothing.
    registry.mount(postDiscussionAtom);
    posters.at(-1)?.onPost?.({ body });

    return yield* Effect.exit(
      AtomRegistry.getResult(registry, postDiscussionAtom, {
        suspendOnWaiting: true,
      })
    );
  });

describe("posting from the web", () => {
  it.live("sends a reply to postDiscussion, named for its thread", () =>
    Effect.gen(function* () {
      const sent: PostPayload[] = [];

      const registry = browserWith(sent, () =>
        Effect.succeed({ discussion: open })
      );

      const answered = yield* reply(registry, "Monday, then.");

      expect(Exit.isSuccess(answered)).toBeTruthy();
      expect(sent).toStrictEqual([
        { body: "Monday, then.", discussion: first, project: datekit },
      ]);
    })
  );

  it.live(
    "hears a refusal as the platform gave it, and draws it inside the reply form",
    () =>
      Effect.gen(function* () {
        const registry = browserWith([], () => Effect.fail(new Denounced()));

        const answered = yield* reply(registry, "Monday, then.");

        const markup = markupOf(
          <DiscussionView
            discussion={open}
            now={now}
            poster={{
              ...signedIn,
              refusal: (
                <CallFailure
                  cause={Cause.fail(new Denounced())}
                  doing="reply"
                  here="/oscabriel/datekit/discussions/disc-000001"
                />
              ),
            }}
          />
        );

        const refused = Exit.isFailure(answered)
          ? Cause.findErrorOption(answered.cause)
          : Option.none();

        expect(Option.exists(refused, Schema.is(Denounced))).toBeTruthy();
        expect(elementWith(markup, 'data-post-form="reply"')).toContain(
          'data-refusal="Denounced"'
        );
      })
  );
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
