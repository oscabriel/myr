import { describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ProjectEvent } from "@repo/protocol/domain/event";
import {
  AskId,
  DiscussionId,
  Handle,
  LaneName,
  RepoName,
  RepoPath,
  keyOf,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  CapReached,
  Denounced,
  DiscussionClosed,
  NotDecider,
  UnknownDiscussion,
} from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, DateTime, Effect, Option } from "effect";

import { DISCUSSIONS_PER_PERSON } from "../src/attention/discussions.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, Pusher, composedAt, worldOf } from "./world.ts";
import type { StoreKind } from "./world.ts";

const people = ["bob", "carol", "dave", "erin"];

// carol is vouched for, erin denounced, dave and bob unknown to the vouch file.
const scenario = aProject({ people }).pipe(
  withVouches(["carol"], ["erin"]),
  withAsk({ id: "parse-week", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

const carol = person("carol");

const dave = person("dave");

const erin = person("erin");

const anyone = Anonymous.make({});

const first = DiscussionId.make("disc-000001");

const unknown = DiscussionId.make("disc-999999");

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const week = AskId.make("parse-week");

const weekFiles = Effect.sync(() => {
  const { check, file } = Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, ({ id }) => id === week)
  );

  return Array.make(
    { content: `export default "${week}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { parse } from "../src/parse.ts";`,
        ``,
        `it("reads a week date", () => {`,
        `  expect(parse("2026-W41-3")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${week}.test.ts`),
    }
  );
});

const made = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const tip = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, tip);

  return api;
});

const minutesOn = (count: number) =>
  advanceTo(
    DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe("2026-10-07T12:00:00Z"), {
        minutes: count,
      })
    )
  );

const talking = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* minutesOn(1);

    const opened = yield* api.postDiscussion(dave, {
      body: "Weeks start on Monday in ISO 8601; which does parse assume?",
      title: "Which day starts a week?",
    });

    yield* minutesOn(2);

    const replied = yield* api.postDiscussion(carol, {
      body: "ISO, always.",
      discussion: opened.discussion.id,
    });

    yield* minutesOn(3);

    const titleOnly = yield* api.postDiscussion(dave, {
      title: "Does format take a locale?",
    });

    const refused = yield* Effect.all({
      erinOpens: Effect.flip(
        api.postDiscussion(erin, { body: "Hello", title: "A thread" })
      ),
      erinReplies: Effect.flip(
        api.postDiscussion(erin, { body: "Hello", discussion: first })
      ),
      nowhere: Effect.flip(
        api.postDiscussion(dave, { body: "Hello", discussion: unknown })
      ),
    });

    const listed = yield* api.listDiscussions(anyone);
    const shown = yield* api.showDiscussion(anyone, first);
    const events = yield* api.events(0, 100);

    return { events, listed, opened, refused, replied, shown, titleOnly };
  });

const asking = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* minutesOn(1);

    const { discussion } = yield* api.postDiscussion(dave, {
      body: "Could parse take ISO week dates too?",
      title: "ISO week dates",
    });

    const files = yield* weekFiles;
    const { landed } = yield* api.head();
    const main = yield* Effect.fromNullishOr(landed).pipe(Effect.orDie);

    const composed = yield* composedAt(repo, main, files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, LaneName.make("redThenGreen"), [
        "failed",
        "failed",
      ])
    );

    const asked = { ask: week, discussion: discussion.id, files };

    const daveAsks = yield* Effect.flip(api.openAsk(dave, asked));

    const nowhere = yield* Effect.flip(
      api.openAsk(alice, { ...asked, discussion: unknown })
    );

    yield* minutesOn(2);

    const opened = yield* api.openAsk(alice, asked);
    const after = yield* api.showDiscussion(anyone, discussion.id);

    const closed = yield* Effect.all({
      again: Effect.flip(api.openAsk(alice, asked)),
      reply: Effect.flip(
        api.postDiscussion(carol, { body: "Yes", discussion: discussion.id })
      ),
    });

    const stored = yield* ProjectStore.use((store) => store.load());

    return {
      after,
      closed,
      daveAsks,
      nowhere,
      opened,
      stored: stored.discussions,
    };
  });

const filling = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* Effect.forEach(
      Array.range(1, DISCUSSIONS_PER_PERSON),
      (index) =>
        Effect.andThen(
          minutesOn(index),
          api.postDiscussion(dave, { title: `Thread ${index}` })
        ),
      { discard: true }
    );

    const daveAtCap = yield* Effect.flip(
      api.postDiscussion(dave, { title: "One more" })
    );

    const daveReplies = yield* api.postDiscussion(dave, {
      body: "Still talking",
      discussion: first,
    });

    const carolBeyond = yield* Effect.forEach(
      Array.range(1, DISCUSSIONS_PER_PERSON + 1),
      (index) =>
        api.postDiscussion(carol, { title: `Carol's thread ${index}` }),
      { discard: true }
    ).pipe(Effect.as("allowed"));

    return { carolBeyond, daveAtCap, daveReplies };
  });

describe.each<StoreKind>(["memory", "sqlite"])(
  "discussions over the %s store",
  (kind) => {
    const world = worldOf(scenario, kind);

    const talked = Effect.flatMap(made, talking).pipe(Effect.provide(world));

    const asked = Effect.flatMap(made, asking).pipe(Effect.provide(world));

    it.effect(
      "take a thread from anyone not denounced, and a reply from them too",
      () =>
        Effect.map(talked, (run) => {
          expect(run.opened.discussion).toMatchObject({
            id: first,
            opener: Handle.make("dave"),
            project,
            state: "open",
            title: "Which day starts a week?",
          });
          expect(run.opened.discussion.posts).toHaveLength(1);
          expect(
            run.replied.discussion.posts.map(({ body, by }) => [by, body])
          ).toStrictEqual([
            [
              "dave",
              "Weeks start on Monday in ISO 8601; which does parse assume?",
            ],
            ["carol", "ISO, always."],
          ]);
          // A thread opened with a title alone reads the title as its first post.
          expect(
            run.titleOnly.discussion.posts.map(({ body }) => body)
          ).toStrictEqual(["Does format take a locale?"]);
          expect(run.refused).toStrictEqual({
            erinOpens: new Denounced({}),
            erinReplies: new Denounced({}),
            nowhere: new UnknownDiscussion({ discussion: unknown }),
          });
        })
    );

    it.effect(
      "list newest post first with the posts counted, show one whole, and tell each post",
      () =>
        Effect.map(talked, (run) => {
          expect(run.shown.discussion).toStrictEqual(run.replied.discussion);
          expect(
            run.listed.discussions.map(({ id, posts, state }) => [
              id,
              posts,
              state,
            ])
          ).toStrictEqual([
            ["disc-000002", 1, "open"],
            ["disc-000001", 2, "open"],
          ]);
          expect(
            run.events.flatMap(({ event }) =>
              ProjectEvent.guards.DiscussionPosted(event)
                ? [[event.discussion, event.by]]
                : []
            )
          ).toStrictEqual([
            ["disc-000001", "dave"],
            ["disc-000001", "carol"],
            ["disc-000002", "dave"],
          ]);
        })
    );

    it.effect("become an ask only by a maintainer", () =>
      Effect.map(asked, (run) => {
        expect(run.daveAsks).toStrictEqual(new NotDecider({}));
        expect(run.nowhere).toStrictEqual(
          new UnknownDiscussion({ discussion: unknown })
        );
        expect(run.opened.ask.id).toBe(week);
        expect(run.after.discussion).toMatchObject({
          ask: week,
          state: "asked",
        });
      })
    );

    it.effect(
      "once asked, take no more posts and no second ask, and are kept so",
      () =>
        Effect.map(asked, (run) => {
          expect(run.closed).toStrictEqual({
            again: new DiscussionClosed({ discussion: first }),
            reply: new DiscussionClosed({ discussion: first }),
          });
          expect(run.stored).toStrictEqual([run.after.discussion]);
        })
    );
  }
);

describe("the cap on open discussions", () => {
  it.effect(
    "holds a person the project has not vouched for to twenty, and a vouched one to none",
    () =>
      Effect.gen(function* () {
        const run = yield* Effect.flatMap(made, filling);

        expect(run.daveAtCap).toStrictEqual(
          new CapReached({ cap: DISCUSSIONS_PER_PERSON, limit: "discussions" })
        );
        // The cap is on threads held open, not on posts.
        expect(run.daveReplies.discussion.posts).toHaveLength(2);
        expect(run.carolBeyond).toBe("allowed");
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );
});
