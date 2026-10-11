/**
 * The projects' contribute skills, found where agents look for skills:
 * `/.well-known/agent-skills/index.json` lists each
 * project whose landed tree holds `.agents/skills/<project>-contribute/SKILL.md`,
 * with the SHA-256 of that file's bytes, and each listed URL serves the file
 * as it landed. Anyone may read them, with no credential or a stale one.
 * Through the platform's fetch handler over the Node world, with real git;
 * and `agentSkills` itself over memory adapters, for a `main` that moved
 * past the landed mirror, and for skills kept by each project's landed
 * commit, so the index reads a file only for a project whose main moved.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CodeStoreMemory } from "@repo/project/code-store/memory";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { landedRef } from "@repo/project/lander";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { keyOf, LandedSha, ProjectName, RepoName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { gitClient } from "@repo/testkit/git-client";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Option, Ref, Schema } from "effect";

import { agentSkills } from "../src/well-known.ts";
import { coreLoopWorld } from "./world.ts";

const datekit = ProjectName.make("dora/datekit");

const burrow = ProjectName.make("dora/burrow");

/** Listed by the front page, but never made. */
const ghost = ProjectName.make("alice/ghost");

const skillPath = ".agents/skills/dora_datekit-contribute/SKILL.md";

const skill = [
  "---",
  "name: dora_datekit-contribute",
  `description: "Answer one of datekit's asks."`,
  "---",
  "# Contribute to datekit",
  "",
  "Claim an ask, change only its territory, and push.",
  "",
].join("\n");

/** `sha256sum` of `skill`, worked out apart from the platform. */
const skillDigest =
  "sha256:57d83c7a661d93340b2c3fbf4f524e0a0e28bddf7914b740aff5cbe3b35333ac";

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
              name: "dora_datekit-contribute",
              type: "skill-md",
              url: "/.well-known/agent-skills/dora_datekit-contribute/SKILL.md",
            },
          ],
        });

        expect(
          yield* get(
            "/.well-known/agent-skills/dora_datekit-contribute/SKILL.md"
          )
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
              "/.well-known/agent-skills/dora_burrow-contribute/SKILL.md",
              "/.well-known/agent-skills/ghost-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit/SKILL.md",
              "/.well-known/agent-skills/Datekit-contribute/SKILL.md",
              "/.well-known/agent-skills/datekit-contribute/README.md",
            ],
            (path) => Effect.map(get(path), ({ status }) => [path, status])
          )
        ).toStrictEqual([
          ["/.well-known/agent-skills/dora_burrow-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/ghost-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit/SKILL.md", 404],
          ["/.well-known/agent-skills/Datekit-contribute/SKILL.md", 404],
          ["/.well-known/agent-skills/datekit-contribute/README.md", 404],
        ]);
      }),
    60_000
  );
});

/** What `agentSkills` itself answers for a path. */
const at = (path: string) =>
  Effect.flatMap(
    agentSkills(new Request(`https://platform.test${path}`)),
    read
  );

/** Projects the platform never made: each skill is read at its repo's refs. */
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

        // The mirror holds the last landing; main has moved on without one,
        // as between a landing's two pushes, or after a stray push.
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
            "/.well-known/agent-skills/dora_datekit-contribute/SKILL.md"
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

/** The memory store, each file read and each refs read counted. */
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

/** Projects whose record says each one's main landed where `landed` holds. */
const landedWhere = (landed: Ref.Ref<ReadonlyMap<ProjectName, LandedSha>>) =>
  Layer.succeed(
    Projects,
    Projects.of({
      create: () => Effect.die("the skills make no project"),
      get: (project) =>
        Effect.succeed(
          untouchable<ProjectApi>("ProjectApi", {
            head: () =>
              Effect.map(Ref.get(landed), (all) =>
                Option.match(Option.fromUndefinedOr(all.get(project)), {
                  onNone: () => ({}),
                  onSome: (sha) => ({ landed: sha }),
                })
              ),
          })
        ),
    })
  );

describe("the agent skills index, kept by each project's landed commit", () => {
  it.effect(
    "reads each skill once while no main moves, and again only for a project whose main moved",
    () =>
      Effect.gen(function* () {
        const counts = yield* Ref.make({ files: 0, refs: 0 });

        const landed = yield* Ref.make<ReadonlyMap<ProjectName, LandedSha>>(
          new Map()
        );

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

          /** What one request read: files and refs, since the last. */
          const reads = Effect.flatMap(
            Ref.getAndSet(counts, { files: 0, refs: 0 }),
            Effect.succeed
          );

          const once = yield* described;
          const readOnce = yield* reads;
          const twice = yield* described;
          const readTwice = yield* reads;

          yield* Ref.update(
            landed,
            (all) => new Map([...all, [datekit, LandedSha.make(moved)]])
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
            readAfterMove: { files: 1, refs: 0 },
            readOnce: { files: 2, refs: 0 },
            readTwice: { files: 0, refs: 0 },
            twice: ["Answer one of datekit's asks."],
          });
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              countedHost(counts),
              CodeStoreMemory,
              landedWhere(landed),
              FrontPageMemory.layer({
                credits: [],
                entries: [],
                projects: [listing(burrow), listing(datekit)],
              })
            )
          )
        );
      })
  );
});
