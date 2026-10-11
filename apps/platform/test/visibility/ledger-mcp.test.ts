/**
 * The public ledger over MCP (`ledger.get` is the `ledger` contract's tool):
 * over the platform's Node world (the core loop's world) with the visibility
 * cartridge's project state composed into every Project DO, a `tools/call` of
 * `ledger` for datekit returns the ledger as structured content, the same
 * ledger the RPC `ledger` gives, and both are the cartridge's.
 *
 * datekit's config folder here has no `visibility.ts`, so its ledger is the
 * Open one, the same as the neutral port's: the test watches the
 * cartridge's port answer.
 */
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { Brand } from "@repo/brand";
import { ProjectVisibility } from "@repo/project/visibility-port";
import type { VisibilityPort } from "@repo/project/visibility-port";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Schema } from "effect";

import { decodeEnv } from "../../src/platform.ts";
import { stateLive } from "../../src/visibility/state.ts";
import { fakeEnv, operatorToken } from "../fake-env.ts";
import { origin } from "../harness.ts";
import { coreLoopWorld } from "../world.ts";

const project = ProjectName.make("dora/datekit");

/** datekit as dora first pushes it: one source file and the config folder. */
const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${Brand.cliPackage}/rules";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/week.ts": "export const week = (iso: string) => 0;\n",
};

/** A `Fetch` that nothing here may call. */
const noFetch = Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch"));

/** The cartridge's project state for the world's stage, over a private namespace of its own. */
const stateOfStage = Layer.unwrap(
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

/**
 * That state as the Worker plugs it into each Project DO, watched: each
 * project the cartridge's port is asked the ledger of joins `asked`.
 */
const cartridge = (asked: ProjectName[]) =>
  Layer.effect(
    ProjectVisibility,
    Effect.gen(function* () {
      const port = yield* ProjectVisibility;

      const watched: VisibilityPort = {
        ...port,
        ledger: (of, snapshot) => {
          asked.push(of);

          return port.ledger(of, snapshot);
        },
      };

      return watched;
    })
  ).pipe(Layer.provide(stateOfStage));

const version = "2026-07-28";

/** A stateless 2026-07-28 `tools/call` over MCP's HTTP transport, as the operator. */
const ledgerCall = new Request(`${origin}/mcp`, {
  body: JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: {
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: "test",
          version: "0.0.0",
        },
        "io.modelcontextprotocol/protocolVersion": version,
      },
      arguments: { project },
      name: "ledger",
    },
  }),
  headers: {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${operatorToken}`,
    "content-type": "application/json",
    "mcp-method": "tools/call",
    "mcp-name": "ledger",
    "mcp-protocol-version": version,
  },
  method: "POST",
});

/** A tools/call reply: whether it failed, and its structured content. */
const Reply = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      isError: Schema.Boolean,
      structuredContent: Schema.Unknown,
    }),
  })
);

/** The last JSON-RPC message in a reply, which is plain JSON or an event stream. */
const replyOf = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((text) =>
      response.headers.get("content-type")?.includes("text/event-stream") ===
      true
        ? (text
            .split("\n")
            .findLast((line) => line.startsWith("data: "))
            ?.slice("data: ".length) ?? "")
        : text
    ),
    Effect.flatMap(Schema.decodeEffect(Reply))
  );

describe("the ledger over MCP, with the visibility cartridge composed", () => {
  it.live(
    "returns datekit's ledger as structured content, as the ledger contract gives it",
    () =>
      Effect.suspend(() => {
        const asked: ProjectName[] = [];

        return Effect.scoped(
          Effect.gen(function* () {
            const world = yield* coreLoopWorld();
            const dora = world.rpc("dora");
            const made = yield* dora.initProject({ project });
            const home = yield* world.git("dora").clone(made.remote);

            yield* world.git("dora").commit(home, "Start datekit", start);
            yield* world.git("dora").push(home);

            const { result } = yield* replyOf(yield* world.fetch(ledgerCall));
            const overMcp = [...asked];
            const ledger = yield* world.rpc("anonymous").ledger({ project });

            expect({
              asked: [overMcp, asked],
              isError: result.isError,
              structured: yield* Schema.decodeUnknownEffect(Ledger)(
                result.structuredContent
              ),
            }).toStrictEqual({
              asked: [[project], [project, project]],
              isError: false,
              structured: ledger,
            });
            expect(ledger).toStrictEqual({
              entries: [],
              layers: [],
              posture: "open",
              postureLabel: "Open",
              project,
            });
          }).pipe(Effect.provide(cartridge(asked)))
        );
      }),
    30_000
  );
});
