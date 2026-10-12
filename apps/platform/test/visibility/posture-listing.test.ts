import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { Brand } from "@repo/brand";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { ProjectName } from "@repo/protocol/ids";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer } from "effect";

import { decodeEnv } from "../../src/platform.ts";
import { stateLive } from "../../src/visibility/state.ts";
import { fakeEnv } from "../fake-env.ts";
import { coreLoopWorld } from "../world.ts";

const project = ProjectName.make("dora/datekit");

const sdk = `${Brand.cliPackage}/rules`;

const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/visibility.ts`]: [
    `import { flows, layer, sealedChecks, visibility } from "${sdk}";`,
    ``,
    `export default visibility({`,
    `  checks: sealedChecks({`,
    `    areas: { export: "src/format.ts", parser: "src/parse.ts" },`,
    `  }),`,
    `  flows: flows.noWriteDown(),`,
    `  layers: {`,
    `    maintainers: layer({`,
    `      disclose: "sealed",`,
    `      holds: ["checks", "notes"],`,
    `      reason: "Held-back checks for export and parser",`,
    `    }),`,
    `  },`,
    `});`,
    ``,
  ].join("\n"),
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/parse.ts": "export const parse = (iso: string) => 0;\n",
};

const noFetch = Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch"));

const cartridge = Layer.unwrap(
  Effect.gen(function* () {
    const host = yield* Effect.provide(
      Effect.service(RepoHost),
      RepoHostMemory
    );

    const config = yield* decodeEnv({
      ...fakeEnv(),
      ARTIFACTS_PRIVATE: fakeArtifactsBinding(host, {
        remoteBase: "https://artifacts.test",
      }),
    }).pipe(Effect.orDie);

    return stateLive(config).pipe(Layer.provide(noFetch));
  })
);

describe("the project list, with the visibility cartridge composed", () => {
  it.live(
    "lists datekit at the posture its ledger stands at, though the projection says open",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const world = yield* coreLoopWorld({
            frontPage: FrontPageMemory.layer({
              credits: [],
              entries: [],
              projects: [{ openAsks: 0, posture: "open", project }],
            }),
          });

          const dora = world.rpc("dora");
          const made = yield* dora.initProject({ project });
          const home = yield* world.git("dora").clone(made.remote);

          yield* world.git("dora").commit(home, "Start datekit", start);
          yield* world.git("dora").push(home);

          const anyone = world.rpc("anonymous");
          const { posture } = yield* anyone.ledger({ project });
          const { projects } = yield* anyone.listProjects({});

          expect(posture).toBe("openWithSealedEvidence");
          expect(projects).toStrictEqual([{ openAsks: 0, posture, project }]);
        }).pipe(Effect.provide(cartridge))
      ),
    30_000
  );
});
