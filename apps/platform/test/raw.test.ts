/**
 * A project's raw files through the platform's fetch handler:
 * `GET /<project>/raw/<rev>/<path…>` answers the bytes with their headers
 * to anyone, a stale bearer token or not; a path that climbs out is a
 * 404; and git's own paths beside it still reach git.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Projects } from "@repo/project/projects";
import { RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { Effect, Layer, Option } from "effect";

import { Handlers } from "../src/handlers.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { worldOf } from "./handlers.fixtures.ts";
import { origin, served } from "./harness.ts";

const datekit = aProject({ people: [] });

const { project } = datekit;

const readme = "# datekit\n\nDates, parsed.\n";

/**
 * The platform over a world where datekit was made and its first commit,
 * a README and a manifest, pushed to main; and that commit's id.
 */
const platform = Effect.gen(function* () {
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

    yield* host.push(RepoName.make(project), client.source, [
      { from: Option.none(), ref: RefName.make("refs/heads/main"), to: sha },
    ]);
    yield* api.recordFirstPush(initializer, sha);

    return sha;
  }).pipe(Effect.orDie, Effect.provide(world));

  const ports = Layer.succeedContext(world);

  const { fetch } = yield* served(
    Layer.mergeAll(
      Handlers.pipe(Layer.provide(ports)),
      ports,
      MemorySessions.layer({})
    )
  );

  return { fetch, first };
});

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
