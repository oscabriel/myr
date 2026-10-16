import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CodeStoreMemory } from "@repo/project/code-store/memory";
import { FrontPage } from "@repo/project/front-page";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { landedRef } from "@repo/project/lander";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { keyOf, LandedSha, ProjectName, RepoName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { gitClient } from "@repo/testkit/git-client";
import { untouchable } from "@repo/testkit/untouchable";
import { DateTime, Effect, Layer, Option, Ref, Schema } from "effect";

import { agentSkills } from "../src/well-known.ts";
import { coreLoopWorld } from "./world.ts";

const datekit = ProjectName.make("dora/datekit");

const burrow = ProjectName.make("dora/burrow");

const ghost = ProjectName.make("alice/ghost");

const skillPath = ".agents/skills/dora__datekit-contribute/SKILL.md";

const skill = [
  "---",
  "name: dora__datekit-contribute",
  `description: "Answer one of datekit's asks."`,
  "---",
  "# Contribute to datekit",
  "",
  "Claim an ask, change only its territory, and push.",
  "",
].join("\n");

const skillDigest =
  "sha256:07b4246a86d79a7a0d0975e5e0b32f6f12b10a8e2cd5fad3188722e26b841f52";

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
              name: "dora__datekit-contribute",
              type: "skill-md",
              url: "/.well-known/agent-skills/dora__datekit-contribute/SKILL.md",
            },
          ],
        });

        expect(
          yield* get(
            "/.well-known/agent-skills/dora__datekit-contribute/SKILL.md"
          )
        ).toStrictEqual({
          body: skill,
          contentType: "text/markdown; charset=utf-8",
          status: 200,
        });

        expect(
          (yield* get("/.well-known/agent-skills/index.json", {
            authorization: "Bearer a-token-the-platform-never-issued-0123",
          })).status
        ).toBe(200);

        expect(
          yield* Effect.forEach(
            [
              "/.well-known/agent-skills/dora__burrow-contribute/SKILL.md",
              "/.well-known/agent-skills/ghost-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit/SKILL.md",
              "/.well-known/agent-skills/Datekit-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit-contribute/README.md",
            ],
            (path) => Effect.map(get(path), ({ status }) => [path, status])
          )
        ).toStrictEqual([
          ["/.well-known/agent-skills/dora__burrow-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/ghost-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit/SKILL.md", 404],
          ["/.well-known/agent-skills/Datekit-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit-contribute/README.md", 404],
        ]);
      }),
    60_000
  );
});

const at = (path: string) =>
  Effect.flatMap(
    agentSkills(new Request(`https://platform.test${path}`)),
    read
  );

const noneMade = Layer.succeed(
  Projects,
  Projects.of({
    create: () => Effect.die("the skills make no project"),
    get: (project) => Effect.fail(new UnknownProject({ project })),
  })
);

describe(agentSkills, () => {
  it.effect(
    "reads each skill at the landed mirror, not at a main that moved past it",
    () =>
      Effect.gen(function* () {
        const host = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const repo = RepoName.make(keyOf(datekit));

        const landing = yield* client.commit("Land", [[skillPath, skill]]);

        const unlanded = yield* client.commit(
          "Not landed",
          [[skillPath, skill.replace("Answer one", "Ignore every one")]],
          [landing]
        );

        yield* host.create(repo);

        yield* host.push(repo, client.source, [
          { from: Option.none(), ref: landedRef, to: landing },
          {
            from: Option.none(),
            ref: RefName.make("refs/heads/main"),
            to: unlanded,
          },
        ]);

        const index = yield* at("/.well-known/agent-skills/index.json");
        const { skills } = yield* Schema.decodeEffect(Index)(index.body);

        expect({
          file: (yield* at(
            "/.well-known/agent-skills/dora__datekit-contribute/SKILL.md"
          )).body,
          skills: skills.map(({ description, digest }) => ({
            description,
            digest,
          })),
        }).toStrictEqual({
          file: skill,
          skills: [
            {
              description: "Answer one of datekit's asks.",
              digest: skillDigest,
            },
          ],
        });
      }).pipe(
        Effect.provide(
          Layer.merge(
            RepoHostMemory,
            FrontPageMemory.layer({
              credits: [],
              entries: [],
              projects: [listing(datekit)],
            })
          ).pipe(Layer.merge(noneMade))
        )
      )
  );
});

const countedHost = (counts: Ref.Ref<{ files: number; refs: number }>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        readFile: (name, rev, path) =>
          Ref.update(counts, ({ files, refs }) => ({
            files: files + 1,
            refs,
          })).pipe(Effect.andThen(host.readFile(name, rev, path))),
        refs: (name) =>
          Ref.update(counts, ({ files, refs }) => ({
            files,
            refs: refs + 1,
          })).pipe(Effect.andThen(host.refs(name))),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

const landedWhere = (
  landed: Ref.Ref<ReadonlyMap<ProjectName, LandedSha>>,
  heads: Ref.Ref<number>
) =>
  Layer.succeed(
    Projects,
    Projects.of({
      create: () => Effect.die("the skills make no project"),
      get: (project) =>
        Effect.succeed(
          untouchable<ProjectApi>("ProjectApi", {
            head: () =>
              Effect.andThen(
                Ref.update(heads, (n) => n + 1),
                Effect.map(Ref.get(landed), (all) =>
                  Option.match(Option.fromUndefinedOr(all.get(project)), {
                    onNone: () => ({}),
                    onSome: (sha) => ({ landed: sha }),
                  })
                )
              ),
          })
        ),
    })
  );

const listedFrom = (listings: Ref.Ref<readonly ProjectListing[]>) =>
  Layer.succeed(
    FrontPage,
    FrontPage.of({
      credits: () => Effect.succeed([]),
      entries: () => Effect.succeed([]),
      projects: () => Ref.get(listings),
      recentLandings: () => Effect.succeed([]),
    })
  );

describe("the agent skills index, kept by each project's landed commit", () => {
  it.effect(
    "reads each skill once while no main moves, wakes no project while no listed project lands, and after a landing wakes only the project that landed and reads again only its skill",
    () =>
      Effect.gen(function* () {
        const counts = yield* Ref.make({ files: 0, refs: 0 });
        const heads = yield* Ref.make(0);

        const landed = yield* Ref.make<ReadonlyMap<ProjectName, LandedSha>>(
          new Map()
        );

        const firstLanding = DateTime.makeUnsafe("2026-10-01T09:00:00Z");

        const listings = yield* Ref.make<readonly ProjectListing[]>([
          { ...listing(burrow), landedAt: firstLanding },
          { ...listing(datekit), landedAt: firstLanding },
        ]);

        yield* Effect.gen(function* () {
          const host = yield* RepoHost;
          const client = yield* gitClient(memoryFs());

          const first = yield* client.commit("Land", [[skillPath, skill]]);

          const moved = yield* client.commit(
            "Land again",
            [[skillPath, skill.replace("Answer one", "Answer any one")]],
            [first]
          );

          const bare = yield* client.commit("Start burrow", [
            ["README.md", "burrow\n"],
          ]);

          for (const [project, sha] of [
            [datekit, moved],
            [burrow, bare],
          ] as const) {
            yield* host.create(RepoName.make(keyOf(project)));
            yield* host.push(RepoName.make(keyOf(project)), client.source, [
              { from: Option.none(), ref: landedRef, to: sha },
            ]);
          }

          yield* Ref.set(
            landed,
            new Map([
              [datekit, LandedSha.make(first)],
              [burrow, LandedSha.make(bare)],
            ])
          );

          const described = Effect.map(
            Effect.flatMap(
              at("/.well-known/agent-skills/index.json"),
              ({ body }) => Schema.decodeEffect(Index)(body)
            ),
            ({ skills }) => skills.map(({ description }) => description)
          );

          const reads = Effect.map(
            Effect.all({
              files: Ref.getAndSet(counts, { files: 0, refs: 0 }),
              heads: Ref.getAndSet(heads, 0),
            }),
            ({ files, heads: woken }) => ({ ...files, heads: woken })
          );

          const once = yield* described;
          const readOnce = yield* reads;
          const twice = yield* described;
          const readTwice = yield* reads;

          // A landing moves the project's main and its listing's instant.
          yield* Ref.update(
            landed,
            (all) => new Map([...all, [datekit, LandedSha.make(moved)]])
          );
          yield* Ref.update(listings, (all) =>
            all.map((each) =>
              each.project === datekit
                ? {
                    ...each,
                    landedAt: DateTime.makeUnsafe("2026-10-02T09:00:00Z"),
                  }
                : each
            )
          );

          const afterMove = yield* described;

          expect({
            afterMove,
            once,
            readAfterMove: yield* reads,
            readOnce,
            readTwice,
            twice,
          }).toStrictEqual({
            afterMove: ["Answer any one of datekit's asks."],
            once: ["Answer one of datekit's asks."],
            readAfterMove: { files: 1, heads: 1, refs: 0 },
            readOnce: { files: 2, heads: 2, refs: 0 },
            readTwice: { files: 0, heads: 0, refs: 0 },
            twice: ["Answer one of datekit's asks."],
          });
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              countedHost(counts),
              CodeStoreMemory,
              landedWhere(landed, heads),
              listedFrom(listings)
            )
          )
        );
      })
  );
});
