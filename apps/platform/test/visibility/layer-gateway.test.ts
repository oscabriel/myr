/**
 * A project's layer repos through the platform's own fetch handler, with
 * real git: the maintainers clone their layer
 * and push to it, a contributor is turned away with one line git prints,
 * every read is logged with who and which commit, and a push to a public
 * fork cannot carry a layer's path, without telling a contributor which of
 * their paths collided.
 *
 * The world is the core loop's (`world.ts`) with the cartridge's gateway side
 * plugged into the Worker (`LayerGateLive`), its public repos and the private
 * namespace's each a store of bare repos behind `git http-backend`. Each
 * Project DO runs on a stand-in for the cartridge's `ProjectVisibility`:
 * datekit declares one layer, `maintainers`, which its deciders ines-v and
 * okonkwo read and push to, holding one sealed check; it writes down every read
 * and every layer push the DO hears.
 */
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
import type { CommitSha } from "@repo/protocol/ids";
import {
  AskId,
  Handle,
  LaneName,
  LayerName,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
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

const project = ProjectName.make("oscabriel/datekit");

const maintainers = LayerName.make("maintainers");

/** The layer's repo, in the private namespace. */
const layerRepo = RepoName.make(`${project}--${maintainers}`);

/** The sealed check the layer holds. */
const sealed = "checks/held-back/export/escape.test.ts";

const mainRef = "refs/heads/main";

/** The people: two deciders who maintain the layer, and a contributor. */
const tokens = {
  bram: "bram-layer-gateway-token-0123456789abcdef",
  "ines-v": "ines-v-layer-gateway-token-0123456789abcdef",
  okonkwo: "okonkwo-layer-gateway-token-0123456789abcdef",
} as const;

/** The layer's readers and writers: datekit's deciders. */
const keepers: ReadonlySet<string> = new Set(["ines-v", "okonkwo"]);

const keeps = (who: Principal) =>
  Principal.guards.Person(who) && keepers.has(who.handle);

/** What the stand-in for the visibility port heard from the DO. */
interface Heard {
  /** Each time the DO was asked how far someone reaches into a layer. */
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

/**
 * The cartridge's `ProjectVisibility`, as far as the gateway reaches it:
 * datekit's one layer, its keepers' access, its one path, and every read and
 * layer push written down.
 */
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
  // The layer's row, as the visibility port writes it once the config lands:
  // stage 1 names exact paths only to someone who reads every layer kept.
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

/** The private namespace's store, writing down every token secret it mints. */
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

/** datekit as ines-v first pushes it. */
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
  "package.json": '{ "name": "datekit", "private": true }\n',
  "src/export.ts": "export const toIso = (date: Date) => date.toISOString();\n",
};

/** An ask whose territory holds both the code and its checks. */
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

/** The lines git printed from the server, less the padding git adds. */
const remoteLines = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("remote: "))
    .map((line) => line.trimEnd());

/** What `protocol/render` says of `refusals`, as git prints it. */
const rendered = (refusals: Parameters<typeof explain>[0]) =>
  explain(refusals).map((line) => `remote: ${line}`);

/** The answer both pushes carry: a fix, and a copy of the layer's sealed check. */
const escaping = {
  [sealed]: "it('escapes', () => {});\n",
  "src/fix.ts": "export const fix = true;\n",
};

/**
 * The world, with datekit landed by ines-v and its maintainers layer's
 * repo in the private namespace holding the sealed check: the people, what
 * the stand-in port heard, every token the private store minted, and every
 * git run a test keeps for the leak check.
 */
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

  /** git, kept for the check that no token reached anyone. */
  const kept = <R>(ran: Effect.Effect<Ran, never, R>) =>
    Effect.tap(ran, (output) =>
      Effect.sync(() => {
        outputs.push(output);
      })
    );

  // ines-v makes datekit and lands its first tree.
  const made = yield* ines.rpc.initProject({ project });
  const home = yield* ines.git.clone(made.remote);

  yield* ines.git.commit(home, "Start datekit", start);
  yield* kept(ines.git.push(home));

  // The layer's repo in the private namespace, holding its sealed check,
  // pushed there as the cartridge's provisioning would leave it.
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

        const layerUrl = `${world.origin}/${layerRepo}.git`;

        // Asked with no credential, the layer asks for one; a name that is
        // no declared layer is no repo at all.
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

        const anonymous = yield* ask(layerRepo);
        const undeclared = yield* ask(`${project}--secrets`);

        const undeclaredSignedIn = yield* ask(
          `${project}--secrets`,
          tokens.bram
        );

        // A keeper's request asks the project once: whether the layer is
        // declared and how far she reaches, in one answer.
        const asksBefore = heard.asks.length;
        const keeper = yield* ask(layerRepo, tokens["ines-v"]);

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

        // ines-v clones the layer and gets its files; her read is logged
        // once, with the commit she read. bram is told why he can't; with
        // no credential at all, git is asked for one.
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
            remote: [`remote: bram may not read ${layerRepo}`],
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

        // ines-v pushes a new sealed check: the layer's main moves, and the
        // project hears the head. bram's push is turned away.
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
            remote: [`remote: bram may not push to ${layerRepo}`],
          },
          main: next,
          pushed: 0,
          pushes: [
            { head: next, layer: maintainers, pusher: Handle.make("ines-v") },
          ],
        });

        // Two asks, red first, so bram and ines-v each hold a claim.
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

        // bram's fork push carries the layer's path: he reads no layer, so
        // he hears every path he added, and his fork keeps the commit.
        const bramsWork = yield* bram.git.clone(bramsClaim.remote);

        const bramsHead = yield* bram.git.commit(
          bramsWork,
          "Fix, and copy",
          escaping
        );

        const bramsAnswer = yield* kept(bram.git.push(bramsWork));

        // ines-v reads the layer, so she hears only the path that collides.
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

        // The layer's tokens stayed with the platform: the private store
        // minted some, and none reached git's output or a log line.
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
        const layerUrl = `${world.origin}/${layerRepo}.git`;

        // Forty more branches: a clone that wants them all sends git's
        // request gzipped (above 1 KiB).
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

  // Found live: the gate's upstream was memoized with the public
  // namespace's, so every layer clone on a stage answered "no repo".
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

        // Both fake bindings refuse every call, each naming itself.
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
          "a test touched ARTIFACTS_PRIVATE."
        );
      })
  );
});
