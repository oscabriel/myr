/**
 * A project adopted from a public repo, whatever its default branch, and
 * adopted again by a retry when the first import died after Artifacts made
 * the repo; and each adoption, an import's or a first push's, heard once
 * as a landing.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Handle, LandedSha, RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { ProjectExists } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { DateTime, Effect, Exit, Option, Ref, Struct } from "effect";

import { ProjectStore } from "../src/project-store.ts";
import { projectService } from "../src/project.ts";
import { worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] });

const { project } = scenario;

const repo = RepoName.make(project);

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({ handle: Handle.make("bob") });

const mainRef = RefName.make("refs/heads/main");

/**
 * The project's row as an import written before sources were kept left it
 * (ADR 0031): the same row without `importedFrom`.
 */
const forgetSource = ProjectStore.use((store) =>
  Effect.flatMap(store.load(), ({ project: row }) =>
    Option.match(row, {
      onNone: () => Effect.void,
      onSome: (kept) =>
        store.commit({ project: Struct.omit(kept, ["importedFrom"]) }),
    })
  )
);

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

  it.effect(
    "is heard as its adoption's landing, so a project whose policy never evaluates is listed",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { tip, url } = yield* upstreamOnMaster;
        const api = yield* projectService(project);

        yield* api.initProject(alice, { import: { url } });

        const heard = yield* api.events(0, 10);

        expect(heard.map(({ event }) => event._tag)).toStrictEqual(["Landed"]);
        expect(
          heard.flatMap(({ event }) =>
            ProjectEvent.guards.Landed(event) ? [event.landing] : []
          )
        ).toStrictEqual([
          {
            assisted: [],
            author: alice.handle,
            credits: [],
            landedAt: DateTime.makeUnsafe("2026-10-08T12:00:00Z"),
            project,
            sha: LandedSha.make(tip),
          },
        ]);
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect(
    "keeps where it came from on its row, and projectPolicy names it",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { url } = yield* upstreamOnMaster;
        const api = yield* projectService(project);

        yield* api.initProject(alice, { import: { branch: "master", url } });

        const snapshot = yield* ProjectStore.use((store) => store.load());

        expect(
          Option.map(snapshot.project, (row) => row.importedFrom)
        ).toStrictEqual(Option.some({ branch: "master", url }));
        expect((yield* api.policy()).importedFrom).toStrictEqual({
          branch: "master",
          url,
        });
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect(
    "answers a repeat with the same source as the first call did, and ProjectExists for another source",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { tip, url } = yield* upstreamOnMaster;
        const api = yield* projectService(project);

        const made = yield* api.initProject(alice, { import: { url } });
        const again = yield* api.initProject(alice, { import: { url } });

        expect(again).toStrictEqual(made);
        expect(made.landed).toStrictEqual(LandedSha.make(tip));
        expect(
          yield* Effect.flip(
            api.initProject(alice, {
              import: { url: "https://example.com/other.git" },
            })
          )
        ).toStrictEqual(new ProjectExists({ project }));
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect(
    "sets the source on a repeat by the initializer for an import adopted before sources were kept, hearing no second landing",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const { tip, url } = yield* upstreamOnMaster;
        const api = yield* projectService(project);

        yield* api.initProject(alice, { import: { url } });
        yield* forgetSource;

        const retried = yield* api.initProject(alice, { import: { url } });
        const snapshot = yield* ProjectStore.use((store) => store.load());

        expect(retried.landed).toStrictEqual(LandedSha.make(tip));
        expect(
          Option.map(snapshot.project, (row) => row.importedFrom)
        ).toStrictEqual(Option.some({ url }));
        expect(
          (yield* api.events(0, 10)).map(({ event }) => event._tag)
        ).toStrictEqual(["Landed"]);
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect("refuses a source from anyone but the initializer", () =>
    Effect.gen(function* () {
      yield* advanceTo("2026-10-08T12:00:00Z");

      const { url } = yield* upstreamOnMaster;
      const api = yield* projectService(project);

      yield* api.initProject(alice, { import: { url } });
      yield* forgetSource;

      expect(
        yield* Effect.flip(api.initProject(bob, { import: { url } }))
      ).toStrictEqual(new ProjectExists({ project }));
    }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );

  it.effect("refuses a source for a project that started empty", () =>
    Effect.gen(function* () {
      yield* advanceTo("2026-10-08T12:00:00Z");

      const { url } = yield* upstreamOnMaster;
      const api = yield* projectService(project);
      const client = yield* gitClient(memoryFs());

      const first = yield* client.commit("Start", [["README.md", "# start\n"]]);

      yield* api.initProject(alice, {});
      yield* (yield* RepoHost)
        .push(repo, client.source, [
          { from: Option.none(), ref: mainRef, to: first },
        ])
        .pipe(Effect.orDie);
      yield* advanceTo("2026-10-08T12:01:00Z");
      yield* api.recordFirstPush(alice, first);

      expect(
        yield* Effect.flip(api.initProject(alice, { import: { url } }))
      ).toStrictEqual(new ProjectExists({ project }));
    }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );
});

describe("a first push", () => {
  it.effect(
    "is heard once as the adoption's landing, however often it is recorded",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const api = yield* projectService(project);
        const client = yield* gitClient(memoryFs());

        const first = yield* client.commit("Start", [
          ["README.md", "# start\n"],
        ]);

        yield* api.initProject(alice, {});
        yield* (yield* RepoHost)
          .push(repo, client.source, [
            { from: Option.none(), ref: mainRef, to: first },
          ])
          .pipe(Effect.orDie);
        yield* api.recordFirstPush(alice, first);
        yield* api.recordFirstPush(alice, first);

        const heard = yield* api.events(0, 10);

        expect(heard.map(({ event }) => event._tag)).toStrictEqual(["Landed"]);
      }).pipe(Effect.provide(worldOf(scenario, "memory")))
  );
});
