/**
 * A project adopted from a public repo, whatever its default branch, and
 * adopted again by a retry when the first import died after Artifacts made
 * the repo.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { LandedSha, RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { ProjectExists } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { Effect, Exit, Option, Ref } from "effect";

import { ProjectStore } from "../src/project-store.ts";
import { projectService } from "../src/project.ts";
import { worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] });

const { project } = scenario;

const repo = RepoName.make(project);

const alice = Person.make({ handle: scenario.initializer });

const mainRef = RefName.make("refs/heads/main");

const masterRef = RefName.make("refs/heads/master");

/**
 * A public remote `upstream` whose only branch is `master`, as anyhow's
 * and stb's are; the world reads `https://example.com/upstream.git` as it.
 */
const upstreamOnMaster = Effect.gen(function* () {
  const host = yield* RepoHost;
  const upstream = RepoName.make("upstream");
  const client = yield* gitClient(memoryFs());

  const tip = yield* client.commit("Start", [
    ["Cargo.toml", '[package]\nname = "upstream"\n'],
    ["src/lib.rs", "pub fn parse() {}\n"],
  ]);

  yield* host.create(upstream).pipe(Effect.orDie);
  yield* host
    .push(upstream, client.source, [
      { from: Option.none(), ref: masterRef, to: tip },
    ])
    .pipe(Effect.orDie);

  return { tip, url: "https://example.com/upstream.git" };
});

/** What the project holds after its imports: its head, its row, and its repo's refs. */
const settled = Effect.gen(function* () {
  const api = yield* projectService(project);
  const snapshot = yield* ProjectStore.use((store) => store.load());
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return {
    head: (yield* api.head()).landed,
    main: refs.get(mainRef),
    state: Option.map(snapshot.project, (row) => row.state),
  };
});

/**
 * The world's `RepoHost`, standing in for the binding past its wait: until
 * the import is copied, a read of the imported repo dies as the binding's
 * does when Artifacts still answers `IMPORT_IN_PROGRESS` (the binding's
 * own half is `packages/artifacts/test/binding.test.ts`). The first read
 * after an import dies; every later one works.
 */
const stillCopying = Effect.gen(function* () {
  const host = yield* RepoHost;
  const copying = yield* Ref.make(false);

  return RepoHost.of({
    ...host,
    importFrom: (name, source) =>
      host
        .importFrom(name, source)
        .pipe(Effect.tap(() => Ref.set(copying, true))),
    refs: (name) =>
      Effect.flatMap(Ref.getAndSet(copying, false), (busy) =>
        busy
          ? Effect.die(new Error(`Import in progress: ${name}`))
          : host.refs(name)
      ),
  });
});

describe("importing a public repo", () => {
  it.effect(
    "adopts a remote whose only branch is master, with no branch given, on a main at its tip",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { tip, url } = yield* upstreamOnMaster;
        const api = yield* projectService(project);
        const made = yield* api.initProject(alice, { import: { url } });

        expect(made.landed).toStrictEqual(LandedSha.make(tip));
        expect(yield* settled).toStrictEqual({
          head: LandedSha.make(tip),
          main: tip,
          state: Option.some("live"),
        });
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect(
    "adopts on a retry the repo a first import left when it died, not ProjectExists",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { tip, url } = yield* upstreamOnMaster;
        const host = yield* stillCopying;

        const api = yield* projectService(project).pipe(
          Effect.provideService(RepoHost, host)
        );

        const first = yield* Effect.exit(
          api.initProject(alice, { import: { url } })
        );

        const retried = yield* Effect.exit(
          api.initProject(alice, { import: { url } })
        );

        expect(Exit.hasDies(first)).toBeTruthy();
        expect(Exit.map(retried, ({ landed }) => landed)).toStrictEqual(
          Exit.succeed(LandedSha.make(tip))
        );
        expect(yield* settled).toStrictEqual({
          head: LandedSha.make(tip),
          main: tip,
          state: Option.some("live"),
        });
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect("still answers ProjectExists for a project that exists", () =>
    Effect.gen(function* () {
      yield* advanceTo("2026-10-08T12:00:00Z");

      const { url } = yield* upstreamOnMaster;
      const api = yield* projectService(project);

      yield* api.initProject(alice, { import: { url } });

      expect(
        yield* Effect.flip(api.initProject(alice, { import: { url } }))
      ).toStrictEqual(new ProjectExists({ project }));
    }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );
});
