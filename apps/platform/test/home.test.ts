import { describe, expect, it } from "@effect/vitest";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { frontLlms } from "@repo/agent-kit/host-doc";
import { Brand } from "@repo/brand";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { StandingPosturesMemory } from "@repo/project/standing-posture/memory";
import { Contracts } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Option, Ref } from "effect";

import { MemorySessions } from "../src/sessions/memory.ts";
import { HostInfo } from "../src/surfaces.ts";
import { noProjects, origin, served } from "./harness.ts";

const webUrl = "https://web-test.example.workers.dev";

const projects: readonly ProjectListing[] = [
  {
    openAsks: 3,
    posture: "open",
    project: ProjectName.make("alice/datekit"),
  },
  {
    openAsks: 1,
    posture: "openWithSealedEvidence",
    project: ProjectName.make("alice/burrow"),
  },
];

const datekitSealed = Layer.succeed(
  Projects,
  Projects.of({
    create: () => Effect.die("the home page makes no project"),
    get: (project) =>
      project === "alice/datekit"
        ? Effect.succeed(
            untouchable<ProjectApi>("ProjectApi", {
              standing: () =>
                Effect.succeed({ posture: "openWithSealedEvidence", seen: 1 }),
            })
          )
        : Effect.fail(new UnknownProject({ project })),
  })
);

const noneMade = Layer.succeed(
  Projects,
  Projects.of({
    create: () => Effect.die("the home page makes no project"),
    get: (project) => Effect.fail(new UnknownProject({ project })),
  })
);

const platform = (
  listed: readonly ProjectListing[],
  web: Option.Option<string> = Option.some(webUrl),
  made: Layer.Layer<Projects> = noneMade
) =>
  served(
    Layer.mergeAll(
      made,
      noProjects,
      MemorySessions.layer({}),
      FrontPageMemory.layer({ credits: [], entries: [], projects: listed }),
      Layer.succeed(
        HostInfo,
        HostInfo.of({ draftModel: "@cf/test/drafter", webUrl: web })
      )
    )
  );

const home = (
  listed: readonly ProjectListing[],
  init: RequestInit = {},
  web?: Option.Option<string>,
  made?: Layer.Layer<Projects>
) =>
  Effect.gen(function* () {
    const { fetch } = yield* platform(listed, web, made);
    const response = yield* fetch(new Request(`${origin}/`, init));

    return {
      status: response.status,
      text: yield* Effect.promise(() => response.text()),
      type: response.headers.get("content-type"),
    };
  });

const html = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("the platform's /", () => {
  it.effect("tells a browser what this host serves, from its origin", () =>
    Effect.gen(function* () {
      const { status, text, type } = yield* home(projects, html);

      expect(status).toBe(200);
      expect(type).toBe("text/html; charset=utf-8");
      expect(text).toContain(`<h1>${Brand.name}</h1>`);

      for (const named of [
        `git clone ${origin}/alice/datekit.git`,
        `git clone ${origin}/alice/burrow.git`,
        `curl -fsSL ${origin}/install.sh | sh`,
        `${origin}/releases/manifest.json`,
        `${origin}/mcp`,
        "2026-07-28",
        `POST ${origin}/rpc`,
        `${origin}/.well-known/agent-skills/index.json`,
        `${origin}/.well-known/oauth-protected-resource`,
        `${origin}/.well-known/oauth-authorization-server`,
        `${origin}/signup`,
        `${origin}/authorize`,
        "@cf/test/drafter",
        `${origin}/health`,
        `<a href="${webUrl}">Open the web app</a>`,
      ]) {
        expect(text).toContain(named);
      }
    })
  );

  it.effect("links no web app on a host that has none", () =>
    Effect.gen(function* () {
      const { status, text } = yield* home(projects, html, Option.none());

      expect(status).toBe(200);
      expect(text).not.toContain("Open the web app");
      expect(text).not.toContain(webUrl);
    })
  );

  it.effect("says so when no project is listed yet", () =>
    Effect.gen(function* () {
      const { text } = yield* home([], html);

      expect(text).toContain("No project is on the platform yet.");
      expect(text).not.toContain("git clone");
    })
  );

  it.effect("escapes whatever a listing names", () =>
    Effect.gen(function* () {
      const crafted = ProjectName.make(`<script>alert("x")</script>`, {
        disableChecks: true,
      });

      const { text } = yield* home(
        [{ openAsks: 0, posture: "open", project: crafted }],
        html
      );

      expect(text).not.toContain("<script>");
      expect(text).toContain(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
      );
    })
  );

  it.effect("gives an agent the web's /llms.txt as Markdown", () =>
    Effect.gen(function* () {
      const expected = frontLlms({
        commands: commandDocs(Contracts),
        platformUrl: origin,
        projects,
        webUrl,
      });

      const markdown = yield* home(projects, {
        headers: { accept: "text/markdown" },
      });

      const plain = yield* home(projects, {
        headers: { accept: "text/plain" },
      });

      expect(markdown).toStrictEqual({
        status: 200,
        text: expected,
        type: "text/markdown; charset=utf-8",
      });
      expect(plain.text).toBe(expected);
    })
  );

  it.effect(
    "gives each project the posture its own ledger stands at, as the web's /llms.txt does",
    () =>
      Effect.gen(function* () {
        const { text } = yield* home(
          projects,
          { headers: { accept: "text/markdown" } },
          undefined,
          datekitSealed
        );

        expect(text).toBe(
          frontLlms({
            commands: commandDocs(Contracts),
            platformUrl: origin,
            projects: [
              {
                openAsks: 3,
                posture: "openWithSealedEvidence",
                project: ProjectName.make("alice/datekit"),
              },
              {
                openAsks: 1,
                posture: "openWithSealedEvidence",
                project: ProjectName.make("alice/burrow"),
              },
            ],
            webUrl,
          })
        );
        expect(text).toContain(
          `- [alice/datekit](${webUrl}/alice/datekit/llms.txt): Open with sealed evidence, 3 open asks.`
        );
      })
  );

  it.effect(
    "keeps the posture it read in the platform's kept postures, so a second / reads no project",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0);

        const counted = Layer.succeed(
          Projects,
          Projects.of({
            create: () => Effect.die("the home page makes no project"),
            get: (project) =>
              project === "alice/datekit"
                ? Effect.succeed(
                    untouchable<ProjectApi>("ProjectApi", {
                      standing: () =>
                        Effect.as(
                          Ref.update(reads, (count) => count + 1),
                          { posture: "openWithSealedEvidence", seen: 1 }
                        ),
                    })
                  )
                : Effect.fail(new UnknownProject({ project })),
          })
        );

        const { fetch } = yield* served(
          Layer.mergeAll(
            counted,
            noProjects,
            StandingPosturesMemory,
            MemorySessions.layer({}),
            FrontPageMemory.layer({ credits: [], entries: [], projects }),
            Layer.succeed(
              HostInfo,
              HostInfo.of({
                draftModel: "@cf/test/drafter",
                webUrl: Option.some(webUrl),
              })
            )
          )
        );

        const markdown = { headers: { accept: "text/markdown" } };

        for (const _ of [1, 2]) {
          const response = yield* fetch(new Request(`${origin}/`, markdown));
          const text = yield* Effect.promise(() => response.text());

          expect(text).toContain(
            `- [alice/datekit](${webUrl}/alice/datekit/llms.txt): Open with sealed evidence, 3 open asks.`
          );
        }

        expect(yield* Ref.get(reads)).toBe(1);
      })
  );

  it.effect(
    "gives an agent the platform's own Markdown on a host with no web app",
    () =>
      Effect.gen(function* () {
        const { text, type } = yield* home(
          projects,
          { headers: { accept: "text/markdown" } },
          Option.none()
        );

        expect({ text, type }).toStrictEqual({
          text: frontLlms({
            commands: commandDocs(Contracts),
            platformUrl: origin,
            projects,
          }),
          type: "text/markdown; charset=utf-8",
        });
      })
  );

  it.effect.each([
    { accept: undefined, wants: "html" },
    { accept: "*/*", wants: "html" },
    {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      wants: "html",
    },
    { accept: "text/html, text/markdown;q=0.5", wants: "html" },
    { accept: "text/html;q=0.5, text/markdown", wants: "markdown" },
    { accept: "text/plain, text/html", wants: "markdown" },
    { accept: "text/markdown;q=0, text/html;q=0.1", wants: "html" },
  ])("answers Accept $accept with $wants", ({ accept, wants }) =>
    Effect.gen(function* () {
      const { type } = yield* home(
        projects,
        accept === undefined ? {} : { headers: { accept } }
      );

      expect(type).toBe(
        wants === "html"
          ? "text/html; charset=utf-8"
          : "text/markdown; charset=utf-8"
      );
    })
  );

  it.effect("answers a stale credential, as every public path does", () =>
    Effect.gen(function* () {
      const { status, text } = yield* home(projects, {
        headers: { ...html.headers, authorization: "Bearer nope" },
      });

      expect(status).toBe(200);
      expect(text).toContain(`git clone ${origin}/alice/datekit.git`);
    })
  );

  it.effect("answers HEAD with no body", () =>
    Effect.gen(function* () {
      const { status, text } = yield* home(projects, {
        ...html,
        method: "HEAD",
      });

      expect({ status, text }).toStrictEqual({ status: 200, text: "" });
    })
  );
});
