import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoName } from "@repo/artifacts/repo-host";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Exchange } from "@repo/git/upstream";
import {
  noPlan,
  noVisibility,
  ProjectVisibility,
} from "@repo/project/visibility-port";
import type { VisibilityPort } from "@repo/project/visibility-port";
import {
  keyOf,
  AskId,
  Handle,
  LaneName,
  LayerName,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Principal } from "@repo/protocol/principal";
import { PrivatePathInPublicTree } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { git } from "@repo/testkit/git";
import type { Ran } from "@repo/testkit/git";
import { LayerRepos } from "@repo/visibility/layer-repos";
import {
  Array,
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Redacted,
} from "effect";

import { LayerGate, noLayers } from "../../src/layer-gate.ts";
import { decodeEnv } from "../../src/platform.ts";
import { workerPorts } from "../../src/ports.ts";
import { LayerGateLive } from "../../src/visibility/layers.ts";
import { fakeEnv } from "../fake-env.ts";
import { coreLoopWorld } from "../world.ts";

const project = ProjectName.make("ines-v/datekit");

const maintainers = LayerName.make("maintainers");

const layerRepo = RepoName.make(`${keyOf(project)}--${maintainers}`);

const sealed = "checks/held-back/export/escape.test.ts";

const mainRef = "refs/heads/main";

const tokens = {
  bram: "bram-layer-gateway-token-0123456789abcdef",
  "ines-v": "ines-v-layer-gateway-token-0123456789abcdef",
  okonkwo: "okonkwo-layer-gateway-token-0123456789abcdef",
} as const;

const keepers: ReadonlySet<string> = new Set(["ines-v", "okonkwo"]);

const keeps = (who: Principal) =>
  Principal.guards.Person(who) && keepers.has(who.handle);

interface Heard {
  readonly asks: LayerName[];
  readonly reads: {
    readonly handle: Handle;
    readonly layer: LayerName;
    readonly sha: Option.Option<CommitSha>;
  }[];
  readonly pushes: {
    readonly head: CommitSha;
    readonly layer: LayerName;
    readonly pusher: Handle;
  }[];
}

const visibilityHeard = (heard: Heard): VisibilityPort => ({
  ...noVisibility,
  access: (who, layer) => {
    heard.asks.push(layer);

    return layer === maintainers
      ? Option.some(keeps(who) ? "write" : "none")
      : Option.none();
  },
  layerPaths: () => Effect.succeed(new Set([RepoPath.make(sealed)])),
  onLayerPush: ({ head, layer, pusher }) =>
    Effect.sync(() => {
      heard.pushes.push({ head, layer, pusher });

      return noPlan;
    }),
  onPolicy: () =>
    Effect.succeed({
      effects: [],
      writes: { layers: [{ name: maintainers, repo: layerRepo }] },
    }),
  readableLayers: (who) => new Set(keeps(who) ? [maintainers] : []),
  recordRead: ({ handle, layer, sha }) => {
    heard.reads.push({ handle, layer, sha });

    return {};
  },
});

const minting = (
  host: RepoHost["Service"],
  minted: string[]
): RepoHost["Service"] => ({
  ...host,
  mintToken: (name, scope, ttl) =>
    Effect.tap(host.mintToken(name, scope, ttl), (token) =>
      Effect.sync(() => {
        minted.push(Redacted.value(token.secret));
      })
    ),
});

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
  [`${Brand.configDir}/vouched.td`]: "bram\nines-v\n",
  "README.md": "datekit: dates, exported\n",
  "package.json": '{ "name": "ines-v/datekit", "private": true }\n',
  "src/export.ts": "export const toIso = (date: Date) => date.toISOString();\n",
};

const askFiles = (ask: AskId) =>
  Array.make(
    {
      content: [
        `import { kinds, territory } from "${sdk}";`,
        ``,
        `export default kinds.fix.ask({`,
        `  path: "test/${ask}.test.ts",`,
        `  territory: territory.paths("src/**", "checks/**"),`,
        `  want: "toIso keeps the offset it was given",`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`),
    },
    {
      content: [
        `import { expect, it } from "bun:test";`,
        `import { toIso } from "../src/export.ts";`,
        ``,
        `it("keeps the offset", () => {`,
        `  expect(toIso(new Date(0))).toContain("+00:00");`,
        `});`,
        ``,
      ].join("\n"),
      path: RepoPath.make(`test/${ask}.test.ts`),
    }
  );

const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

const rendered = (refusals: Parameters<typeof explain>[0]) =>
  explain(refusals).map((line) => `remote: ${line}`);

const escaping = {
  [sealed]: "it('escapes', () => {});\n",
  "src/fix.ts": "export const fix = true;\n",
};

const layerWorld = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const heard: Heard = { asks: [], pushes: [], reads: [] };
  const minted: string[] = [];
  const outputs: Ran[] = [];
  const stores: RepoHost["Service"][] = [];

  const world = yield* coreLoopWorld({
    plugIn: (store) => {
      stores.push(store);

      return {
        project: Layer.succeed(ProjectVisibility, visibilityHeard(heard)),
        worker: LayerGateLive.pipe(
          Layer.provide(
            Layer.succeed(LayerRepos, LayerRepos.of(minting(store, minted)))
          )
        ),
      };
    },
    sessions: Object.fromEntries(
      Object.entries(tokens).map(([handle, token]) => [token, handle])
    ),
  });

  const layers = yield* Effect.fromNullishOr(stores[0]);
  const ines = yield* world.person("ines-v");
  const bram = yield* world.person("bram");

  const kept = <R>(ran: Effect.Effect<Ran, never, R>) =>
    Effect.tap(ran, (output) =>
      Effect.sync(() => {
        outputs.push(output);
      })
    );

  const made = yield* ines.rpc.initProject({ project });
  const home = yield* ines.git.clone(made.remote);

  yield* ines.git.commit(home, "Start datekit", start);
  yield* kept(ines.git.push(home));

  yield* layers.create(layerRepo);

  const seed = yield* fs.makeTempDirectoryScoped();

  yield* ines.git.ok(seed, "init", "--quiet", "--initial-branch=main");

  const layered = yield* ines.git.commit(seed, "Seal the export check", {
    [sealed]: "it('keeps the offset', () => {});\n",
  });

  const remote = yield* layers.remote(layerRepo);

  yield* ines.git.ok(seed, "push", "--quiet", remote, "HEAD:main");

  return {
    bram,
    heard,
    ines,
    kept,
    layered,
    layers,
    minted,
    outputs,
    remote,
    seed,
    world,
  };
});

describe("a project's layer repos, through the gateway", () => {
  it.live(
    "its keepers clone and push to it, anyone else is turned away, each read is logged, and a fork push cannot carry its paths",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const {
          bram,
          heard,
          ines,
          kept,
          layered,
          layers,
          minted,
          outputs,
          world,
        } = yield* layerWorld;

        const layerUrl = `${world.origin}/${project}--maintainers.git`;

        const ask = (repo: string, token?: string) =>
          world.fetch(
            new Request(
              `${world.origin}/${repo}.git/info/refs?service=git-upload-pack`,
              token === undefined
                ? {}
                : {
                    headers: {
                      authorization: `Basic ${btoa(`x:${token}`)}`,
                    },
                  }
            )
          );

        const anonymous = yield* ask(`${project}--maintainers`);
        const undeclared = yield* ask(`${project}--secrets`);

        const undeclaredSignedIn = yield* ask(
          `${project}--secrets`,
          tokens.bram
        );

        const asksBefore = heard.asks.length;
        const keeper = yield* ask(`${project}--maintainers`, tokens["ines-v"]);

        expect({
          anonymous: {
            challenge: anonymous.headers.get("www-authenticate"),
            status: anonymous.status,
          },
          keeper: {
            asks: heard.asks.length - asksBefore,
            status: keeper.status,
          },
          undeclared: undeclared.status,
          undeclaredSignedIn: undeclaredSignedIn.status,
        }).toStrictEqual({
          anonymous: { challenge: `Basic realm="${Brand.name}"`, status: 401 },
          keeper: { asks: 1, status: 200 },
          undeclared: 404,
          undeclaredSignedIn: 404,
        });

        const outside = yield* fs.makeTempDirectoryScoped();
        const clone = `${outside}/ines-v`;

        const inesClone = yield* kept(
          ines.git.run(outside, "clone", "--quiet", layerUrl, "ines-v")
        );

        const cloned = yield* ines.git.ok(clone, "rev-parse", "HEAD");
        const file = yield* fs.readFileString(`${clone}/${sealed}`);
        const readsAfterClone = [...heard.reads];

        const bramClone = yield* kept(
          bram.git.run(outside, "clone", "--quiet", layerUrl, "layer")
        );

        const nobody = yield* kept(
          git(outside, "clone", "--quiet", layerUrl, "nobody")
        );

        expect({
          bram: {
            exitCode: bramClone.exitCode,
            remote: remoteLines(bramClone.stderr),
          },
          cloned,
          file,
          ines: inesClone.exitCode,
          nobody: nobody.exitCode,
          reads: readsAfterClone,
          readsAfterRefusals: heard.reads,
        }).toStrictEqual({
          bram: {
            exitCode: 128,
            remote: [`remote: bram may not read ${project}--maintainers`],
          },
          cloned: layered,
          file: "it('keeps the offset', () => {});\n",
          ines: 0,
          nobody: 128,
          reads: [
            {
              handle: Handle.make("ines-v"),
              layer: maintainers,
              sha: Option.some(layered),
            },
          ],
          readsAfterRefusals: readsAfterClone,
        });

        const next = yield* ines.git.commit(clone, "Seal a second check", {
          "checks/held-back/export/offset.test.ts":
            "it('offsets', () => {});\n",
        });

        const pushed = yield* kept(ines.git.push(clone));

        const own = `${outside}/own`;

        yield* bram.git.ok(
          outside,
          "init",
          "--quiet",
          "--initial-branch=main",
          own
        );
        yield* bram.git.commit(own, "Try the layer", { [sealed]: "it();\n" });

        const bramPush = yield* kept(
          bram.git.run(own, "push", layerUrl, "HEAD:main")
        );

        const tips = yield* layers.refs(layerRepo);

        expect({
          bram: {
            exitCode: bramPush.exitCode,
            remote: remoteLines(bramPush.stderr),
          },
          main: tips.get(RefName.make(mainRef)),
          pushed: pushed.exitCode,
          pushes: heard.pushes,
        }).toStrictEqual({
          bram: {
            exitCode: 128,
            remote: [`remote: bram may not push to ${project}--maintainers`],
          },
          main: next,
          pushed: 0,
          pushes: [
            { head: next, layer: maintainers, pusher: Handle.make("ines-v") },
          ],
        });

        const asks = [
          AskId.make("keep-offset"),
          AskId.make("keep-zone"),
        ] as const;

        for (const id of asks) {
          const files = askFiles(id);

          yield* world.script(
            CheckAt.cases.Commit.make({
              commit: yield* world.composed(project, files),
            }),
            LaneName.make("redThenGreen"),
            ["failed", "failed"]
          );

          yield* ines.rpc.openAsk({ ask: id, files, project });
        }

        const [first, second] = asks;

        const { claim: bramsClaim } = yield* bram.rpc.claim({
          ask: first,
          project,
        });

        const { claim: inesClaim } = yield* ines.rpc.claim({
          ask: second,
          project,
        });

        const bramsWork = yield* bram.git.clone(bramsClaim.remote);

        const bramsHead = yield* bram.git.commit(
          bramsWork,
          "Fix, and copy",
          escaping
        );

        const bramsAnswer = yield* kept(bram.git.push(bramsWork));

        const inesWork = yield* ines.git.clone(inesClaim.remote);

        yield* ines.git.commit(inesWork, "Fix, and copy", escaping);

        const inesAnswer = yield* kept(ines.git.push(inesWork));

        expect({
          bram: {
            exitCode: bramsAnswer.exitCode,
            fork: yield* bram.git.ok(bramsWork, "ls-remote", "origin", mainRef),
            remote: remoteLines(bramsAnswer.stderr),
          },
          ines: {
            exitCode: inesAnswer.exitCode,
            remote: remoteLines(inesAnswer.stderr),
          },
        }).toStrictEqual({
          bram: {
            exitCode: 1,
            fork: `${bramsHead}\t${mainRef}`,
            remote: rendered([
              new PrivatePathInPublicTree({
                paths: [RepoPath.make(sealed), RepoPath.make("src/fix.ts")],
              }),
            ]),
          },
          ines: {
            exitCode: 1,
            remote: rendered([
              new PrivatePathInPublicTree({ paths: [RepoPath.make(sealed)] }),
            ]),
          },
        });

        const logged = yield* world.logged;

        const said = [
          ...outputs.flatMap(({ stderr, stdout }) => [stderr, stdout]),
          ...logged.flatMap(({ annotations, message }) => [
            message,
            ...annotations.values(),
          ]),
        ].join("\n");

        expect({
          leaked: minted.filter((secret) => said.includes(secret)),
          minted: minted.length > 0,
        }).toStrictEqual({ leaked: [], minted: true });
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
  it.live(
    "a clone over protocol v0, and one whose request git compresses, each log one read naming a commit it wanted",
    () =>
      Effect.gen(function* () {
        const { heard, ines, layered, remote, seed, world } = yield* layerWorld;
        const layerUrl = `${world.origin}/${project}--maintainers.git`;

        // Forty more branches: a clone that wants them all sends git's
        const branches = Array.makeBy(40, (n) => `refs/heads/area-${n}`);

        yield* ines.git.ok(
          seed,
          "push",
          "--quiet",
          remote,
          ...branches.map((ref) => `HEAD:${ref}`)
        );

        const v0 = yield* ines.git.ok(
          seed,
          "-c",
          "protocol.version=0",
          "clone",
          "--quiet",
          layerUrl,
          "v0"
        );

        const afterV0 = [...heard.reads];

        yield* ines.git.ok(
          seed,
          "clone",
          "--quiet",
          "--no-single-branch",
          layerUrl,
          "every-branch"
        );

        expect({
          afterV0,
          v0,
          wide: heard.reads.slice(afterV0.length),
        }).toStrictEqual({
          afterV0: [
            {
              handle: Handle.make("ines-v"),
              layer: maintainers,
              sha: Option.some(layered),
            },
          ],
          v0: "",
          wide: [
            {
              handle: Handle.make("ines-v"),
              layer: maintainers,
              sha: Option.some(layered),
            },
          ],
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.effect("the stage's ports carry the live gate, not the default", () =>
    Effect.gen(function* () {
      const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

      const gate = yield* LayerGate.use(Effect.succeed).pipe(
        Effect.provide(workerPorts(config))
      );

      expect(gate === noLayers).toBeFalsy();
    })
  );

  it.effect(
    "the stage's layer gate asks the private namespace for a layer repo, never the public one",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

        const exit = yield* LayerGate.use((gate) =>
          gate.upstream.exchange(
            layerRepo,
            Exchange.Advertise({
              headers: new Headers(),
              service: "git-upload-pack",
            })
          )
        ).pipe(Effect.provide(workerPorts(config)), Effect.exit);

        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
          "a test touched ARTIFACTS_PRIVATE."
        );
      })
  );
});
