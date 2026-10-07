import { Brand } from "@repo/brand";
import { Client, surfaced } from "@repo/protocol/contracts";
import { toToolkit } from "@repo/protocol/mcp";
import { Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { Command } from "effect/cli";

const projection = toToolkit(surfaced("mcp"), Effect.service(Client));

/**
 * The MCP-surfaced contracts as tools over stdio, in every protocol a harness may
 * speak: the stateless 2026-07-28 one, and the four session-based ones before
 * it. Calls go through the `Client`.
 */
const server = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(
    McpServer.layerStdio({
      name: Brand.name,
      protocols: [
        McpProtocol.v2026_07_28,
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
      version: "0.0.0",
    })
  )
);

/** `mcp`: serve the contracts to a harness that spawned this process. */
export const mcp = Command.make("mcp", {}, () => Layer.launch(server)).pipe(
  Command.withDescription("Serve the platform's tools over MCP on stdio.")
);
