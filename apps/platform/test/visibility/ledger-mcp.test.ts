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

const noFetch = Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch"));

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

const Reply = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      isError: Schema.Boolean,
      structuredContent: Schema.Unknown,
    }),
  })
);

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
