/**
 * A project's raw files through the platform's fetch handler:
 * `GET /<project>/raw/<rev>/<path…>` answers the bytes with their headers
 * to anyone, a stale bearer token or not; a path that climbs out is a
 * 404; and git's own paths beside it still reach git.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CodeCacheLive } from "@repo/project/code/cache";
import { Projects } from "@repo/project/projects";
import { keyOf, RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { Context, Effect, Layer, Option, Ref } from "effect";

import { Handlers } from "../src/handlers.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { worldOf } from "./handlers.fixtures.ts";
import { origin, served } from "./harness.ts";

const datekit = aProject({ people: [] });

const { project } = datekit;

const readme = "# datekit\n\nDates, parsed.\n";

/**
 * The platform over a world where datekit was made and its first commit,
 * a README and a manifest, pushed to main; and that commit's id. With
 * `reads`, the platform has the isolate's code cache, as `ports.ts` gives
 * it, and each tree its repo host is asked for is counted there.
 */
const platformWith = (reads: Option.Option<Ref.Ref<number>>) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const world = yield* Layer.build(worldOf([datekit]));

    const first = yield* Effect.gen(function* () {
      const host = yield* RepoHost;
      const api = yield* (yield* Projects).create(project);
      const initializer = Person.make({ handle: datekit.initializer });
      const client = yield* gitClient(memoryFs());

      yield* api.initProject(initializer, {});

      const sha = yield* client.commit("Start", [
        ["README.md", readme],
        ["package.json", '{ "name": "datekit" }\n'],
      ]);

      yield* host.push(RepoName.make(keyOf(project)), client.source, [
        { from: Option.none(), ref: RefName.make("refs/heads/main"), to: sha },
        {
          from: Option.none(),
          ref: RefName.make("refs/tags/@datekit/core@1.0.0"),
          to: sha,
        },
      ]);
      yield* api.recordFirstPush(initializer, sha);

      return sha;
    }).pipe(Effect.orDie, Effect.provide(world));

    const cached = yield* Option.match(reads, {
      onNone: () => Effect.succeed(world),
      onSome: (count) =>
        Effect.map(Layer.build(CodeCacheLive(100)), (cache) => {
          const host = Context.get(world, RepoHost);

          return Context.merge(world, cache).pipe(
            Context.add(
              RepoHost,
              RepoHost.of({
                ...host,
                readTree: (name, tree) =>
                  Effect.andThen(
                    Ref.update(count, (n) => n + 1),
                    host.readTree(name, tree)
                  ),
              })
            )
          );
        }),
    });

    const ports = Layer.succeedContext(cached);

    const { fetch } = yield* served(
      Layer.mergeAll(
        Handlers.pipe(Layer.provide(ports)),
        ports,
        MemorySessions.layer({})
      )
    );

    return { fetch, first };
  });

const platform = platformWith(Option.none());

const get = (
  fetch: (request: Request) => Effect.Effect<Response>,
  path: string,
  headers: Record<string, string> = {}
) =>
  Effect.flatMap(
    fetch(new Request(`${origin}${path}`, { headers })),
    (response) =>
      Effect.map(
        Effect.promise(() => response.text()),
        (text) => ({ headers: response.headers, status: response.status, text })
      )
  );

describe("a project's raw files", () => {
  it.effect(
    "answer anyone with the bytes and their headers, a stale bearer or not",
    () =>
      Effect.gen(function* () {
        const { fetch, first } = yield* platform;
        const path = `/${project}/raw/${first}/README.md`;

        const answers = yield* Effect.forEach(
          [{}, { authorization: "Bearer not-a-token-the-platform-knows" }],
          (headers) =>
            Effect.map(get(fetch, path, headers), (answer) => ({
              cache: answer.headers.get("cache-control"),
              etag: /^"[0-9a-f]{40}"$/u.test(answer.headers.get("etag") ?? ""),
              nosniff: answer.headers.get("x-content-type-options"),
              sandboxed: (
                answer.headers.get("content-security-policy") ?? ""
              ).includes("sandbox"),
              status: answer.status,
              text: answer.text,
              type: answer.headers.get("content-type"),
            }))
        );

        expect(answers).toStrictEqual(
          answers.map(() => ({
            cache: "public, max-age=31536000, immutable",
            etag: true,
            nosniff: "nosniff",
            sandboxed: true,
            status: 200,
            text: readme,
            type: "text/plain; charset=utf-8",
          }))
        );
        expect(answers).toHaveLength(2);

        const main = yield* get(fetch, `/${project}/raw/main/README.md`);

        expect([main.status, main.headers.get("cache-control")]).toStrictEqual([
          200,
          "public, max-age=60",
        ]);
      })
  );

  it.effect(
    "find a tag by its name, URL-encoded in one segment, slash and all",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* platform;

        const answer = yield* get(
          fetch,
          `/${project}/raw/${encodeURIComponent("@datekit/core@1.0.0")}/README.md`
        );

        expect([
          answer.status,
          answer.text,
          answer.headers.get("cache-control"),
        ]).toStrictEqual([200, readme, "public, max-age=60"]);
      })
  );

  it.effect(
    "is a 404 with no body for a path that climbs out, a missing file or project",
    () =>
      Effect.gen(function* () {
        const { fetch, first } = yield* platform;

        const answers = yield* Effect.forEach(
          [
            `/${project}/raw/${first}/../../x`,
            `/${project}/raw/${first}/..%2F..%2Fx`,
            `/${project}/raw/${first}/nope.md`,
            `/${project}/raw/v9/README.md`,
            `/nobody/raw/main/README.md`,
          ],
          (path) =>
            Effect.map(get(fetch, path), ({ status, text }) => [status, text])
        );

        expect(answers).toStrictEqual(answers.map(() => [404, ""]));
      })
  );

  it.effect("read a tree once per isolate, by its id", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const { fetch, first } = yield* platformWith(Option.some(reads));
      const path = `/${project}/raw/${first}/README.md`;

      const once = yield* get(fetch, path);
      const counted = yield* Ref.get(reads);
      const again = yield* get(fetch, path);

      expect([once.status, again.status, again.text]).toStrictEqual([
        200,
        200,
        readme,
      ]);
      expect(counted).toBeGreaterThan(0);
      expect(yield* Ref.get(reads)).toBe(counted);
    })
  );

  it.effect("leave git's own paths to git", () =>
    Effect.gen(function* () {
      const { fetch } = yield* platform;

      const answer = yield* get(
        fetch,
        `/${project}/info/refs?service=git-upload-pack`
      );

      expect(answer.status).not.toBe(404);
      expect(answer.headers.get("content-security-policy")).toBeNull();
    })
  );
});
