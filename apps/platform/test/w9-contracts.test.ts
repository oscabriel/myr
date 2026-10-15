import { describe, expect, it } from "@effect/vitest";
import { Projects } from "@repo/project/projects";
import { AskId, Handle, RepoPath } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Effect, Exit, Layer } from "effect";

import { Handlers } from "../src/handlers.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { seeded, worldOf } from "./handlers.fixtures.ts";
import { origin, rpcClient, served } from "./harness.ts";

const datekit = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = datekit;

const sessions = MemorySessions.layer({});

const platform = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const world = yield* Layer.build(worldOf([datekit]));

  yield* seeded(datekit).pipe(Effect.provide(world));

  const ports = Layer.succeedContext(world);

  return yield* served(
    Layer.mergeAll(Handlers.pipe(Layer.provide(ports)), ports, sessions)
  );
});

describe("the code, policy and discussion contracts over /rpc", () => {
  it.effect("give anyone a project's policy, without its layers", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      const read = yield* anyone.projectPolicy({ project });
      const { policy } = read;

      expect(Object.keys(read)).toStrictEqual(["policy"]);
      expect(policy?.source).toBe("config");
      expect(policy?.deciders).toStrictEqual(datekit.policy.deciders);
      expect(Object.keys(policy ?? {})).not.toContain("visibility");
      expect(Object.keys(policy ?? {})).not.toContain("asks");
    })
  );

  it.effect("give anyone an opening's landing, naming the ask it opened", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);
      const ask = AskId.make("parse-iso");
      const { ask: opened } = yield* anyone.showAsk({ ask, project });

      const { landing } = yield* anyone.landing({
        project,
        sha: opened.openedIn,
      });

      expect({ ask: landing.ask, opened: landing.opened }).toStrictEqual({
        ask: undefined,
        opened: ask,
      });
    })
  );

  it.effect(
    "reach the code façade, whose why names the landing behind each line",
    () =>
      Effect.gen(function* () {
        const { handler } = yield* platform;
        const anyone = yield* rpcClient(handler);
        const path = RepoPath.make("package.json");
        const view = yield* anyone.why({ path, project });
        const [first] = view.commits;

        expect(view.path).toBe(path);
        expect(first?.subject).toBe("Start");
        expect(view.ranges).toStrictEqual([
          { end: 1, sha: first?.sha, start: 1 },
        ]);
        expect(
          view.landings.map(({ author, sha }) => [sha, author])
        ).toStrictEqual([[first?.sha, "alice"]]);
      })
  );

  it.effect("refuse a post to anyone not signed in", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      expect(
        yield* Effect.exit(
          anyone.postDiscussion({ project, title: "ISO week dates" })
        )
      ).toStrictEqual(Exit.fail(new Unauthenticated()));
    })
  );
});

// Projects a handler must not wake: a call to one is a defect, so a test over it fails.
const asleep = Layer.succeed(
  Projects,
  Projects.of({
    create: (name) => Effect.die(`a handler made ${name}`),
    get: (name) => Effect.die(`a handler woke ${name}`),
  })
);

const sleeping = Effect.gen(function* () {
  const world = yield* Layer.build(worldOf([datekit]));

  const ports = Layer.mergeAll(asleep, Layer.succeedContext(world));

  return yield* served(
    Layer.mergeAll(
      Handlers.pipe(Layer.provide(ports)),
      ports,
      MemorySessions.layer({ "bob-token": Handle.make("bob") })
    )
  );
});

describe("whoami over /rpc", () => {
  it.effect("names the caller from the session, and wakes no project", () =>
    Effect.gen(function* () {
      const { handler } = yield* sleeping;
      const bob = yield* rpcClient(handler, "bob-token");

      expect(yield* bob.whoami({})).toStrictEqual({ handle: "bob" });
    })
  );

  it.effect("refuses a caller with no session", () =>
    Effect.gen(function* () {
      const { handler } = yield* sleeping;
      const anyone = yield* rpcClient(handler);

      expect(yield* Effect.exit(anyone.whoami({}))).toStrictEqual(
        Exit.fail(new Unauthenticated())
      );
    })
  );
});

describe("the host page and raw files routes", () => {
  it.effect(
    "answer / and a project's raw files from their slots, a stale bearer or not",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* platform;

        const stale = {
          authorization: "Bearer not-a-token-the-platform-knows",
        };

        const read = (path: string, headers: Record<string, string> = {}) =>
          Effect.flatMap(
            fetch(new Request(`${origin}${path}`, { headers })),
            (response) =>
              Effect.map(
                Effect.promise(() => response.text()),
                (text) => ({ status: response.status, text })
              )
          );

        const raw = `/${project}/raw/${"4".repeat(40)}/README.md`;

        expect({
          home: (yield* read("/")).status,
          homeStale: (yield* read("/", stale)).status,
          raw: yield* read(raw),
          rawStale: yield* read(raw, stale),
        }).toStrictEqual({
          home: 200,
          homeStale: 200,
          raw: { status: 404, text: "" },
          rawStale: { status: 404, text: "" },
        });
      })
  );

  it.effect("leaves git's own paths to git, beside the raw route", () =>
    Effect.gen(function* () {
      const { fetch } = yield* platform;

      const response = yield* fetch(
        new Request(`${origin}/${project}/raw/info/refs`)
      );

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => response.text())).toBe("");
    })
  );
});
