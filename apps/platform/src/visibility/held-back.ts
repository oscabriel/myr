/**
 * The visibility cartridge's landing guards: the
 * no-write-down guards the `Answer` Workflow runs on an answer's merged
 * change set before any check, provided as its `LandingGuards` port.
 *
 * - `PrivatePathInPublicTree`: a path in any layer's path set, as the
 *   project gives it (`layerFacts`). It names exactly which paths collide
 *   only when everyone accountable for the answer reads every layer;
 *   anyone else hears every path they added or modified
 *   (`privatePaths`), so the refusal is no map of the layers.
 * - `LayerContentInPublicTree`: an added blob identical to a blob of a
 *   layer the answerer or a finisher reads (`writeDown`). Only the
 *   blobs of layers they read are compared, read here from the private
 *   namespace (`LayerRepos`) at the layer's `main`; for anyone else the
 *   guard says nothing, never an oracle on a layer's content.
 *
 * Nothing here names a layer's paths or content in a refusal or a log.
 */
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

/** A layer's repo: as declared, or `<key>--<layer>`, by the project's key. */
const repoOf = (project: ProjectName, layer: LayerDeclaration) =>
  layer.repo ?? RepoName.make(`${keyOf(project)}--${layer.name}`);

/** Every blob under `tree` in `repo`, at any depth. */
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

/** The blobs a layer's repo holds on `main`; none for a layer with no repo yet. */
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

/** Whether `handle` may read `layer`: its readers and writers. */
const reads = (api: ProjectApi, handle: Handle, layer: LayerDeclaration) =>
  Effect.map(
    api.layerAccess(Person.make({ handle }), layer.name),
    (access) => Option.isSome(access) && access.value !== "none"
  );

/** The guards on one answer's merged change set, over its project and the private namespace. */
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

/** The landing guards over the project's layers, as `LayerRepos` holds them. */
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

/** The landing guards for one stage, over its private namespace (`ARTIFACTS_PRIVATE`). */
export const heldBackLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Fetch | Projects> =>
  LandingGuardsLive.pipe(Layer.provide(layerRepos(config)));
