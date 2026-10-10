/**
 * A project's page, rendered to HTML with `react-dom/server` from fixtures
 * decoded with the protocol's own schemas: its posture label, how to take
 * part, its open asks (a blocked one names what it waits on) and its recent
 * landings, each with its author and its credit trailers as the commit
 * carries them.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { AskListing } from "@repo/protocol/domain/ask";
import { FileView, TreeListing } from "@repo/protocol/domain/code";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { LandingView } from "@repo/protocol/domain/landing";
import { UnknownRevision } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization, RpcTest } from "effect/rpc";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { devServer } from "../src/dev/server.ts";
import {
  ProjectReadingView,
  ProjectView,
} from "../src/features/project/project-page.tsx";
import { UnknownProjectView } from "../src/features/project/unknown-project.tsx";
import {
  ProjectPageData,
  readProjectPage,
} from "../src/routes/$project/index.tsx";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** The markup of the row for `ask`: from its `<li>` to the next ask's row. */
const rowOf = (markup: string, ask: string) => {
  const start = markup.indexOf(`data-ask="${ask}"`);
  const next = markup.indexOf("data-ask=", start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const platformUrl = "https://platform-test.example.workers.dev";

const listing = Schema.decodeSync(ProjectListing)({
  landedAt: "2026-10-06T09:00:00.000Z",
  openAsks: 2,
  posture: "openWithSealedEvidence",
  project: "datekit",
});

const asks = Schema.decodeSync(Schema.Array(AskListing))([
  {
    ask: "fix-week-start",
    blockedBy: [],
    claimed: false,
    kind: "bug",
    territory: "core",
    want: "A week starts on the locale's first day, not always on Sunday.",
  },
  {
    ask: "drop-legacy-parse",
    blockedBy: ["split-core", "split-format"],
    claimed: false,
    kind: "migrate",
    territory: "parse",
    want: "Nothing calls the legacy parser any more.",
  },
]);

const landings = Schema.decodeSync(Schema.Array(LandingView))([
  {
    ask: "parse-iso-week",
    assisted: [{ harness: "claude-code", verified: true }],
    author: "bram",
    credits: [
      { handle: "bram", role: "Signed-off-by" },
      { handle: "ines-v", role: "Asked-by" },
    ],
    landedAt: "2026-10-06T09:00:00.000Z",
    parent: "1111111111111111111111111111111111111111",
    project: "datekit",
    sha: "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c",
  },
  {
    ask: "format-era",
    assisted: [],
    author: "okonkwo",
    credits: [
      { handle: "okonkwo", role: "Signed-off-by" },
      { handle: "lin-h", role: "Asked-by" },
    ],
    landedAt: "2026-10-04T09:00:00.000Z",
    parent: "2222222222222222222222222222222222222222",
    project: "datekit",
    sha: "1111111111111111111111111111111111111111",
  },
]);

const page = (
  <ProjectView
    asks={asks}
    landings={landings}
    listing={listing}
    now={now}
    platformUrl={platformUrl}
  />
);

describe(ProjectView, () => {
  it("shows each landing's subject line and links its author to their page", () => {
    const text = textOf(page);
    const markup = markupOf(page);

    expect(text).toContain("Answer parse-iso-week");
    expect(text).toContain("Answer format-era");
    expect(markup).toMatch(/<a\b[^>]*href="\/people\/bram"[^>]*>bram<\/a>/u);
    expect(markup).toMatch(
      /<a\b[^>]*href="\/people\/okonkwo"[^>]*>okonkwo<\/a>/u
    );
  });

  it("shows each landing's credit trailers as the commit carries them, Assisted-by apart", () => {
    const text = textOf(page);

    const at = [
      "Asked-by: ines-v",
      "Signed-off-by: bram",
      "not credit",
      "Assisted-by: claude-code (verified)",
      "Asked-by: lin-h",
      "Signed-off-by: okonkwo",
    ].map((part) => text.indexOf(part));

    // Each landing's credit in trailer order, then its agents, apart.
    expect(at.every((position) => position >= 0)).toBeTruthy();
    expect(at.toSorted((one, other) => one - other)).toStrictEqual(at);
  });

  it("shows a blocked ask as blocked, linking every ask it waits on", () => {
    const markup = markupOf(page);
    const row = rowOf(markup, "drop-legacy-parse");

    expect(row).toMatch(/Blocked/u);
    expect(row).toContain('href="/datekit/asks/split-core"');
    expect(row).toContain('href="/datekit/asks/split-format"');
  });

  it("lists every open ask with its want, kind and territory", () => {
    const row = rowOf(markupOf(page), "fix-week-start");

    expect(row).toContain('href="/datekit/asks/fix-week-start"');
    expect(row).toContain(
      "A week starts on the locale&#x27;s first day, not always on Sunday."
    );
    expect(row).toMatch(/>Kind<\/dt><dd\b[^>]*>bug<\/dd>/u);
    expect(row).toMatch(/>Territory<\/dt><dd\b[^>]*>core<\/dd>/u);
  });

  it("shows the posture label of the project as it is listed", () => {
    const markup = markupOf(page);

    expect(markup).toContain('data-posture="openWithSealedEvidence"');
    expect(textOf(page)).toContain("Open with sealed evidence");
  });

  it("shows how to take part: clone over plain git, then the CLI's asks, claim and check", () => {
    const text = textOf(page);

    expect(text).toContain(`git clone ${platformUrl}/datekit.git`);
    expect(text).toContain(`${Brand.cli} asks --project datekit`);
    expect(text).toContain(`${Brand.cli} claim <ask>`);
    expect(text).toContain(`${Brand.cli} check`);
  });

  it("says an empty project is empty, with the commands that would fill it", () => {
    const { landedAt: _landed, ...unlanded } = listing;

    const text = textOf(
      <ProjectView
        asks={[]}
        landings={[]}
        listing={{ ...unlanded, openAsks: 0 }}
        now={now}
        platformUrl={platformUrl}
      />
    );

    expect(text).toContain("No open asks");
    expect(text).toContain(`${Brand.cli} ask open`);
    expect(text).toContain("Nothing has landed");
    // The project exists, so `init` would refuse it: its first push lands main.
    expect(text).toContain(`git push ${platformUrl}/datekit.git HEAD:main`);
    expect(text).not.toContain(`${Brand.cli} init`);
  });

  it("never says nothing has landed on a project whose main has landed", () => {
    const text = textOf(
      <ProjectView
        asks={asks}
        landings={[]}
        listing={listing}
        now={now}
        platformUrl={platformUrl}
      />
    );

    expect(text).toContain("Last landed");
    expect(text).not.toContain("Nothing has landed");
    expect(text).not.toContain("git push");
  });
});

describe("the project's code on its page", () => {
  const AT = "a".repeat(40);

  const root = Schema.decodeSync(TreeListing)({
    at: AT,
    entries: [
      {
        mode: "040000",
        name: "src",
        path: "src",
        sha: "b".repeat(40),
        type: "tree",
      },
      {
        mode: "100644",
        name: "README.md",
        path: "README.md",
        sha: "c".repeat(40),
        type: "blob",
      },
    ],
    readme: { path: "README.md", sha: "c".repeat(40) },
  });

  const readme = Schema.decodeSync(FileView)({
    at: AT,
    binary: false,
    path: "README.md",
    sha: "c".repeat(40),
    size: 26,
    text: "# datekit\n\nDates, kept.\n",
    truncated: false,
  });

  const withCode = (
    <ProjectView
      asks={asks}
      code={{ readme, root }}
      landings={landings}
      listing={listing}
      now={now}
      platformUrl={platformUrl}
    />
  );

  it("shows the clone line in a box of its own, above the asks", () => {
    const markup = markupOf(withCode);
    const clone = markup.indexOf('data-clone=""');

    expect(clone).toBeGreaterThan(-1);
    expect(
      markup.indexOf(`git clone ${platformUrl}/datekit.git`, clone)
    ).toBeGreaterThan(clone);
    expect(clone).toBeLessThan(markup.indexOf('id="open-asks"'));
  });

  it("lists the root's entries, each linking its page at main", () => {
    const markup = markupOf(withCode);

    expect(markup).toContain('href="/datekit/tree/main/src"');
    expect(markup).toContain('href="/datekit/blob/main/README.md"');
  });

  it("renders the root README", () => {
    expect(markupOf(withCode)).toContain('data-readme="README.md"');
    expect(textOf(withCode)).toContain("Dates, kept.");
  });

  it("shows no code section before the code is read", () => {
    expect(markupOf(page)).not.toContain("data-readme=");
  });
});

/** The contracts over HTTP, each request answered by `answer`. */
const clientOver = (answer: (request: Request) => Promise<Response>) =>
  Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url: "http://localhost/rpc" })),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
        answer(new Request(input, init))
      )
    )
  );

/**
 * The contracts over a fresh dev world, as the Worker's loader reaches
 * them in process; the world ends with the scope.
 */
const devWorld = Layer.unwrap(
  Effect.gen(function* () {
    const { dispose, handler } = devServer();

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    return clientOver(handler);
  })
);

/** A platform that does not answer: every call comes back a 503. */
const unanswering = clientOver(() =>
  Promise.resolve(new Response("", { status: 503 }))
);

/** A platform that knows every project and has landed nothing on any. */
const nothingLanded = Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
  Layer.provide([
    Layer.mergeAll(
      unanswered,
      Contracts.toLayerHandler("readTree", ({ at }) =>
        Effect.fail(new UnknownRevision({ rev: at ?? "main" }))
      )
    ),
    asTester,
  ])
);

const decodePage = Schema.decodeEffect(ProjectPageData);

/** A fresh dev world seeds itself first, which a full test run can slow past 5 s. */
const seededWorld = { timeout: 30_000 };

describe("the project's page as the server sends it", () => {
  it.effect(
    "carries datekit's README and its root entries, read on the server",
    () =>
      Effect.gen(function* () {
        const { code } = yield* readProjectPage("datekit").pipe(
          Effect.flatMap(decodePage),
          Effect.provide(devWorld)
        );

        const sent = (
          <ProjectReadingView
            code={code}
            platformUrl={platformUrl}
            project={listing.project}
          />
        );

        expect(textOf(sent)).toContain("Small, dependency-free date helpers");
        expect(markupOf(sent)).toContain('data-readme="README.md"');
        expect(markupOf(sent)).toContain('href="/datekit/tree/main/src"');
        expect(textOf(sent)).toContain(`git clone ${platformUrl}/datekit.git`);
      }),
    seededWorld
  );

  it.effect(
    "shows a project whose main has not landed with no code, and no error",
    () =>
      Effect.gen(function* () {
        const { code } = yield* readProjectPage("datekit").pipe(
          Effect.flatMap(decodePage),
          Effect.provide(nothingLanded)
        );

        expect(code).toBeUndefined();

        const sent = (
          <ProjectReadingView
            code={code}
            platformUrl={platformUrl}
            project={listing.project}
          />
        );

        const shown = (
          <ProjectView
            asks={asks}
            code={code}
            landings={[]}
            listing={listing}
            now={now}
            platformUrl={platformUrl}
          />
        );

        expect(markupOf(sent)).not.toContain('id="code"');
        expect(markupOf(shown)).not.toContain('id="code"');
        expect(rowOf(markupOf(shown), "fix-week-start")).toContain(
          'href="/datekit/asks/fix-week-start"'
        );
      })
  );

  it.effect(
    "is sent without its code, not as a not-found, when the platform does not answer",
    () =>
      Effect.gen(function* () {
        const { code } = yield* readProjectPage("datekit").pipe(
          Effect.flatMap(decodePage),
          Effect.provide(unanswering)
        );

        expect(code).toBeUndefined();
      })
  );

  it.effect.each(["no-such-project", "Not_A_Project"])(
    "is a not-found for %s, which the platform does not know",
    (name) =>
      Effect.gen(function* () {
        const failed = yield* Effect.flip(
          readProjectPage(name).pipe(Effect.provide(devWorld))
        );

        expect(isNotFound(failed)).toBeTruthy();
      }),
    seededWorld
  );
});

describe(UnknownProjectView, () => {
  it("shows the platform's UnknownProject refusal for a name that could be a project", () => {
    const markup = markupOf(<UnknownProjectView name="no-such-project" />);

    expect(markup).toContain('data-refusal="UnknownProject"');
    expect(markup).toContain("no-such-project");
  });

  it("says in a sentence that an address naming no possible project names none", () => {
    const markup = markupOf(<UnknownProjectView name="Not_A_Project" />);

    expect(markup).not.toContain("data-refusal");
    expect(textOf(<UnknownProjectView name="Not_A_Project" />)).toContain(
      "No such project"
    );
  });
});

describe("the project, front page, people and code views", () => {
  // Views only: props in, markup out. A view that fetched would tie its page
  // to one transport (src/surfaces.ts); the atoms live in src/client/.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/{front,project,people,code}/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const transport =
    /from\s+["'](?:@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);

    const reaching = Object.entries(sources).flatMap(([path, source]) =>
      transport.test(source) ? [path] : []
    );

    expect(reaching).toStrictEqual([]);
  });
});
