// Refusals and logs here never name a layer's paths or content: exact colliding paths
// only when everyone accountable reads every layer, and blob comparison only for layers
// the answerer or a finisher reads.
import type { Fetch } from "@repo/artifacts/fetch";
import { ObjectId, RefName } from "@repo/artifacts/repo-host";
import type { RepoHost, RepoNotFound } from "@repo/artifacts/repo-host";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import type { Layer as LayerDeclaration } from "@repo/protocol/domain/visibility";
import { BlobSha, keyOf, RepoName, RepoPath } from "@repo/protocol/ids";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { privatePaths, writeDown } from "@repo/visibility/guards";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Effect, Layer, Option } from "effect";

import type { PlatformConfig } from "../platform.ts";
import { LandingGuards } from "../workflows/answer/guards.ts";
import type { GuardInput } from "../workflows/answer/guards.ts";
import { layerRepos } from "./layer-repos.ts";

const mainRef = RefName.make("refs/heads/main");

const repoOf = (project: ProjectName, layer: LayerDeclaration) =>
  layer.repo ?? RepoName.make(`${keyOf(project)}--${layer.name}`);

const blobsUnder = (
  host: RepoHost["Service"],
  repo: RepoName,
  tree: string
): Effect.Effect<readonly BlobSha[], RepoNotFound> =>
  Effect.flatMap(host.readTree(repo, ObjectId.make(tree)), (entries) =>
    Effect.map(
      Effect.forEach(
        Option.getOrElse(entries, () => []),
        (entry) =>
          entry.type === "tree"
            ? blobsUnder(host, repo, entry.sha)
            : Effect.succeed(
                entry.type === "blob" ? [BlobSha.make(entry.sha)] : []
              )
      ),
      (nested) => nested.flat()
    )
  );

const layerBlobs = (host: RepoHost["Service"], repo: RepoName) =>
  Effect.gen(function* () {
    const tip = (yield* host.refs(repo)).get(mainRef);

    if (tip === undefined) {
      return [];
    }

    const commit = yield* host.readCommit(repo, tip);

    return Option.isNone(commit)
      ? []
      : yield* blobsUnder(host, repo, commit.value.tree);
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeed([])));

const reads = (api: ProjectApi, handle: Handle, layer: LayerDeclaration) =>
  Effect.map(
    api.layerAccess(Person.make({ handle }), layer.name),
    (access) => Option.isSome(access) && access.value !== "none"
  );

const guardsOver =
  (repos: RepoHost["Service"], projects: Projects["Service"]) =>
  (input: GuardInput) =>
    Effect.gen(function* () {
      const api = yield* projects.get(input.project).pipe(Effect.orDie);
      const people = [input.answerer, ...input.finishers];

      const { layers } = yield* api
        .ledger(Anonymous.make({}))
        .pipe(Effect.orDie);

      const facts = yield* api.layerFacts(
        Person.make({ handle: input.answerer })
      );

      const access = yield* Effect.forEach(layers, (layer) =>
        Effect.map(
          Effect.forEach(people, (handle) => reads(api, handle, layer)),
          (each) => ({ each, layer })
        )
      );

      const readable = access.filter(({ each }) => each.some(Boolean));

      const readsAll =
        access.length > 0 && access.every(({ each }) => each.every(Boolean));

      const blobs = yield* Effect.forEach(readable, ({ layer }) =>
        layerBlobs(repos, repoOf(input.project, layer))
      );

      return [
        ...Option.toArray(
          privatePaths({
            changes: input.changes,
            layerPaths: new Set(
              facts.layerPaths.map((path) => RepoPath.make(path))
            ),
            pusherCanRead: readsAll,
          })
        ),
        ...Option.toArray(
          writeDown({
            changes: input.changes,
            layerBlobs: new Set(blobs.flat()),
            readerCanReadLayer: readable.length > 0,
          })
        ),
      ];
    });

export const LandingGuardsLive: Layer.Layer<
  never,
  never,
  LayerRepos | Projects
> = Layer.effect(
  LandingGuards,
  Effect.gen(function* () {
    const repos = yield* LayerRepos;
    const projects = yield* Projects;

    return Option.some({ check: guardsOver(repos, projects) });
  })
);

export const heldBackLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Fetch | Projects> =>
  LandingGuardsLive.pipe(Layer.provide(layerRepos(config)));
