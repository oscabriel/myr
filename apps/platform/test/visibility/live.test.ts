/**
 * The visibility cartridge as the platform plugs it in: over the
 * stage's ports, built from the decoded env without touching a binding, and
 * reaching the private namespace through `ARTIFACTS_PRIVATE` alone. These
 * tests live in the cartridge and go with it.
 */
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { RepoName } from "@repo/protocol/ids";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { LayerRepos } from "@repo/visibility/layer-repos";
import { Effect, Exit, Layer } from "effect";

import { decodeEnv } from "../../src/platform.ts";
import { workerPorts } from "../../src/ports.ts";
import { layerRepos } from "../../src/visibility/layer-repos.ts";
import { fakeEnv } from "../fake-env.ts";

/** Where each fake binding says its repos' git lives. */
const remoteBase = "https://artifacts.test";

/** A repo host of its own, empty. */
const freshHost = Effect.provide(Effect.service(RepoHost), RepoHostMemory);

/** A `Fetch` that nothing here may call. */
const noFetch = Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch"));

describe("the visibility cartridge, plugged in", () => {
  it.effect(
    "builds over the stage's ports from the decoded env, touching no binding",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

        const built = yield* Effect.exit(
          Effect.scoped(Layer.build(workerPorts(config)))
        );

        expect(Exit.isSuccess(built)).toBeTruthy();
      })
  );

  it.effect(
    "reaches the layer repos through ARTIFACTS_PRIVATE, never the public namespace",
    () =>
      Effect.gen(function* () {
        const publicHost = yield* freshHost;
        const privateHost = yield* freshHost;
        const layer = RepoName.make("datekit--maintainers");

        yield* privateHost.create(layer);

        const config = yield* decodeEnv({
          ...fakeEnv(),
          ARTIFACTS: fakeArtifactsBinding(publicHost, { remoteBase }),
          ARTIFACTS_PRIVATE: fakeArtifactsBinding(privateHost, { remoteBase }),
        }).pipe(Effect.orDie);

        yield* publicHost.create(RepoName.make("datekit"));

        const found = yield* LayerRepos.use((repos) =>
          Effect.all({
            layer: Effect.exit(repos.remote(layer)),
            public: Effect.exit(repos.remote(RepoName.make("datekit"))),
          })
        ).pipe(Effect.provide(layerRepos(config).pipe(Layer.provide(noFetch))));

        expect(Exit.isSuccess(found.layer)).toBeTruthy();
        expect(Exit.isFailure(found.public)).toBeTruthy();
      })
  );
});
