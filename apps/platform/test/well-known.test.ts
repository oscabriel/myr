/**
 * The projects' contribute skills, found where agents look for skills
 * (issue 505, spec D12): `/.well-known/agent-skills/index.json` lists each
 * project whose landed tree holds `.agents/skills/<project>-contribute/SKILL.md`,
 * with the SHA-256 of that file's bytes, and each listed URL serves the file
 * as it landed. Anyone may read them, with no credential or a stale one.
 * Through the platform's fetch handler over the Node world, with real git.
 */
import { describe, expect, it } from "@effect/vitest";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { ProjectName } from "@repo/protocol/ids";
import { Effect, Schema } from "effect";

import { coreLoopWorld } from "./world.ts";

const datekit = ProjectName.make("datekit");

const burrow = ProjectName.make("burrow");

/** Listed by the front page, but never made. */
const ghost = ProjectName.make("ghost");

const skillPath = ".agents/skills/datekit-contribute/SKILL.md";

const skill = [
  "---",
  "name: datekit-contribute",
  `description: "Answer one of datekit's asks."`,
  "---",
  "# Contribute to datekit",
  "",
  "Claim an ask, change only its territory, and push.",
  "",
].join("\n");

/** `sha256sum` of `skill`, worked out apart from the platform. */
const skillDigest =
  "sha256:d1eea4794e8625845990e8eefea0d6eeca4d1cde4f376418334ac7541bf1066d";

const Index = Schema.fromJsonString(
  Schema.Struct({
    $schema: Schema.String,
    skills: Schema.Array(
      Schema.Struct({
        description: Schema.String,
        digest: Schema.String,
        name: Schema.String,
        type: Schema.String,
        url: Schema.String,
      })
    ),
  })
);

const listing = (project: ProjectName) => ({
  openAsks: 0,
  posture: "open" as const,
  project,
});

/** What a reply says: its status, its type and its body. */
const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    (body) => ({
      body,
      contentType: response.headers.get("content-type"),
      status: response.status,
    })
  );

describe("the agent skills index", () => {
  it.live(
    "lists a landed skill with its file's digest, serves the file, and leaves out a project without one",
    () =>
      Effect.gen(function* () {
        const world = yield* coreLoopWorld({
          frontPage: FrontPageMemory.layer({
            credits: [],
            entries: [],
            projects: [listing(burrow), listing(datekit), listing(ghost)],
          }),
        });

        const dora = world.rpc("dora");
        const doraGit = world.git("dora");

        // datekit lands its skill with its first push; burrow lands none.
        for (const [project, files] of [
          [datekit, { [skillPath]: skill, "README.md": "datekit\n" }],
          [burrow, { "README.md": "burrow\n" }],
        ] as const) {
          const made = yield* dora.initProject({ project });
          const home = yield* doraGit.clone(made.remote);

          yield* doraGit.commit(home, `Start ${project}`, files);

          expect((yield* doraGit.push(home)).exitCode).toBe(0);
        }

        yield* world.settle();

        const get = (path: string, headers: Record<string, string> = {}) =>
          Effect.flatMap(
            world.fetch(new Request(`${world.origin}${path}`, { headers })),
            read
          );

        const index = yield* get("/.well-known/agent-skills/index.json");

        expect({ ...index, body: "" }).toStrictEqual({
          body: "",
          contentType: "application/json",
          status: 200,
        });
        expect(yield* Schema.decodeEffect(Index)(index.body)).toStrictEqual({
          $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
          skills: [
            {
              description: "Answer one of datekit's asks.",
              digest: skillDigest,
              name: "datekit-contribute",
              type: "skill-md",
              url: "/.well-known/agent-skills/datekit-contribute/SKILL.md",
            },
          ],
        });

        expect(
          yield* get("/.well-known/agent-skills/datekit-contribute/SKILL.md")
        ).toStrictEqual({
          body: skill,
          contentType: "text/markdown; charset=utf-8",
          status: 200,
        });

        // A credential the platform does not know is no reason to refuse.
        expect(
          (yield* get("/.well-known/agent-skills/index.json", {
            authorization: "Bearer a-token-the-platform-never-issued-0123",
          })).status
        ).toBe(200);

        expect(
          yield* Effect.forEach(
            [
              "/.well-known/agent-skills/burrow-contribute/SKILL.md",
              "/.well-known/agent-skills/ghost-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit/SKILL.md",
              "/.well-known/agent-skills/Datekit-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit-contribute/README.md",
            ],
            (path) => Effect.map(get(path), ({ status }) => [path, status])
          )
        ).toStrictEqual([
          ["/.well-known/agent-skills/burrow-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/ghost-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit/SKILL.md", 404],
          ["/.well-known/agent-skills/Datekit-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit-contribute/README.md", 404],
        ]);
      }),
    60_000
  );
});
