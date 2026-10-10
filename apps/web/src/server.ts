/**
 * The web Worker's entry (`wrangler.jsonc`'s `main`): TanStack Start's own
 * server entry, with every answer it gives passed through `forTheEdge`, so
 * what the edge's cache may keep is decided in one place for pages, server
 * functions, server routes, redirects and errors alike (ADR 0026).
 */
import handler from "@tanstack/react-start/server-entry";

import { edgeEntry } from "./server/edge-cache.ts";

export default edgeEntry(handler);
