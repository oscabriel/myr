/**
 * The web Worker's entry (`wrangler.jsonc`'s `main`): TanStack Start's own
 * server entry, behind the 301s that bring an old or miscased project
 * address to its name's (`canonicalAddress`), with every answer passed
 * through `forTheEdge`, so what the edge's cache may keep is decided in one
 * place for pages, server functions, server routes, redirects and errors
 * alike (ADR 0026).
 */
import handler from "@tanstack/react-start/server-entry";

import { addressedEntry } from "./server/addresses.ts";
import { edgeEntry } from "./server/edge-cache.ts";

export default edgeEntry(addressedEntry(handler));
