import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { ProjectName, RepoPath } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { treeOf } from "../src/code.ts";
import { rawOf, rawRequestOf, rawRestOf } from "../src/code/raw.ts";
import { datekit, forked, png, svg } from "./code-fixtures.ts";

const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.arrayBuffer()),
    (body) => ({
      body: new Uint8Array(body),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    })
  );

describe("a raw file", () => {
  it.effect(
    "at a commit's id is its bytes, sandboxed, unsniffed and cached for good",
    () =>
      Effect.gen(function* () {
        const { c4, code } = yield* datekit;
        const listing = yield* treeOf(code, Option.none(), Option.none());

        const blob = listing.entries.find(
          ({ name }) => name === "logo.svg"
        )?.sha;

        const { body, headers, status } = yield* read(
          yield* rawOf(code, c4, RepoPath.make("logo.svg"))
        );

        expect([status, new TextDecoder().decode(body)]).toStrictEqual([
          200,
          svg,
        ]);
        expect(headers).toMatchObject({
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": "image/svg+xml",
          etag: `"${blob}"`,
          "x-content-type-options": "nosniff",
        });
        expect(headers["content-security-policy"]).toContain("sandbox");
        expect(headers["content-security-policy"]).toContain(
          "default-src 'none'"
        );
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("at main or a tag is cached for a minute", () =>
    Effect.gen(function* () {
      const { code } = yield* datekit;

      const cached = (rev: string) =>
        Effect.map(rawOf(code, rev, RepoPath.make("README.md")), (response) => [
          response.status,
          response.headers.get("cache-control"),
        ]);

      expect(
        yield* Effect.all([cached("main"), cached("v1.9.0")])
      ).toStrictEqual([
        [200, "public, max-age=60"],
        [200, "public, max-age=60"],
      ]);
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "is typed by its extension: images as themselves, markup and the rest as text, binary as bytes",
    () =>
      Effect.gen(function* () {
        const { code } = yield* datekit;

        const typed = (path: string) =>
          Effect.map(rawOf(code, "main", RepoPath.make(path)), (response) =>
            response.headers.get("content-type")
          );

        expect(
          yield* Effect.all([
            typed("logo.png"),
            typed("page.html"),
            typed("feed.xml"),
            typed("README.md"),
          ])
        ).toStrictEqual([
          "image/png",
          "text/plain; charset=utf-8",
          "text/plain; charset=utf-8",
          "text/plain; charset=utf-8",
        ]);

        const image = yield* read(
          yield* rawOf(code, "main", RepoPath.make("logo.png"))
        );

        expect(image.body).toStrictEqual(png);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "that is missing, a folder, a submodule or at no revision is a 404 with no body",
    () =>
      Effect.gen(function* () {
        const { code } = yield* datekit;

        const missing = (rev: string, path: string) =>
          Effect.flatMap(rawOf(code, rev, RepoPath.make(path)), read);

        const answers = yield* Effect.all([
          missing("main", "nope.txt"),
          missing("main", "src"),
          missing("main", "vendor"),
          missing("v9", "README.md"),
          missing("main", "src/../README.md"),
        ]);

        expect(
          answers.map(({ body, headers, status }) => [
            status,
            body.length,
            headers["x-content-type-options"],
            headers["content-security-policy"]?.endsWith("; sandbox"),
          ])
        ).toStrictEqual(answers.map(() => [404, 0, "nosniff", true]));
        expect(answers).toHaveLength(5);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "at a listed fork's address is the fork's bytes, and at a fork the project does not list a 404",
    () =>
      Effect.gen(function* () {
        const { code } = yield* forked;

        const at = (rev: string) =>
          Effect.flatMap(rawOf(code, rev, RepoPath.make("src/parse.ts")), read);

        const listed = yield* at("@bob/parse-iso");
        const unlisted = yield* at("@carol/parse-iso");

        expect([
          listed.status,
          new TextDecoder().decode(listed.body),
        ]).toStrictEqual([200, "export const parse = Date.parse;\n"]);
        expect([unlisted.status, unlisted.body.length]).toStrictEqual([404, 0]);
      }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("a raw request's path", () => {
  it("is a revision, then a file's path, each decoded once", () => {
    expect(
      [
        "main/README.md",
        "%40datekit%2Fcore%402.0.0/docs/a%20b.md",
        `${"a".repeat(40)}/src/a.ts`,
        "main",
        "main/",
        "main/src//a.ts",
        "main/../x",
        "main/src/%2E%2E/x",
        "main/..%2Fx",
        "main/%E0%A4%A",
      ].map(rawRequestOf)
    ).toStrictEqual([
      Option.some({ path: "README.md", rev: "main" }),
      Option.some({ path: "docs/a b.md", rev: "@datekit/core@2.0.0" }),
      Option.some({ path: "src/a.ts", rev: "a".repeat(40) }),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });
});

describe("a raw request's URL", () => {
  it("gives everything after the project's raw/, still encoded", () => {
    expect(
      [
        "https://host.example/alice/datekit/raw/%40datekit%2Fcore%402.0.0/README.md",
        "/alice/datekit/raw/main/docs/a%20b.md?plain=1#L2",
        "/alice/datekit/raw/main",
        "/datekit/raw/main/README.md",
      ].map((url) => rawRestOf(url, ProjectName.make("alice/datekit")))
    ).toStrictEqual([
      "%40datekit%2Fcore%402.0.0/README.md",
      "main/docs/a%20b.md",
      "main",
      "main/README.md",
    ]);
  });
});
