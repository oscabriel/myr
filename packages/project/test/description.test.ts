import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { PROJECT_DESCRIPTION_CAP } from "@repo/protocol/domain/front-page";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { keyOf, LandedSha, ProjectName, RepoName } from "@repo/protocol/ids";
import { DateTime, Effect, Layer, Logger, Option, Ref } from "effect";

import type { CodeProject } from "../src/code.ts";
import { descriptionOf, withDescriptions } from "../src/description.ts";
import { ProjectDescriptionsMemory } from "../src/description/memory.ts";
import { Content, writer } from "./code-fixtures.ts";

const lines = (...text: readonly string[]) => text.join("\n");

describe(descriptionOf, () => {
  it("is the README's first paragraph under its title", () => {
    expect(
      descriptionOf(
        lines(
          "# datekit",
          "",
          "Small, dependency-free date helpers: parse, format, add and diff.",
          "",
          "A fictional project: it and its people are invented.",
          ""
        )
      )
    ).toStrictEqual(
      Option.some(
        "Small, dependency-free date helpers: parse, format, add and diff."
      )
    );
  });

  it("passes over a centred banner, badges and images to the first prose", () => {
    expect(
      descriptionOf(
        lines(
          '<p align="center">',
          '  <img src="logo.svg" alt="ky" width="200">',
          "</p>",
          "",
          "[![CI](https://ci.example/badge.svg)](https://ci.example) ![npm](https://img.example/npm.svg)",
          "",
          "> Tiny and elegant HTTP client based on the [Fetch API](https://fetch.spec.whatwg.org)",
          ""
        )
      )
    ).toStrictEqual(
      Option.some("Tiny and elegant HTTP client based on the Fetch API")
    );
  });

  it("reads a wrapped paragraph as one line, its markup as plain text", () => {
    expect(
      descriptionOf(
        lines(
          "Click",
          "=====",
          "",
          "Click is a **Python** package for creating",
          "beautiful command line interfaces with `as little code`",
          "as necessary.<br>",
          "",
          "```sh",
          "pip install click",
          "```"
        )
      )
    ).toStrictEqual(
      Option.some(
        "Click is a Python package for creating beautiful command line interfaces with as little code as necessary."
      )
    );
  });

  it("cuts a long paragraph at a word, within the cap", () => {
    const long = descriptionOf(
      `${"A word that repeats ".repeat(20)}until the end.`
    ).pipe(Option.getOrThrow);

    expect(long.length).toBeLessThanOrEqual(PROJECT_DESCRIPTION_CAP);
    expect(long).toMatch(/^A word that repeats .+ repeats…$/u);
  });

  it("is none for a README of headings, badges and code alone", () => {
    expect(
      descriptionOf(
        lines(
          "# empty",
          "",
          "[![CI](https://ci.example/badge.svg)](https://ci.example)",
          "",
          "## Install",
          "",
          "    npm install empty",
          "",
          "---"
        )
      )
    ).toStrictEqual(Option.none());
  });
});

const datekit = ProjectName.make("alice/datekit");

const burrow = ProjectName.make("alice/burrow");

const landedAt = (iso: string) => DateTime.makeUnsafe(iso);

const listingOf = (
  project: ProjectName,
  landed?: string
): ProjectListing =>
  landed === undefined
    ? { openAsks: 1, posture: "open", project }
    : { landedAt: landedAt(landed), openAsks: 1, posture: "open", project };

/** A repo whose main holds one README, read through a record that counts its reads. */
const withReadme = (project: ProjectName, readme: string) =>
  Effect.gen(function* () {
    const git = yield* writer;
    const repo = RepoName.make(keyOf(project));
    const sha = yield* git.commit("Start", [["README.md", Content.Text({ text: readme })]], [], 1);

    yield* git.push(repo, [["refs/heads/main", sha]]);

    const reads = yield* Ref.make(0);

    const code: CodeProject = {
      forks: Effect.succeed([]),
      head: Effect.as(Ref.update(reads, (n) => n + 1), Option.some(LandedSha.make(sha))),
      landings: () => Effect.succeed([]),
      project,
      repo,
    };

    return { code, reads };
  });

const described = (listed: readonly ProjectListing[]) =>
  Object.fromEntries(
    listed.map(({ description, project }) => [project, description])
  );

describe(withDescriptions, () => {
  it.effect(
    "gives each landed project its README's first paragraph, and one not yet landed none",
    () =>
      Effect.gen(function* () {
        const { code } = yield* withReadme(datekit, "# datekit\n\nDate helpers.\n");

        const listed = yield* withDescriptions(
          [listingOf(datekit, "2026-10-12T12:00:00Z"), listingOf(burrow)],
          (project) =>
            project === datekit ? Effect.succeed(code) : Effect.die("never read")
        );

        expect(described(listed)).toStrictEqual({
          [burrow]: undefined,
          [datekit]: "Date helpers.",
        });
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("reads a project once while its last landing stands, and again after the next", () =>
    Effect.gen(function* () {
      const { code, reads } = yield* withReadme(datekit, "# datekit\n\nDate helpers.\n");
      const codeOf = () => Effect.succeed(code);

      yield* withDescriptions([listingOf(datekit, "2026-10-12T12:00:00Z")], codeOf);
      const kept = yield* withDescriptions([listingOf(datekit, "2026-10-12T12:00:00Z")], codeOf);
      const readOnce = yield* Ref.get(reads);

      yield* withDescriptions([listingOf(datekit, "2026-10-12T13:00:00Z")], codeOf);

      expect(described(kept)).toStrictEqual({ [datekit]: "Date helpers." });
      expect([readOnce, yield* Ref.get(reads)]).toStrictEqual([1, 2]);
    }).pipe(Effect.provide(Layer.merge(RepoHostMemory, ProjectDescriptionsMemory)))
  );

  it.effect("lists a project whose README cannot be read, with no description", () =>
    Effect.gen(function* () {
      const listed = yield* withDescriptions(
        [listingOf(datekit, "2026-10-12T12:00:00Z")],
        () => Effect.die("the record is gone")
      ).pipe(Effect.provide(Logger.layer([])));

      expect(listed).toStrictEqual([listingOf(datekit, "2026-10-12T12:00:00Z")]);
    }).pipe(Effect.provide(RepoHostMemory))
  );
});
